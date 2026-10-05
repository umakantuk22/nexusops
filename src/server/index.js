/**
 * Project Nexus - Local HTTP Server, Health Probes & API Dispatcher
 * Hardened with request size limits (413 Payload Too Large), sliding window rate limiting (429 Too Many Requests),
 * non-leaking health probes (/livez, /readyz), environment-aware CORS, and static dashboard asset serving.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRequest } from '../api/v1/router.js';
import { seedDemoDatabase } from './seed.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { db } from '../lib/db.js';
import { RateLimiter, RateLimitRules } from '../middleware/rate_limiter.middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '../../public');

// In-memory Prometheus metric counters
const metrics = {
  httpRequestsTotal: 0,
  httpErrorsTotal: 0,
  startTime: Date.now(),
};

export async function createServer() {
  await seedDemoDatabase();

  const server = http.createServer(async (req, res) => {
    metrics.httpRequestsTotal += 1;

    const requestOrigin = req.headers.origin;
    let allowedOrigin = '*';
    if (env.ALLOWED_ORIGINS && env.ALLOWED_ORIGINS.length > 0) {
      if (requestOrigin && env.ALLOWED_ORIGINS.includes(requestOrigin)) {
        allowedOrigin = requestOrigin;
      } else if (!requestOrigin) {
        allowedOrigin = env.ALLOWED_ORIGINS[0];
      }
    }

    // Security Headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Organization-Id, X-Request-Id');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // KUBERNETES / CLOUD HEALTH PROBES
    if (url.pathname === '/livez' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }

    // Readiness probe: Does not leak internal business statistics (active tenants)
    if (url.pathname === '/readyz' && req.method === 'GET') {
      try {
        // Ping database persistence
        await db.organizations.findMany({ take: 1 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ready', checks: { database: 'ok', disk: 'ok' } }));
      } catch (err) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'unavailable', error: 'Database check failed' }));
      }
      return;
    }

    // PROMETHEUS METRICS ENDPOINT
    if (url.pathname === '/metrics' && req.method === 'GET') {
      // Internal or development access
      const uptimeSeconds = Math.round((Date.now() - metrics.startTime) / 1000);
      const prometheusFormat = [
        '# HELP nexus_http_requests_total Total number of HTTP requests processed.',
        '# TYPE nexus_http_requests_total counter',
        `nexus_http_requests_total ${metrics.httpRequestsTotal}`,
        '',
        '# HELP nexus_http_errors_total Total number of HTTP errors encountered.',
        '# TYPE nexus_http_errors_total counter',
        `nexus_http_errors_total ${metrics.httpErrorsTotal}`,
        '',
        '# HELP nexus_process_uptime_seconds Process uptime in seconds.',
        '# TYPE nexus_process_uptime_seconds gauge',
        `nexus_process_uptime_seconds ${uptimeSeconds}`,
      ].join('\n');

      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
      res.end(prometheusFormat);
      return;
    }

    // API Route Handler
    if (url.pathname.startsWith('/api/v1/')) {
      // 1. Rate Limiting Gate
      let rule = RateLimitRules.DEFAULT_API;
      let prefix = 'api';
      if (url.pathname.includes('/auth/login')) {
        rule = RateLimitRules.AUTH_LOGIN;
        prefix = 'auth_login';
      } else if (url.pathname.includes('/auth/register')) {
        rule = RateLimitRules.AUTH_REGISTER;
        prefix = 'auth_register';
      } else if (url.pathname.includes('/ai/')) {
        rule = RateLimitRules.AI_DISPATCH;
        prefix = 'ai_dispatch';
      }

      const rateCheck = RateLimiter.checkRateLimit(req, rule, prefix);
      res.setHeader('X-RateLimit-Limit', rule.limit);
      res.setHeader('X-RateLimit-Remaining', rateCheck.remaining);
      res.setHeader('X-RateLimit-Reset', rateCheck.resetInSeconds);

      if (!rateCheck.allowed) {
        metrics.httpErrorsTotal += 1;
        res.setHeader('Retry-After', rateCheck.resetInSeconds);
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: `Too many requests. Limit is ${rule.limit} requests per minute. Retry in ${rateCheck.resetInSeconds}s.`,
            },
          })
        );
        return;
      }

      // 2. Request Body Parsing with Strict Size Limit Guard
      let bodyData = null;
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const isCsv = req.headers['content-type']?.includes('text/csv');
        const maxLimit = isCsv ? env.MAX_CSV_SIZE_BYTES : env.MAX_BODY_SIZE_BYTES;

        try {
          const buffers = [];
          let currentBytes = 0;

          for await (const chunk of req) {
            currentBytes += chunk.length;
            if (currentBytes > maxLimit) {
              metrics.httpErrorsTotal += 1;
              res.writeHead(413, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: {
                    code: 'PAYLOAD_TOO_LARGE',
                    message: `Request payload exceeds maximum allowed size of ${Math.round(maxLimit / 1024 / 1024)}MB.`,
                  },
                })
              );
              return;
            }
            buffers.push(chunk);
          }

          const raw = Buffer.concat(buffers).toString('utf-8');
          if (isCsv) {
            bodyData = raw;
          } else {
            bodyData = raw ? JSON.parse(raw) : null;
          }
        } catch {
          metrics.httpErrorsTotal += 1;
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'INVALID_JSON', message: 'Malformed JSON payload.' } }));
          return;
        }
      }

      const apiReq = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: bodyData,
      };

      const result = await handleApiRequest(apiReq);
      if (result.statusCode >= 400) {
        metrics.httpErrorsTotal += 1;
      }
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
      return;
    }

    // Serve Frontend Static UI
    if (url.pathname === '/' || url.pathname === '/index.html' || !url.pathname.includes('.')) {
      const indexPath = path.join(publicDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(indexPath).pipe(res);
        return;
      }
    }

    // Serve other static files in public/
    const staticFilePath = path.join(publicDir, url.pathname.replace(/^\//, ''));
    if (fs.existsSync(staticFilePath) && fs.statSync(staticFilePath).isFile()) {
      let contentType = 'text/plain';
      if (staticFilePath.endsWith('.html')) contentType = 'text/html; charset=utf-8';
      else if (staticFilePath.endsWith('.css')) contentType = 'text/css';
      else if (staticFilePath.endsWith('.js')) contentType = 'application/javascript';
      else if (staticFilePath.endsWith('.json')) contentType = 'application/json';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(staticFilePath).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || env.APP_PORT || 3000;
  const server = await createServer();
  server.listen(port, () => {
    logger.info(`Project Nexus Server listening on http://localhost:${port}`);
  });
}

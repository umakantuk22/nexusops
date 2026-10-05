/**
 * Project Nexus - In-Memory Sliding Window Rate Limiter Middleware
 * Protects against brute-force attacks on auth endpoints and API denial of service.
 */

// Key -> { count: number, resetAt: number }
const rateLimitBuckets = new Map();

// Configuration
export const RateLimitRules = {
  AUTH_LOGIN: { limit: 10, windowMs: 60 * 1000 },
  AUTH_REGISTER: { limit: 10, windowMs: 60 * 1000 },
  DEFAULT_API: { limit: 120, windowMs: 60 * 1000 },
  AI_DISPATCH: { limit: 30, windowMs: 60 * 1000 },
};

export class RateLimiter {
  static getClientIp(req) {
    return (
      req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.headers?.['x-real-ip'] ||
      req.socket?.remoteAddress ||
      '127.0.0.1'
    );
  }

  static checkRateLimit(req, rule = RateLimitRules.DEFAULT_API, keyPrefix = 'api') {
    const ip = this.getClientIp(req);
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let bucket = rateLimitBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = {
        count: 1,
        resetAt: now + rule.windowMs,
      };
      rateLimitBuckets.set(key, bucket);
      return { allowed: true, remaining: rule.limit - 1, resetInSeconds: Math.ceil(rule.windowMs / 1000) };
    }

    if (bucket.count >= rule.limit) {
      const resetInSeconds = Math.ceil((bucket.resetAt - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetInSeconds: Math.max(resetInSeconds, 1),
      };
    }

    bucket.count += 1;
    return {
      allowed: true,
      remaining: rule.limit - bucket.count,
      resetInSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  static reset() {
    rateLimitBuckets.clear();
  }
}

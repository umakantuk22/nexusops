/**
 * Project Nexus - Tamper-Proof Cryptographically Chained Audit Logging Service
 * Features SHA-256 hash chaining (blockchain-style tamper detection) and automatic PII/secret redaction.
 */
import crypto from 'node:crypto';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { AuthorizationService } from '../authorization/authorization.service.js';

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'jwt',
  'secret',
  'apikey',
  'creditcard',
  'ssn',
  'authorization',
]);

export class AuditService {
  /**
   * Deeply sanitizes sensitive data fields before persisting into audit logs.
   */
  static redactSensitiveFields(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map((item) => this.redactSensitiveFields(item));

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      if (REDACTED_KEYS.has(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else if (value && typeof value === 'object') {
        sanitized[key] = this.redactSensitiveFields(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /**
   * Computes SHA-256 hash for audit chain verification.
   */
  static computeEventHash({ previousHash, timestamp, organizationId, action, entityType, entityId, details }) {
    const serialized = JSON.stringify({
      previousHash,
      timestamp,
      organizationId,
      action,
      entityType,
      entityId,
      details,
    });
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Records an immutable, cryptographically chained audit log entry.
   */
  static async record({
    organizationId,
    userId = null,
    action,
    entityType,
    entityId,
    details = null,
    ipAddress = null,
    userAgent = null,
  }) {
    if (!organizationId || !action || !entityType || !entityId) {
      throw new Error('Audit log requires organizationId, action, entityType, and entityId.');
    }

    // 1. Redact sensitive secrets & PII
    const sanitizedDetails = this.redactSensitiveFields(details);

    // 2. Fetch the most recent audit entry for the tenant to chain hashes
    const lastEntry = await db.auditLogs.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const previousHash = lastEntry?.eventHash || GENESIS_HASH;
    const createdAt = new Date();

    // 3. Compute cryptographic tamper-proof hash
    const eventHash = this.computeEventHash({
      previousHash,
      timestamp: createdAt.toISOString(),
      organizationId,
      action,
      entityType,
      entityId,
      details: sanitizedDetails,
    });

    const logEntry = await db.auditLogs.create({
      data: {
        organizationId,
        userId,
        action,
        entityType,
        entityId,
        details: sanitizedDetails,
        ipAddress,
        userAgent,
        previousHash,
        eventHash,
        createdAt,
      },
    });

    logger.info('Audit event recorded', {
      organizationId,
      userId,
      action,
      entityType,
      entityId,
    });

    return logEntry;
  }

  /**
   * Verifies the cryptographic chain integrity for a tenant's audit trail.
   */
  static async verifyAuditIntegrity(organizationId) {
    const logs = await db.auditLogs.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });

    let expectedPrevHash = GENESIS_HASH;
    for (let i = 0; i < logs.length; i++) {
      const entry = logs[i];
      if (entry.previousHash !== expectedPrevHash) {
        return {
          valid: false,
          compromisedIndex: i,
          entryId: entry.id,
          reason: 'Chain link broken: previousHash mismatch',
        };
      }

      const recomputed = this.computeEventHash({
        previousHash: entry.previousHash,
        timestamp: new Date(entry.createdAt).toISOString(),
        organizationId: entry.organizationId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        details: entry.details,
      });

      if (recomputed !== entry.eventHash) {
        return {
          valid: false,
          compromisedIndex: i,
          entryId: entry.id,
          reason: 'Tampered record: payload hash mismatch',
        };
      }

      expectedPrevHash = entry.eventHash;
    }

    return { valid: true, verifiedEvents: logs.length };
  }

  /**
   * Retrieves audit logs for an organization with strict tenant isolation.
   */
  static async getLogs({ organizationId, entityType = null, entityId = null, take = 50, skip = 0 }) {
    if (!organizationId) {
      throw new Error('organizationId is required to retrieve audit logs.');
    }

    const where = { organizationId };
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;

    const logs = await db.auditLogs.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    // Ensure all returned logs match the requested tenant (defense in depth)
    for (const log of logs) {
      AuthorizationService.assertTenantScope(organizationId, log.organizationId);
    }

    return logs;
  }
}

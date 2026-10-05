/**
 * Project Nexus - Account Domain Service
 */
import { db } from '../../lib/db.js';
import { NotFoundError, ValidationError, ConcurrencyError } from '../../lib/errors.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TimelineService } from './timeline.service.js';

export class AccountService {
  static async createAccount({ organizationId, userId, name, industry = null, website = null, tier = 'SMB', healthScore = 100 }) {
    if (!organizationId || !name) {
      throw new ValidationError('Organization ID and account name are required.');
    }

    const account = await db.accounts.create({
      data: {
        organizationId,
        name: name.trim(),
        industry,
        website,
        tier,
        healthScore,
        version: 1,
      },
    });

    await AuditService.record({
      organizationId,
      userId,
      action: 'ACCOUNT_CREATED',
      entityType: 'Account',
      entityId: account.id,
      details: { name: account.name, tier: account.tier },
    });

    await TimelineService.recordEvent({
      organizationId,
      entityType: 'Account',
      entityId: account.id,
      eventType: 'ACCOUNT_CREATED',
      summary: `Account '${account.name}' was created.`,
      metadata: { tier: account.tier, industry: account.industry },
    });

    return account;
  }

  static async getAccount(organizationId, accountId) {
    const account = await db.accounts.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new NotFoundError('Account');
    }

    AuthorizationService.assertTenantScope(organizationId, account.organizationId);
    return account;
  }

  static async listAccounts(organizationId, { take = 50, skip = 0, industry = null, tier = null } = {}) {
    const where = { organizationId };
    if (industry) where.industry = industry;
    if (tier) where.tier = tier;

    return await db.accounts.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  static async updateAccount({ organizationId, userId, accountId, expectedVersion = null, data }) {
    const account = await this.getAccount(organizationId, accountId);

    // Optimistic Concurrency Check
    if (expectedVersion !== null && account.version !== expectedVersion) {
      throw new ConcurrencyError(
        `Account version mismatch. Expected ${expectedVersion}, but found ${account.version}.`
      );
    }

    const updated = await db.accounts.update({
      where: { id: accountId },
      data: {
        ...data,
        version: account.version + 1,
      },
    });

    await AuditService.record({
      organizationId,
      userId,
      action: 'ACCOUNT_UPDATED',
      entityType: 'Account',
      entityId: account.id,
      details: data,
    });

    await TimelineService.recordEvent({
      organizationId,
      entityType: 'Account',
      entityId: account.id,
      eventType: 'ACCOUNT_UPDATED',
      summary: `Account '${account.name}' was updated.`,
      metadata: data,
    });

    return updated;
  }

  static async deleteAccount({ organizationId, userId, accountId }) {
    const account = await this.getAccount(organizationId, accountId);

    await db.accounts.delete({ where: { id: accountId } });

    await AuditService.record({
      organizationId,
      userId,
      action: 'ACCOUNT_DELETED',
      entityType: 'Account',
      entityId: accountId,
      details: { name: account.name },
    });

    return { success: true };
  }
}

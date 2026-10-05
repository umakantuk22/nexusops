/**
 * Project Nexus - Entitlement & Quota Service
 * Centralizes plan checks, feature flags, and durable monthly billing quota tracking.
 * Persists usage records to db.usageRecords partitioned by organization and calendar month.
 * Employs write-coalescing / buffer flush to handle high-concurrency increments safely.
 */
import { db } from '../../lib/db.js';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export const PLANS = {
  FREE: {
    name: 'Free',
    maxContacts: 100,
    maxOpportunities: 10,
    maxAiActionsPerMonth: 50,
    features: ['crm.core', 'work.basic'],
  },
  PRO: {
    name: 'Pro',
    maxContacts: 5000,
    maxOpportunities: 500,
    maxAiActionsPerMonth: 2500,
    features: ['crm.core', 'work.basic', 'work.prioritization', 'ai.gateway', 'automation.workflows'],
  },
  ENTERPRISE: {
    name: 'Enterprise',
    maxContacts: Infinity,
    maxOpportunities: Infinity,
    maxAiActionsPerMonth: 50000,
    features: ['crm.core', 'work.basic', 'work.prioritization', 'ai.gateway', 'automation.workflows', 'audit.unlimited', 'api.high_rate_limit'],
  },
};

const usageStore = new Map(); // orgId -> { contacts: n, opportunities: n, aiActions: n }
const pendingFlush = new Map(); // recordId -> { organizationId, metric, quantity, periodStart, periodEnd }
let flushScheduled = false;

function scheduleUsageFlush() {
  if (flushScheduled) return;
  flushScheduled = true;

  setImmediate(async () => {
    flushScheduled = false;
    const items = Array.from(pendingFlush.values());
    pendingFlush.clear();

    for (const item of items) {
      try {
        await db.usageRecords.upsert({
          where: {
            organizationId: item.organizationId,
            metric: item.metric,
            periodStart: item.periodStart,
          },
          create: {
            id: `usage_${item.organizationId}_${item.metric}_${item.periodKey}`,
            organizationId: item.organizationId,
            metric: item.metric,
            periodStart: item.periodStart,
            periodEnd: item.periodEnd,
            quantity: item.quantity,
          },
          update: {
            quantity: item.quantity,
            updatedAt: new Date(),
          },
        });
      } catch (err) {
        logger.warn('Durable usage record persistence warning:', err.message);
      }
    }
  });
}

export class EntitlementService {
  static getPlanLimits(plan = 'FREE') {
    const normalized = (plan || 'FREE').toUpperCase();
    return PLANS[normalized] || PLANS.FREE;
  }

  static async getOrganizationPlan(organizationId) {
    const org = await db.organizations.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundError('Organization');
    return (org.plan || 'FREE').toUpperCase();
  }

  static getCurrentBillingPeriod() {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
    const periodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return { periodStart, periodEnd, periodKey };
  }

  /**
   * Asserts whether an organization is entitled to a specific feature flag.
   */
  static async assertFeatureEntitlement(organizationId, featureName) {
    const planName = await this.getOrganizationPlan(organizationId);
    const planConfig = this.getPlanLimits(planName);

    if (!planConfig.features.includes(featureName)) {
      logger.warn('Feature entitlement denied', { organizationId, plan: planName, featureName });
      throw new ForbiddenError(
        `Feature '${featureName}' is not included in the '${planConfig.name}' plan. Please upgrade to access this feature.`
      );
    }
    return true;
  }

  /**
   * Asserts whether current usage is within quota limits.
   */
  static async assertQuotaWithinLimit(organizationId, metric) {
    const planName = await this.getOrganizationPlan(organizationId);
    const planConfig = this.getPlanLimits(planName);

    const currentUsage = usageStore.get(organizationId)?.[metric] || 0;

    let limit = Infinity;
    if (metric === 'contacts') limit = planConfig.maxContacts;
    if (metric === 'opportunities') limit = planConfig.maxOpportunities;
    if (metric === 'aiActions') limit = planConfig.maxAiActionsPerMonth;

    if (currentUsage >= limit) {
      logger.warn('Quota limit reached', { organizationId, metric, currentUsage, limit });
      throw new ForbiddenError(
        `Quota exceeded for '${metric}'. Limit on '${planConfig.name}' plan is ${limit}. Current: ${currentUsage}.`
      );
    }

    return true;
  }

  /**
   * Increments usage for an organization and queues coalesced write to durable db.usageRecords.
   */
  static recordUsage(organizationId, metric, amount = 1) {
    if (!usageStore.has(organizationId)) {
      usageStore.set(organizationId, { contacts: 0, opportunities: 0, aiActions: 0 });
    }
    const current = usageStore.get(organizationId);
    current[metric] = (current[metric] || 0) + amount;
    const finalQuantity = current[metric];

    const { periodStart, periodEnd, periodKey } = this.getCurrentBillingPeriod();
    const recordId = `usage_${organizationId}_${metric}_${periodKey}`;

    pendingFlush.set(recordId, {
      organizationId,
      metric,
      quantity: finalQuantity,
      periodStart,
      periodEnd,
      periodKey,
    });

    scheduleUsageFlush();
    return current[metric];
  }

  static async getBillingSummary(organizationId) {
    const plan = await this.getOrganizationPlan(organizationId);
    const limits = this.getPlanLimits(plan);
    const { periodStart, periodEnd, periodKey } = this.getCurrentBillingPeriod();
    const currentUsage = usageStore.get(organizationId) || { contacts: 0, opportunities: 0, aiActions: 0 };

    return {
      organizationId,
      plan,
      billingPeriod: {
        periodKey,
        start: periodStart,
        end: periodEnd,
      },
      quotas: {
        contacts: { usage: currentUsage.contacts, limit: limits.maxContacts },
        opportunities: { usage: currentUsage.opportunities, limit: limits.maxOpportunities },
        aiActions: { usage: currentUsage.aiActions, limit: limits.maxAiActionsPerMonth },
      },
      entitledFeatures: limits.features,
    };
  }

  static resetUsage() {
    usageStore.clear();
    pendingFlush.clear();
    db.usageRecords.deleteMany({}).catch(() => {});
  }
}

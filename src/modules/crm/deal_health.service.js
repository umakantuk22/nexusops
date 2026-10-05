/**
 * Project Nexus - Predictive Deal Velocity & Customer Churn Analytics Service
 * Detects stalled sales cycles and escalating customer retention risks.
 */
import { db } from '../../lib/db.js';
import { TimelineService } from './timeline.service.js';
import { ActivityService } from './activity.service.js';
import { logger } from '../../lib/logger.js';

export class DealHealthService {
  /**
   * Scans open deals to detect sales velocity bottlenecks and stalled negotiations.
   */
  static async scanStalledDeals(organizationId, daysThreshold = 14) {
    const openOpportunities = await db.opportunities.findMany({
      where: { organizationId, status: 'OPEN' },
    });

    const now = Date.now();
    const thresholdMs = daysThreshold * 24 * 60 * 60 * 1000;
    const stalledDeals = [];

    for (const opp of openOpportunities) {
      const lastModified = new Date(opp.updatedAt).getTime();
      const ageMs = now - lastModified;

      if (ageMs > thresholdMs) {
        const daysStalled = Math.round(ageMs / (24 * 60 * 60 * 1000));
        stalledDeals.push({
          opportunityId: opp.id,
          title: opp.title,
          value: opp.value,
          stageId: opp.stageId,
          daysStalled,
          recommendedAction: `Schedule executive re-engagement call. Deal has been idle for ${daysStalled} days.`,
        });

        // Auto-create escalation task in Work Engine
        await ActivityService.createActivity({
          organizationId,
          entityType: 'Opportunity',
          entityId: opp.id,
          type: 'TASK',
          subject: `Deal Stalling Alert: ${opp.title} (${daysStalled} days idle)`,
          description: `Velocity warning: Deal value $${opp.value} has had no stage progression in ${daysStalled} days.`,
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Action needed within 24h
        });

        await TimelineService.recordEvent({
          organizationId,
          entityType: 'Opportunity',
          entityId: opp.id,
          eventType: 'DEAL_STALLING_ALERT',
          summary: `Predictive Alert: Deal idle for ${daysStalled} days. Priority escalated in Work Engine.`,
          metadata: { daysStalled, value: opp.value },
        });
      }
    }

    logger.info('Stalled Deals Scan Completed', { organizationId, stalledCount: stalledDeals.length });
    return stalledDeals;
  }

  /**
   * Scans customer accounts to detect immediate churn risks based on health scores.
   */
  static async scanChurnRisk(organizationId, healthThreshold = 50) {
    const accounts = await db.accounts.findMany({
      where: { organizationId },
    });

    const atRiskAccounts = [];
    for (const acc of accounts) {
      if (acc.healthScore < healthThreshold) {
        atRiskAccounts.push({
          accountId: acc.id,
          name: acc.name,
          tier: acc.tier,
          healthScore: acc.healthScore,
          riskLevel: acc.healthScore < 30 ? 'CRITICAL_RISK' : 'HIGH_RISK',
        });
      }
    }

    return atRiskAccounts;
  }
}

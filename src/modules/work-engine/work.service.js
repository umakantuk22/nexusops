/**
 * Project Nexus - "My Work" Command Center & Attention Queue
 */
import { db } from '../../lib/db.js';
import { PriorityService } from './priority.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';

export class WorkService {
  /**
   * Retrieves and ranks all action items requiring attention for the user/organization.
   */
  static async getMyWork(organizationId, userId, { priorityFilter = null, take = 50, skip = 0 } = {}) {
    AuthorizationService.assertTenantScope(organizationId, organizationId);

    // 1. Fetch pending activities (Tasks, Calls, Follow-ups)
    const activities = await db.activities.findMany({
      where: {
        organizationId,
        status: 'PENDING',
      },
    });

    const workItems = [];

    for (const act of activities) {
      let dealValue = 0;
      let accountTier = 'SMB';
      let healthScore = 100;

      if (act.entityType === 'Account') {
        const acc = await db.accounts.findUnique({ where: { id: act.entityId } });
        if (acc) {
          accountTier = acc.tier;
          healthScore = acc.healthScore;
        }
      } else if (act.entityType === 'Opportunity') {
        const opp = await db.opportunities.findUnique({ where: { id: act.entityId } });
        if (opp) {
          dealValue = opp.value;
          const acc = await db.accounts.findUnique({ where: { id: opp.accountId } });
          if (acc) {
            accountTier = acc.tier;
            healthScore = acc.healthScore;
          }
        }
      }

      // Calculate multidimensional dynamic priority score
      const priority = PriorityService.calculatePriority({
        dueDate: act.dueDate,
        dealValue,
        accountTier,
        healthScore,
        activityType: act.type,
      });

      workItems.push({
        id: act.id,
        title: act.subject,
        description: act.description,
        type: act.type,
        entityType: act.entityType,
        entityId: act.entityId,
        dueDate: act.dueDate,
        priorityScore: priority.score,
        priorityTier: priority.priorityTier,
        assignedToUserId: act.userId,
        status: act.status,
      });
    }

    // Sort by priorityScore descending
    workItems.sort((a, b) => b.priorityScore - a.priorityScore);

    // Apply priorityFilter if provided
    let filtered = workItems;
    if (priorityFilter) {
      filtered = workItems.filter((item) => item.priorityTier === priorityFilter);
    }

    return filtered.slice(skip, skip + take);
  }

  /**
   * Alias for getMyWork supporting options object pattern.
   */
  static async generateWorkQueue({ organizationId, userId, priorityFilter = null, take = 50, skip = 0 } = {}) {
    return this.getMyWork(organizationId, userId, { priorityFilter, take, skip });
  }
}

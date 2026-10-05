/**
 * Project Nexus - Unified Customer Timeline Service
 */
import { db } from '../../lib/db.js';
import { AuthorizationService } from '../authorization/authorization.service.js';

export class TimelineService {
  /**
   * Records an event onto the unified timeline.
   */
  static async recordEvent({ organizationId, entityType, entityId, eventType, summary, metadata = null }) {
    if (!organizationId || !entityType || !entityId || !eventType || !summary) {
      throw new Error('Timeline event requires organizationId, entityType, entityId, eventType, and summary.');
    }

    return await db.timelineEvents.create({
      data: {
        organizationId,
        entityType,
        entityId,
        eventType,
        summary,
        metadata,
        createdAt: new Date(),
      },
    });
  }

  /**
   * Retrieves chronological unified timeline for an entity.
   */
  static async getUnifiedTimeline(organizationId, entityType, entityId, { take = 50, skip = 0 } = {}) {
    AuthorizationService.assertTenantScope(organizationId, organizationId);

    return await db.timelineEvents.findMany({
      where: {
        organizationId,
        entityType,
        entityId,
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }
}

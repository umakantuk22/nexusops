/**
 * Project Nexus - Activity & Task Domain Service
 */
import { db } from '../../lib/db.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TimelineService } from './timeline.service.js';

export class ActivityService {
  static async createActivity({ organizationId, userId, entityType, entityId, type, subject, description = null, dueDate = null }) {
    if (!organizationId || !entityType || !entityId || !type || !subject) {
      throw new ValidationError('Organization ID, entityType, entityId, type, and subject are required.');
    }

    const activity = await db.activities.create({
      data: {
        organizationId,
        userId,
        entityType,
        entityId,
        type,
        subject: subject.trim(),
        description,
        status: 'PENDING',
        dueDate: dueDate ? new Date(dueDate) : null,
      },
    });

    await AuditService.record({
      organizationId,
      userId,
      action: 'ACTIVITY_CREATED',
      entityType: 'Activity',
      entityId: activity.id,
      details: { type, subject, entityType, entityId },
    });

    await TimelineService.recordEvent({
      organizationId,
      entityType,
      entityId,
      eventType: `ACTIVITY_${type}`,
      summary: `[${type}] ${activity.subject}`,
      metadata: { activityId: activity.id, dueDate: activity.dueDate },
    });

    return activity;
  }

  static async completeActivity({ organizationId, userId, activityId }) {
    const activity = await db.activities.findUnique({ where: { id: activityId } });
    if (!activity) throw new NotFoundError('Activity');

    AuthorizationService.assertTenantScope(organizationId, activity.organizationId);

    const updated = await db.activities.update({
      where: { id: activityId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    await AuditService.record({
      organizationId,
      userId,
      action: 'ACTIVITY_COMPLETED',
      entityType: 'Activity',
      entityId: activityId,
      details: { subject: activity.subject },
    });

    await TimelineService.recordEvent({
      organizationId,
      entityType: activity.entityType,
      entityId: activity.entityId,
      eventType: 'ACTIVITY_COMPLETED',
      summary: `Completed: [${activity.type}] ${activity.subject}`,
      metadata: { activityId },
    });

    return updated;
  }

  static async listActivities(organizationId, { entityType = null, entityId = null, userId = null, status = null, take = 50, skip = 0 } = {}) {
    const where = { organizationId };
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (userId) where.userId = userId;
    if (status) where.status = status;

    return await db.activities.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }
}

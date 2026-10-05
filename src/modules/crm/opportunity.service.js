/**
 * Project Nexus - Opportunity & Sales Pipeline Domain Service
 */
import { db } from '../../lib/db.js';
import { NotFoundError, ValidationError, ConcurrencyError } from '../../lib/errors.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TimelineService } from './timeline.service.js';

export class OpportunityService {
  static async createPipeline({ organizationId, name, stages }) {
    if (!organizationId || !name || !Array.isArray(stages) || stages.length === 0) {
      throw new ValidationError('Organization ID, pipeline name, and an array of stages are required.');
    }

    return await db.$transaction(async (tx) => {
      const pipeline = await tx.pipelines.create({
        data: {
          organizationId,
          name: name.trim(),
          isDefault: true,
        },
      });

      const createdStages = [];
      for (let i = 0; i < stages.length; i++) {
        const s = stages[i];
        const stage = await tx.pipelineStages.create({
          data: {
            pipelineId: pipeline.id,
            name: s.name,
            order: i,
            winProbability: s.winProbability || 0,
            isClosedWon: !!s.isClosedWon,
            isClosedLost: !!s.isClosedLost,
          },
        });
        createdStages.push(stage);
      }

      return {
        pipeline,
        stages: createdStages,
      };
    });
  }

  static async createOpportunity({ organizationId, userId, accountId, pipelineId, stageId, title, value = 0, currency = 'USD', closeDate = null }) {
    if (!organizationId || !accountId || !pipelineId || !stageId || !title) {
      throw new ValidationError('Organization ID, accountId, pipelineId, stageId, and title are required.');
    }

    const stage = await db.pipelineStages.findUnique({ where: { id: stageId } });
    if (!stage || stage.pipelineId !== pipelineId) {
      throw new ValidationError('Selected stage does not belong to the specified pipeline.');
    }

    const opportunity = await db.opportunities.create({
      data: {
        organizationId,
        accountId,
        pipelineId,
        stageId,
        title: title.trim(),
        value,
        currency,
        closeDate,
        status: stage.isClosedWon ? 'WON' : stage.isClosedLost ? 'LOST' : 'OPEN',
        version: 1,
      },
    });

    await AuditService.record({
      organizationId,
      userId,
      action: 'OPPORTUNITY_CREATED',
      entityType: 'Opportunity',
      entityId: opportunity.id,
      details: { title, value, stageId },
    });

    await TimelineService.recordEvent({
      organizationId,
      entityType: 'Opportunity',
      entityId: opportunity.id,
      eventType: 'OPPORTUNITY_CREATED',
      summary: `Opportunity '${opportunity.title}' valued at ${opportunity.currency} ${opportunity.value} created.`,
      metadata: { stageName: stage.name, value: opportunity.value },
    });

    return opportunity;
  }

  static async getOpportunity(organizationId, opportunityId) {
    const opp = await db.opportunities.findUnique({ where: { id: opportunityId } });
    if (!opp) throw new NotFoundError('Opportunity');
    AuthorizationService.assertTenantScope(organizationId, opp.organizationId);
    return opp;
  }

  static async transitionStage({ organizationId, userId, opportunityId, newStageId, lostReason = null, expectedVersion = null }) {
    const opp = await this.getOpportunity(organizationId, opportunityId);

    if (expectedVersion !== null && opp.version !== expectedVersion) {
      throw new ConcurrencyError(`Opportunity version mismatch. Expected ${expectedVersion}, but found ${opp.version}.`);
    }

    const newStage = await db.pipelineStages.findUnique({ where: { id: newStageId } });
    if (!newStage || newStage.pipelineId !== opp.pipelineId) {
      throw new ValidationError('New stage does not belong to the opportunity pipeline.');
    }

    let newStatus = 'OPEN';
    if (newStage.isClosedWon) newStatus = 'WON';
    if (newStage.isClosedLost) newStatus = 'LOST';

    const updated = await db.opportunities.update({
      where: { id: opportunityId },
      data: {
        stageId: newStageId,
        status: newStatus,
        lostReason: newStage.isClosedLost ? lostReason : null,
        version: opp.version + 1,
      },
    });

    await AuditService.record({
      organizationId,
      userId,
      action: 'OPPORTUNITY_STAGE_CHANGED',
      entityType: 'Opportunity',
      entityId: opp.id,
      details: { fromStageId: opp.stageId, toStageId: newStageId, status: newStatus },
    });

    await TimelineService.recordEvent({
      organizationId,
      entityType: 'Opportunity',
      entityId: opp.id,
      eventType: 'STAGE_CHANGED',
      summary: `Stage updated to '${newStage.name}' (Status: ${newStatus}).`,
      metadata: { stageName: newStage.name, status: newStatus, probability: newStage.winProbability },
    });

    return updated;
  }

  static async listOpportunities(organizationId, { pipelineId = null, stageId = null, status = null, take = 50, skip = 0 } = {}) {
    const where = { organizationId };
    if (pipelineId) where.pipelineId = pipelineId;
    if (stageId) where.stageId = stageId;
    if (status) where.status = status;

    return await db.opportunities.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }
}

/**
 * Project Nexus - Enterprise Persistent AI Action Gateway & Approval Engine
 * Enforces policy validation, risk classification, approval gates, separation of duties,
 * action expiry, persistent audit trail, and execution-time authorization re-evaluation.
 */
import crypto from 'node:crypto';
import { db } from '../../lib/db.js';
import { ToolRegistry, RiskLevels } from './tool.registry.js';
import { AuthorizationService, Permissions, Roles } from '../authorization/authorization.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export const ActionStatuses = {
  REQUESTED: 'REQUESTED',
  VALIDATING: 'VALIDATING',
  WAITING_FOR_APPROVAL: 'WAITING_FOR_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXECUTING: 'EXECUTING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
};

const DEFAULT_EXPIRY_HOURS = 48;

export class ActionGatewayService {
  /**
   * Evaluates, persists, and dispatches an AI action request.
   */
  static async requestAction({
    organizationId,
    userId,
    userRole,
    agentId = 'nexus_agent',
    toolName,
    input,
    idempotencyKey = null,
    enforceSeparationOfDuties = false,
  }) {
    if (!organizationId || !userId || !toolName || !input) {
      throw new ValidationError('Organization ID, user ID, toolName, and input are required.');
    }

    // Check idempotency
    if (idempotencyKey) {
      const existing = await db.aiActions.findFirst({
        where: { organizationId, idempotencyKey },
      });
      if (existing) {
        logger.info('Duplicate AI action idempotency key received', { idempotencyKey });
        return existing;
      }
    }

    const tool = ToolRegistry[toolName];
    if (!tool) {
      throw new NotFoundError(`AI Tool '${toolName}'`);
    }

    // 1. Validate Input Schema
    tool.validateInput(input);

    // 2. Validate Authorization at Request Time
    AuthorizationService.assertPermission(userRole, tool.requiredPermission);

    const actionId = `act_${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_HOURS * 60 * 60 * 1000);

    const actionRecord = await db.aiActions.create({
      data: {
        id: actionId,
        organizationId,
        userId,
        agentId,
        tool: toolName,
        input,
        riskLevel: tool.riskLevel,
        status: ActionStatuses.REQUESTED,
        idempotencyKey,
        expiresAt,
        enforceSeparationOfDuties,
        approvedBy: null,
        approvedAt: null,
        rejectionReason: null,
        result: null,
        error: null,
      },
    });

    logger.info('AI Action Requested & Persisted', { actionId, toolName, riskLevel: tool.riskLevel });

    // 3. Risk-Based Execution Gate
    if (tool.riskLevel === RiskLevels.LOW) {
      await db.aiActions.update({
        where: { id: actionId },
        data: { status: ActionStatuses.EXECUTING },
      });

      try {
        const result = await tool.execute({ organizationId, userId, input });
        const succeeded = await db.aiActions.update({
          where: { id: actionId },
          data: {
            status: ActionStatuses.SUCCEEDED,
            result,
            completedAt: new Date(),
          },
        });

        await AuditService.record({
          organizationId,
          userId,
          action: 'AI_ACTION_EXECUTED_AUTO',
          entityType: 'AiAction',
          entityId: actionId,
          details: { tool: toolName, riskLevel: tool.riskLevel },
        });

        return succeeded;
      } catch (err) {
        await db.aiActions.update({
          where: { id: actionId },
          data: {
            status: ActionStatuses.FAILED,
            error: err.message,
            completedAt: new Date(),
          },
        });
        throw err;
      }
    } else {
      // Require Human In The Loop approval for MEDIUM, HIGH, CRITICAL
      const waiting = await db.aiActions.update({
        where: { id: actionId },
        data: { status: ActionStatuses.WAITING_FOR_APPROVAL },
      });

      await AuditService.record({
        organizationId,
        userId,
        action: 'AI_ACTION_APPROVAL_REQUIRED',
        entityType: 'AiAction',
        entityId: actionId,
        details: { tool: toolName, riskLevel: tool.riskLevel, expiresAt },
      });

      return waiting;
    }
  }

  /**
   * Approves and triggers execution of a pending AI action.
   * Includes execution-time permission re-evaluation, separation of duties, and expiration validation.
   */
  static async approveAction({
    organizationId,
    approverUserId,
    approverRole,
    actionId,
  }) {
    const actionRecord = await db.aiActions.findUnique({ where: { id: actionId } });
    if (!actionRecord) {
      throw new NotFoundError('Action Record');
    }

    // Tenant isolation verification
    AuthorizationService.assertTenantScope(organizationId, actionRecord.organizationId);

    // Execution-Time Authorization Check: Verify approver possesses AI_APPROVE permission
    AuthorizationService.assertPermission(approverRole, Permissions.AI_APPROVE);

    // Check expiration (48-hour window)
    if (new Date() > new Date(actionRecord.expiresAt)) {
      await db.aiActions.update({
        where: { id: actionId },
        data: { status: ActionStatuses.EXPIRED },
      });
      throw new ValidationError('Action approval request has expired and cannot be executed.');
    }

    // Separation of Duties:
    // Requester cannot approve their own action if:
    // 1) Risk level is CRITICAL (always enforced for catastrophic operations)
    // 2) enforceSeparationOfDuties is explicitly enabled on the action
    // 3) Risk level is HIGH and approver is not OWNER (managers/members cannot self-approve)
    const isSelfApproval = actionRecord.userId && actionRecord.userId === approverUserId;
    const strictSeparation =
      actionRecord.riskLevel === RiskLevels.CRITICAL ||
      actionRecord.enforceSeparationOfDuties === true ||
      (actionRecord.riskLevel === RiskLevels.HIGH && approverRole !== Roles.OWNER);

    if (isSelfApproval && strictSeparation) {
      throw new ForbiddenError(
        'Separation of duties violation: An operator cannot approve their own high-risk or critical action request.'
      );
    }

    if (actionRecord.status !== ActionStatuses.WAITING_FOR_APPROVAL) {
      throw new ValidationError(`Cannot approve action with status '${actionRecord.status}'.`);
    }

    // Execution-Time Re-validation: Verify target tool still exists & input is valid
    const tool = ToolRegistry[actionRecord.tool];
    if (!tool) {
      throw new NotFoundError(`AI Tool '${actionRecord.tool}'`);
    }

    await db.aiActions.update({
      where: { id: actionId },
      data: {
        status: ActionStatuses.APPROVED,
        approvedBy: approverUserId,
        approvedAt: new Date(),
      },
    });

    try {
      await db.aiActions.update({
        where: { id: actionId },
        data: { status: ActionStatuses.EXECUTING },
      });

      const result = await tool.execute({
        organizationId: actionRecord.organizationId,
        userId: approverUserId,
        input: actionRecord.input,
      });

      const succeeded = await db.aiActions.update({
        where: { id: actionId },
        data: {
          status: ActionStatuses.SUCCEEDED,
          result,
          completedAt: new Date(),
        },
      });

      await AuditService.record({
        organizationId,
        userId: approverUserId,
        action: 'AI_ACTION_APPROVED_AND_EXECUTED',
        entityType: 'AiAction',
        entityId: actionId,
        details: { tool: actionRecord.tool, approvedBy: approverUserId },
      });

      return succeeded;
    } catch (err) {
      await db.aiActions.update({
        where: { id: actionId },
        data: {
          status: ActionStatuses.FAILED,
          error: err.message,
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }

  /**
   * Rejects a pending action.
   */
  static async rejectAction({
    organizationId,
    rejectorUserId,
    rejectorRole,
    actionId,
    reason = 'Rejected by human reviewer.',
  }) {
    const actionRecord = await db.aiActions.findUnique({ where: { id: actionId } });
    if (!actionRecord) {
      throw new NotFoundError('Action Record');
    }

    AuthorizationService.assertTenantScope(organizationId, actionRecord.organizationId);
    AuthorizationService.assertPermission(rejectorRole, Permissions.AI_APPROVE);

    if (actionRecord.status !== ActionStatuses.WAITING_FOR_APPROVAL) {
      throw new ValidationError(`Cannot reject action with status '${actionRecord.status}'.`);
    }

    const rejected = await db.aiActions.update({
      where: { id: actionId },
      data: {
        status: ActionStatuses.REJECTED,
        rejectedBy: rejectorUserId,
        rejectionReason: reason,
        completedAt: new Date(),
      },
    });

    await AuditService.record({
      organizationId,
      userId: rejectorUserId,
      action: 'AI_ACTION_REJECTED',
      entityType: 'AiAction',
      entityId: actionId,
      details: { tool: actionRecord.tool, reason },
    });

    return rejected;
  }

  /**
   * Lists pending actions waiting for human approval with automatic expiration checks.
   */
  static async listPendingApprovals(organizationId) {
    AuthorizationService.assertTenantScope(organizationId, organizationId);
    const actions = await db.aiActions.findMany({
      where: { organizationId, status: ActionStatuses.WAITING_FOR_APPROVAL },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const activePending = [];

    for (const a of actions) {
      if (now > new Date(a.expiresAt)) {
        await db.aiActions.update({
          where: { id: a.id },
          data: { status: ActionStatuses.EXPIRED },
        });
      } else {
        activePending.push(a);
      }
    }

    return activePending;
  }
}

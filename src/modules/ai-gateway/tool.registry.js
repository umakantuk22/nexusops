/**
 * Project Nexus - AI Tool Registry
 * Typed tools with strict parameter validation, explicit permissions, and risk tiers.
 */
import { Permissions } from '../authorization/authorization.service.js';
import { ActivityService } from '../crm/activity.service.js';
import { OpportunityService } from '../crm/opportunity.service.js';
import { AccountService } from '../crm/account.service.js';

export const RiskLevels = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};

export const ToolRegistry = {
  // Low Risk: Internal Note
  'crm.create_note': {
    name: 'crm.create_note',
    description: 'Creates an internal note or summary on a CRM record.',
    requiredPermission: Permissions.CRM_CREATE,
    riskLevel: RiskLevels.LOW,
    validateInput(input) {
      if (!input.entityType || !input.entityId || !input.note) {
        throw new Error("Missing required fields for crm.create_note: 'entityType', 'entityId', 'note'.");
      }
      return true;
    },
    async execute({ organizationId, userId, input }) {
      return await ActivityService.createActivity({
        organizationId,
        userId,
        entityType: input.entityType,
        entityId: input.entityId,
        type: 'NOTE',
        subject: input.subject || 'AI Generated Note',
        description: input.note,
      });
    },
  },

  // Medium Risk: Update Opportunity Stage (Human approval recommended/required)
  'crm.update_opportunity_stage': {
    name: 'crm.update_opportunity_stage',
    description: 'Updates the stage of an ongoing sales opportunity.',
    requiredPermission: Permissions.CRM_UPDATE,
    riskLevel: RiskLevels.MEDIUM,
    validateInput(input) {
      if (!input.opportunityId || !input.newStageId) {
        throw new Error("Missing required fields for crm.update_opportunity_stage: 'opportunityId', 'newStageId'.");
      }
      return true;
    },
    async execute({ organizationId, userId, input }) {
      return await OpportunityService.transitionStage({
        organizationId,
        userId,
        opportunityId: input.opportunityId,
        newStageId: input.newStageId,
        lostReason: input.lostReason || null,
      });
    },
  },

  // High Risk: Delete Account (Always requires explicit human authorization)
  'crm.delete_account': {
    name: 'crm.delete_account',
    description: 'Permanently deletes a customer account.',
    requiredPermission: Permissions.CRM_DELETE,
    riskLevel: RiskLevels.HIGH,
    validateInput(input) {
      if (!input.accountId) {
        throw new Error("Missing required field for crm.delete_account: 'accountId'.");
      }
      return true;
    },
    async execute({ organizationId, userId, input }) {
      return await AccountService.deleteAccount({
        organizationId,
        userId,
        accountId: input.accountId,
      });
    },
  },
};

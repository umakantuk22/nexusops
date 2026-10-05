/**
 * Project Nexus - API v1 Comprehensive REST Route Dispatcher
 * Provides complete HTTP REST surface for CRM, AI Gateway, Work Engine, Automation,
 * Audit Logs, CSV Import/Export, and Billing/Entitlements.
 */
import { IdentityService } from '../../modules/identity/identity.service.js';
import { OrganizationService } from '../../modules/organization/organization.service.js';
import { AccountService } from '../../modules/crm/account.service.js';
import { ContactService } from '../../modules/crm/contact.service.js';
import { LeadService } from '../../modules/crm/lead.service.js';
import { OpportunityService } from '../../modules/crm/opportunity.service.js';
import { ActivityService } from '../../modules/crm/activity.service.js';
import { TimelineService } from '../../modules/crm/timeline.service.js';
import { DealHealthService } from '../../modules/crm/deal_health.service.js';
import { CsvExportImportService } from '../../modules/crm/csv_export_import.service.js';
import { WorkService } from '../../modules/work-engine/work.service.js';
import { SearchService } from '../../modules/work-engine/search.service.js';
import { ActionGatewayService } from '../../modules/ai-gateway/action_gateway.service.js';
import { MeetingIntelligenceService } from '../../modules/ai-context/meeting_intelligence.service.js';
import { EmailService } from '../../modules/communication/email.service.js';
import { EntitlementService } from '../../modules/billing/entitlement.service.js';
import { AuditService } from '../../modules/audit/audit.service.js';
import {
  RequestContext,
  authenticateRequest,
  resolveTenantContext,
  requirePermission,
} from '../../middleware/auth.middleware.js';
import { Permissions } from '../../modules/authorization/authorization.service.js';
import { formatErrorResponse, ValidationError, NotFoundError } from '../../lib/errors.js';

export async function handleApiRequest(req) {
  const requestId = req.headers?.['x-request-id'] || `req_${Date.now()}`;

  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method.toUpperCase();
    const query = Object.fromEntries(url.searchParams.entries());

    // 1. Health check (Public)
    if (path === '/api/v1/health' && method === 'GET') {
      return {
        statusCode: 200,
        body: { status: 'healthy', version: 'v1.0.0', timestamp: new Date().toISOString() },
      };
    }

    // 2. AUTH ROUTES (Public)
    if (path === '/api/v1/auth/register' && method === 'POST') {
      const user = await IdentityService.register(req.body || {});
      return { statusCode: 201, body: { data: user } };
    }

    if (path === '/api/v1/auth/login' && method === 'POST') {
      const result = await IdentityService.authenticate(req.body || {});
      return { statusCode: 200, body: { data: result } };
    }

    // 3. AUTHENTICATED ROUTES
    const user = await authenticateRequest(req);

    if (path === '/api/v1/auth/me' && method === 'GET') {
      return { statusCode: 200, body: { data: user } };
    }

    if (path === '/api/v1/auth/logout' && method === 'POST') {
      const authHeader = req.headers?.authorization || '';
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      IdentityService.revokeSession(token);
      return { statusCode: 200, body: { message: 'Logged out successfully. Session revoked.' } };
    }

    // 4. ORGANIZATION ROUTES (User-scoped)
    if (path === '/api/v1/orgs' && method === 'POST') {
      const result = await OrganizationService.createOrganization({
        ...req.body,
        userId: user.id,
      });
      return { statusCode: 201, body: { data: result } };
    }

    if (path === '/api/v1/orgs' && method === 'GET') {
      const orgs = await OrganizationService.getUserOrganizations(user.id);
      return { statusCode: 200, body: { data: orgs } };
    }

    if (path === '/api/v1/orgs/invite/accept' && method === 'POST') {
      const result = await OrganizationService.acceptInvitation({
        token: req.body?.token,
        userId: user.id,
      });
      return { statusCode: 200, body: { data: result } };
    }

    // 5. TENANT-SCOPED PROTECTED ROUTES
    const tenantContext = await resolveTenantContext(req, user);
    const context = new RequestContext({
      requestId,
      user,
      organizationId: tenantContext.organizationId,
      role: tenantContext.role,
    });
    const orgId = context.organizationId;

    // --- MEMBERSHIP MANAGEMENT ---
    if (path === '/api/v1/members' && method === 'GET') {
      requirePermission(context, Permissions.MEMBER_VIEW);
      const members = await OrganizationService.listMembers(orgId, user.id);
      return { statusCode: 200, body: { data: members } };
    }

    if (path === '/api/v1/members/invite' && method === 'POST') {
      requirePermission(context, Permissions.MEMBER_INVITE);
      const invitation = await OrganizationService.inviteMember({
        organizationId: orgId,
        operatorUserId: user.id,
        email: req.body?.email,
        role: req.body?.role,
      });
      return { statusCode: 201, body: { data: invitation } };
    }

    if (path === '/api/v1/members/role' && method === 'PUT') {
      requirePermission(context, Permissions.MEMBER_UPDATE_ROLE);
      const updated = await OrganizationService.updateMemberRole({
        organizationId: orgId,
        operatorUserId: user.id,
        targetUserId: req.body?.targetUserId,
        newRole: req.body?.newRole,
      });
      return { statusCode: 200, body: { data: updated } };
    }

    if (path === '/api/v1/members' && method === 'DELETE') {
      requirePermission(context, Permissions.MEMBER_REMOVE);
      const result = await OrganizationService.removeMember({
        organizationId: orgId,
        operatorUserId: user.id,
        targetUserId: req.body?.targetUserId,
      });
      return { statusCode: 200, body: { data: result } };
    }

    // --- CRM: ACCOUNTS ---
    if (path === '/api/v1/accounts' && method === 'GET') {
      requirePermission(context, Permissions.CRM_READ);
      const accounts = await AccountService.listAccounts(orgId, {
        industry: query.industry,
        tier: query.tier,
        take: query.take ? parseInt(query.take, 10) : 50,
        skip: query.skip ? parseInt(query.skip, 10) : 0,
      });
      return { statusCode: 200, body: { data: accounts } };
    }

    if (path === '/api/v1/accounts' && method === 'POST') {
      requirePermission(context, Permissions.CRM_CREATE);
      const account = await AccountService.createAccount({
        organizationId: orgId,
        userId: user.id,
        ...req.body,
      });
      return { statusCode: 201, body: { data: account } };
    }

    const accountMatch = path.match(/^\/api\/v1\/accounts\/([a-zA-Z0-9_-]+)$/);
    if (accountMatch) {
      const accountId = accountMatch[1];
      if (method === 'GET') {
        requirePermission(context, Permissions.CRM_READ);
        const account = await AccountService.getAccount(orgId, accountId);
        return { statusCode: 200, body: { data: account } };
      }
      if (method === 'PUT') {
        requirePermission(context, Permissions.CRM_UPDATE);
        const updated = await AccountService.updateAccount({
          organizationId: orgId,
          accountId,
          userId: user.id,
          data: req.body?.data || req.body,
          expectedVersion: req.body?.expectedVersion,
        });
        return { statusCode: 200, body: { data: updated } };
      }
      if (method === 'DELETE') {
        requirePermission(context, Permissions.CRM_DELETE);
        const deleted = await AccountService.deleteAccount({
          organizationId: orgId,
          accountId,
          userId: user.id,
        });
        return { statusCode: 200, body: { data: deleted } };
      }
    }

    // --- CRM: CONTACTS ---
    if (path === '/api/v1/contacts' && method === 'GET') {
      requirePermission(context, Permissions.CRM_READ);
      const contacts = await ContactService.listContacts(orgId, {
        accountId: query.accountId,
        take: query.take ? parseInt(query.take, 10) : 50,
        skip: query.skip ? parseInt(query.skip, 10) : 0,
      });
      return { statusCode: 200, body: { data: contacts } };
    }

    if (path === '/api/v1/contacts' && method === 'POST') {
      requirePermission(context, Permissions.CRM_CREATE);
      await EntitlementService.assertQuotaWithinLimit(orgId, 'contacts');
      const contact = await ContactService.createContact({
        organizationId: orgId,
        userId: user.id,
        ...req.body,
      });
      EntitlementService.recordUsage(orgId, 'contacts', 1);
      return { statusCode: 201, body: { data: contact } };
    }

    const contactMatch = path.match(/^\/api\/v1\/contacts\/([a-zA-Z0-9_-]+)$/);
    if (contactMatch) {
      const contactId = contactMatch[1];
      if (method === 'GET') {
        requirePermission(context, Permissions.CRM_READ);
        const contact = await ContactService.getContact(orgId, contactId);
        return { statusCode: 200, body: { data: contact } };
      }
      if (method === 'PUT') {
        requirePermission(context, Permissions.CRM_UPDATE);
        const updated = await ContactService.updateContact({
          organizationId: orgId,
          contactId,
          userId: user.id,
          data: req.body?.data || req.body,
          expectedVersion: req.body?.expectedVersion,
        });
        return { statusCode: 200, body: { data: updated } };
      }
      if (method === 'DELETE') {
        requirePermission(context, Permissions.CRM_DELETE);
        const deleted = await ContactService.deleteContact({
          organizationId: orgId,
          contactId,
          userId: user.id,
        });
        return { statusCode: 200, body: { data: deleted } };
      }
    }

    // --- CRM: LEADS ---
    if (path === '/api/v1/leads' && method === 'GET') {
      requirePermission(context, Permissions.CRM_READ);
      const leads = await LeadService.listLeads(orgId, {
        status: query.status,
        take: query.take ? parseInt(query.take, 10) : 50,
        skip: query.skip ? parseInt(query.skip, 10) : 0,
      });
      return { statusCode: 200, body: { data: leads } };
    }

    if (path === '/api/v1/leads' && method === 'POST') {
      requirePermission(context, Permissions.CRM_CREATE);
      const lead = await LeadService.createLead({
        organizationId: orgId,
        userId: user.id,
        ...req.body,
      });
      return { statusCode: 201, body: { data: lead } };
    }

    const leadConvertMatch = path.match(/^\/api\/v1\/leads\/([a-zA-Z0-9_-]+)\/convert$/);
    if (leadConvertMatch && method === 'POST') {
      requirePermission(context, Permissions.CRM_UPDATE);
      const leadId = leadConvertMatch[1];
      const result = await LeadService.convertLead({
        organizationId: orgId,
        userId: user.id,
        leadId,
        dealTitle: req.body?.dealTitle,
        dealValue: req.body?.dealValue,
        pipelineId: req.body?.pipelineId,
        stageId: req.body?.stageId,
      });
      return { statusCode: 200, body: { data: result } };
    }

    const leadMatch = path.match(/^\/api\/v1\/leads\/([a-zA-Z0-9_-]+)$/);
    if (leadMatch) {
      const leadId = leadMatch[1];
      if (method === 'GET') {
        requirePermission(context, Permissions.CRM_READ);
        const lead = await LeadService.getLead(orgId, leadId);
        return { statusCode: 200, body: { data: lead } };
      }
      if (method === 'PUT') {
        requirePermission(context, Permissions.CRM_UPDATE);
        const updated = await LeadService.updateLead({
          organizationId: orgId,
          leadId,
          userId: user.id,
          data: req.body?.data || req.body,
          expectedVersion: req.body?.expectedVersion,
        });
        return { statusCode: 200, body: { data: updated } };
      }
      if (method === 'DELETE') {
        requirePermission(context, Permissions.CRM_DELETE);
        const deleted = await LeadService.deleteLead({
          organizationId: orgId,
          leadId,
          userId: user.id,
        });
        return { statusCode: 200, body: { data: deleted } };
      }
    }

    // --- CRM: OPPORTUNITIES ---
    if (path === '/api/v1/opportunities/stalled' && method === 'GET') {
      requirePermission(context, Permissions.CRM_READ);
      const thresholdDays = query.days ? parseInt(query.days, 10) : 14;
      const stalled = await DealHealthService.detectStalledDeals({ organizationId: orgId, thresholdDays });
      return { statusCode: 200, body: { data: stalled } };
    }

    if (path === '/api/v1/opportunities' && method === 'GET') {
      requirePermission(context, Permissions.CRM_READ);
      const opps = await OpportunityService.listOpportunities(orgId, {
        status: query.status,
        stageId: query.stageId,
        accountId: query.accountId,
        take: query.take ? parseInt(query.take, 10) : 50,
        skip: query.skip ? parseInt(query.skip, 10) : 0,
      });
      return { statusCode: 200, body: { data: opps } };
    }

    if (path === '/api/v1/opportunities' && method === 'POST') {
      requirePermission(context, Permissions.CRM_CREATE);
      await EntitlementService.assertQuotaWithinLimit(orgId, 'opportunities');
      const opp = await OpportunityService.createOpportunity({
        organizationId: orgId,
        userId: user.id,
        ...req.body,
      });
      EntitlementService.recordUsage(orgId, 'opportunities', 1);
      return { statusCode: 201, body: { data: opp } };
    }

    const oppStageMatch = path.match(/^\/api\/v1\/opportunities\/([a-zA-Z0-9_-]+)\/stage$/);
    if (oppStageMatch && method === 'PUT') {
      requirePermission(context, Permissions.CRM_UPDATE);
      const opportunityId = oppStageMatch[1];
      const updated = await OpportunityService.updateOpportunityStage({
        organizationId: orgId,
        userId: user.id,
        opportunityId,
        newStageId: req.body?.stageId,
        expectedVersion: req.body?.expectedVersion,
      });
      return { statusCode: 200, body: { data: updated } };
    }

    const oppMatch = path.match(/^\/api\/v1\/opportunities\/([a-zA-Z0-9_-]+)$/);
    if (oppMatch) {
      const opportunityId = oppMatch[1];
      if (method === 'GET') {
        requirePermission(context, Permissions.CRM_READ);
        const opp = await OpportunityService.getOpportunity(orgId, opportunityId);
        return { statusCode: 200, body: { data: opp } };
      }
      if (method === 'PUT') {
        requirePermission(context, Permissions.CRM_UPDATE);
        const updated = await OpportunityService.updateOpportunity({
          organizationId: orgId,
          opportunityId,
          userId: user.id,
          data: req.body?.data || req.body,
          expectedVersion: req.body?.expectedVersion,
        });
        return { statusCode: 200, body: { data: updated } };
      }
      if (method === 'DELETE') {
        requirePermission(context, Permissions.CRM_DELETE);
        const deleted = await OpportunityService.deleteOpportunity({
          organizationId: orgId,
          opportunityId,
          userId: user.id,
        });
        return { statusCode: 200, body: { data: deleted } };
      }
    }

    // --- CRM: ACTIVITIES & TIMELINE ---
    if (path === '/api/v1/activities' && method === 'GET') {
      requirePermission(context, Permissions.CRM_READ);
      const activities = await ActivityService.listActivities(orgId, {
        entityType: query.entityType,
        entityId: query.entityId,
        status: query.status,
        take: query.take ? parseInt(query.take, 10) : 50,
        skip: query.skip ? parseInt(query.skip, 10) : 0,
      });
      return { statusCode: 200, body: { data: activities } };
    }

    if (path === '/api/v1/activities' && method === 'POST') {
      requirePermission(context, Permissions.CRM_CREATE);
      const activity = await ActivityService.createActivity({
        organizationId: orgId,
        userId: user.id,
        ...req.body,
      });
      return { statusCode: 201, body: { data: activity } };
    }

    const actCompleteMatch = path.match(/^\/api\/v1\/activities\/([a-zA-Z0-9_-]+)\/complete$/);
    if (actCompleteMatch && method === 'POST') {
      requirePermission(context, Permissions.CRM_UPDATE);
      const activityId = actCompleteMatch[1];
      const completed = await ActivityService.completeActivity({
        organizationId: orgId,
        userId: user.id,
        activityId,
      });
      return { statusCode: 200, body: { data: completed } };
    }

    const timelineMatch = path.match(/^\/api\/v1\/timeline\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
    if (timelineMatch && method === 'GET') {
      requirePermission(context, Permissions.CRM_READ);
      const [, entityType, entityId] = timelineMatch;
      const timeline = await TimelineService.getTimeline({
        organizationId: orgId,
        entityType,
        entityId,
        take: query.take ? parseInt(query.take, 10) : 50,
        skip: query.skip ? parseInt(query.skip, 10) : 0,
      });
      return { statusCode: 200, body: { data: timeline } };
    }

    // --- WORK ENGINE & SEARCH ---
    if (path === '/api/v1/work-queue' && method === 'GET') {
      requirePermission(context, Permissions.WORK_VIEW);
      const queue = await WorkService.generateWorkQueue({
        organizationId: orgId,
        userId: user.id,
        take: query.take ? parseInt(query.take, 10) : 20,
      });
      return { statusCode: 200, body: { data: queue } };
    }

    if (path === '/api/v1/search' && method === 'GET') {
      requirePermission(context, Permissions.CRM_READ);
      const results = await SearchService.search({
        organizationId: orgId,
        query: query.q || '',
        take: query.take ? parseInt(query.take, 10) : 20,
      });
      return { statusCode: 200, body: { data: results } };
    }

    // --- AI ACTION GATEWAY & APPROVALS ---
    if (path === '/api/v1/ai/actions' && method === 'GET') {
      requirePermission(context, Permissions.AI_APPROVE);
      const pending = await ActionGatewayService.listPendingApprovals(orgId);
      return { statusCode: 200, body: { data: pending } };
    }

    if (path === '/api/v1/ai/actions' && method === 'POST') {
      requirePermission(context, Permissions.AI_RECOMMEND);
      await EntitlementService.assertFeatureEntitlement(orgId, 'ai.gateway');
      await EntitlementService.assertQuotaWithinLimit(orgId, 'aiActions');

      const action = await ActionGatewayService.requestAction({
        organizationId: orgId,
        userId: user.id,
        userRole: context.role,
        toolName: req.body?.toolName,
        input: req.body?.input,
        idempotencyKey: req.body?.idempotencyKey,
      });

      EntitlementService.recordUsage(orgId, 'aiActions', 1);
      return { statusCode: 201, body: { data: action } };
    }

    const aiApproveMatch = path.match(/^\/api\/v1\/ai\/actions\/([a-zA-Z0-9_-]+)\/approve$/);
    if (aiApproveMatch && method === 'POST') {
      requirePermission(context, Permissions.AI_APPROVE);
      const actionId = aiApproveMatch[1];
      const result = await ActionGatewayService.approveAction({
        organizationId: orgId,
        approverUserId: user.id,
        approverRole: context.role,
        actionId,
      });
      return { statusCode: 200, body: { data: result } };
    }

    const aiRejectMatch = path.match(/^\/api\/v1\/ai\/actions\/([a-zA-Z0-9_-]+)\/reject$/);
    if (aiRejectMatch && method === 'POST') {
      requirePermission(context, Permissions.AI_APPROVE);
      const actionId = aiRejectMatch[1];
      const result = await ActionGatewayService.rejectAction({
        organizationId: orgId,
        rejectorUserId: user.id,
        rejectorRole: context.role,
        actionId,
        reason: req.body?.reason,
      });
      return { statusCode: 200, body: { data: result } };
    }

    if (path === '/api/v1/ai/meeting' && method === 'POST') {
      requirePermission(context, Permissions.AI_RECOMMEND);
      await EntitlementService.assertFeatureEntitlement(orgId, 'ai.gateway');
      const analysis = await MeetingIntelligenceService.analyzeMeeting({
        organizationId: orgId,
        userId: user.id,
        entityType: req.body?.entityType,
        entityId: req.body?.entityId,
        meetingTitle: req.body?.meetingTitle,
        transcript: req.body?.transcript,
      });
      return { statusCode: 200, body: { data: analysis } };
    }

    if (path === '/api/v1/ai/email' && method === 'POST') {
      requirePermission(context, Permissions.AI_RECOMMEND);
      await EntitlementService.assertFeatureEntitlement(orgId, 'ai.gateway');
      const emailResult = await EmailService.ingestEmail({
        organizationId: orgId,
        fromEmail: req.body?.fromEmail,
        toEmail: req.body?.toEmail,
        subject: req.body?.subject,
        body: req.body?.body,
      });
      return { statusCode: 200, body: { data: emailResult } };
    }

    // --- CSV IMPORT / EXPORT ---
    if (path === '/api/v1/csv/leads/import' && method === 'POST') {
      requirePermission(context, Permissions.CRM_CREATE);
      const csvContent = typeof req.body === 'string' ? req.body : req.body?.csvContent;
      const result = await CsvExportImportService.importLeadsFromCsv({
        organizationId: orgId,
        userId: user.id,
        csvContent,
      });
      return { statusCode: 200, body: { data: result } };
    }

    if (path === '/api/v1/csv/accounts/export' && method === 'GET') {
      requirePermission(context, Permissions.CRM_READ);
      const csv = await CsvExportImportService.exportAccountsToCsv(orgId);
      return { statusCode: 200, body: { csv } };
    }

    // --- BILLING & ENTITLEMENTS ---
    if (path === '/api/v1/billing' && method === 'GET') {
      const summary = await EntitlementService.getBillingSummary(orgId);
      return { statusCode: 200, body: { data: summary } };
    }

    // --- AUDIT TRAIL & VERIFICATION ---
    if (path === '/api/v1/audit/verify' && method === 'GET') {
      requirePermission(context, Permissions.AUDIT_VIEW);
      const verification = await AuditService.verifyAuditIntegrity(orgId);
      return { statusCode: 200, body: { data: verification } };
    }

    if (path === '/api/v1/audit' && method === 'GET') {
      requirePermission(context, Permissions.AUDIT_VIEW);
      const logs = await AuditService.getLogs({
        organizationId: orgId,
        entityType: query.entityType,
        entityId: query.entityId,
        take: query.take ? parseInt(query.take, 10) : 50,
        skip: query.skip ? parseInt(query.skip, 10) : 0,
      });
      return { statusCode: 200, body: { data: logs } };
    }

    throw new NotFoundError(`Endpoint '${method} ${path}'`);
  } catch (error) {
    return formatErrorResponse(error, requestId);
  }
}

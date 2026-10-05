/**
 * Project Nexus - Lead & Qualification Domain Service
 */
import { db } from '../../lib/db.js';
import { NotFoundError, ValidationError, ConflictError } from '../../lib/errors.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TimelineService } from './timeline.service.js';
import { AccountService } from './account.service.js';
import { ContactService } from './contact.service.js';

export class LeadService {
  static async createLead({ organizationId, userId, firstName, lastName, email, company, source = 'inbound' }) {
    if (!organizationId || !firstName || !lastName || !email || !company) {
      throw new ValidationError('Organization ID, first name, last name, email, and company are required.');
    }

    const lead = await db.leads.create({
      data: {
        organizationId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.toLowerCase().trim(),
        company: company.trim(),
        status: 'NEW',
        score: 10,
        source,
        version: 1,
      },
    });

    await AuditService.record({
      organizationId,
      userId,
      action: 'LEAD_CREATED',
      entityType: 'Lead',
      entityId: lead.id,
      details: { email: lead.email, company: lead.company },
    });

    await TimelineService.recordEvent({
      organizationId,
      entityType: 'Lead',
      entityId: lead.id,
      eventType: 'LEAD_CREATED',
      summary: `Lead '${lead.firstName} ${lead.lastName}' from '${lead.company}' received.`,
      metadata: { source: lead.source, score: lead.score },
    });

    return lead;
  }

  static async getLead(organizationId, leadId) {
    const lead = await db.leads.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundError('Lead');
    AuthorizationService.assertTenantScope(organizationId, lead.organizationId);
    return lead;
  }

  static async qualifyLead({ organizationId, userId, leadId, score = 50 }) {
    const lead = await this.getLead(organizationId, leadId);

    if (lead.status === 'CONVERTED') {
      throw new ConflictError('Cannot re-qualify an already converted lead.');
    }

    const updated = await db.leads.update({
      where: { id: leadId },
      data: {
        status: score >= 50 ? 'QUALIFIED' : 'CONTACTED',
        score,
        version: lead.version + 1,
      },
    });

    await TimelineService.recordEvent({
      organizationId,
      entityType: 'Lead',
      entityId: leadId,
      eventType: 'LEAD_QUALIFIED',
      summary: `Lead status updated to ${updated.status} (Score: ${score}).`,
      metadata: { score, status: updated.status },
    });

    return updated;
  }

  /**
   * Atomically converts a qualified lead into Account, Contact, and Opportunity.
   */
  static async convertLead({ organizationId, userId, leadId, dealTitle = null, dealValue = 0, pipelineId = null, stageId = null }) {
    const lead = await this.getLead(organizationId, leadId);

    if (lead.status === 'CONVERTED') {
      throw new ConflictError('Lead is already converted.');
    }

    return await db.$transaction(async (tx) => {
      // 1. Create or link Account
      const account = await tx.accounts.create({
        data: {
          organizationId,
          name: lead.company,
          tier: 'SMB',
          healthScore: 100,
          version: 1,
        },
      });

      // 2. Create Contact
      const contact = await tx.contacts.create({
        data: {
          organizationId,
          accountId: account.id,
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          version: 1,
        },
      });

      // 3. Create Opportunity if details provided
      let opportunity = null;
      if (dealTitle && pipelineId && stageId) {
        opportunity = await tx.opportunities.create({
          data: {
            organizationId,
            accountId: account.id,
            pipelineId,
            stageId,
            title: dealTitle,
            value: dealValue,
            currency: 'USD',
            status: 'OPEN',
            version: 1,
          },
        });
      }

      // 4. Update Lead to CONVERTED
      const updatedLead = await tx.leads.update({
        where: { id: leadId },
        data: {
          status: 'CONVERTED',
          convertedAccountId: account.id,
          convertedOpportunityId: opportunity ? opportunity.id : null,
          version: lead.version + 1,
        },
      });

      // 5. Timeline & Audit
      await AuditService.record({
        organizationId,
        userId,
        action: 'LEAD_CONVERTED',
        entityType: 'Lead',
        entityId: leadId,
        details: {
          accountId: account.id,
          contactId: contact.id,
          opportunityId: opportunity ? opportunity.id : null,
        },
      });

      await TimelineService.recordEvent({
        organizationId,
        entityType: 'Lead',
        entityId: leadId,
        eventType: 'LEAD_CONVERTED',
        summary: `Lead converted to Account '${account.name}' and Contact '${contact.firstName} ${contact.lastName}'.`,
        metadata: { accountId: account.id, contactId: contact.id },
      });

      return {
        lead: updatedLead,
        account,
        contact,
        opportunity,
      };
    });
  }
}

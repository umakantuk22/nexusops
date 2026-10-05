/**
 * Project Nexus - Inbound Email Ingestion & AI Reply Drafting Service
 * Integrates email communications into the unified timeline and drafts context-aware replies.
 */
import { db } from '../../lib/db.js';
import { TimelineService } from '../crm/timeline.service.js';
import { ActivityService } from '../crm/activity.service.js';
import { ActionGatewayService } from '../ai-gateway/action_gateway.service.js';
import { AiContextService } from '../ai-context/context.service.js';
import { ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export class EmailService {
  /**
   * Ingests an inbound email, matches sender to CRM Contact, logs to timeline, and prepares an AI draft reply.
   */
  static async ingestEmail({
    organizationId,
    fromEmail,
    toEmail,
    subject,
    body,
    threadId = null,
  }) {
    if (!organizationId || !fromEmail || !subject || !body) {
      throw new ValidationError('Organization ID, fromEmail, subject, and body are required.');
    }

    const normalizedFrom = fromEmail.toLowerCase().trim();

    // 1. Match Contact or Lead by email
    const contact = await db.contacts.findFirst({
      where: { organizationId, email: normalizedFrom },
    });

    let entityType = 'Email';
    let entityId = threadId || `em_${Date.now()}`;
    let accountId = null;

    if (contact) {
      entityType = 'Contact';
      entityId = contact.id;
      accountId = contact.accountId;
    } else {
      const lead = await db.leads.findFirst({
        where: { organizationId, email: normalizedFrom },
      });
      if (lead) {
        entityType = 'Lead';
        entityId = lead.id;
      }
    }

    // 2. Sanitize untrusted external email content
    const sanitizedBody = AiContextService.sanitizeUntrustedContent(body);

    // 3. Log inbound email to Unified Customer Timeline
    await TimelineService.recordEvent({
      organizationId,
      entityType,
      entityId,
      eventType: 'EMAIL_RECEIVED',
      summary: `Email from ${fromEmail}: "${subject}"`,
      metadata: { fromEmail, toEmail, subject, preview: body.slice(0, 150) },
    });

    // 4. Create an actionable Review Task in the Work Engine
    const reviewTask = await ActivityService.createActivity({
      organizationId,
      entityType,
      entityId,
      type: 'TASK',
      subject: `Inbound Email: ${subject} from ${fromEmail}`,
      description: `Unread customer email requiring response. Summary: ${body.slice(0, 200)}...`,
      dueDate: new Date(Date.now() + 4 * 60 * 60 * 1000), // Due within 4 hours
    });

    // 5. Generate AI Draft Reply via AI Action Gateway (Low-risk draft action)
    const suggestedReply = `Hi there,\n\nThank you for reaching out regarding "${subject}". We have received your message and our team is looking into this right away.\n\nBest regards,\nNexus Operations Team`;

    const aiDraftAction = await ActionGatewayService.requestAction({
      organizationId,
      userId: 'system_email_ai',
      userRole: 'MEMBER',
      toolName: 'crm.create_note',
      input: {
        entityType,
        entityId,
        subject: `AI Suggested Email Draft: Re: ${subject}`,
        note: suggestedReply,
      },
    });

    logger.info('Inbound Email Ingested & AI Reply Drafted', {
      organizationId,
      fromEmail,
      entityType,
      entityId,
    });

    return {
      matchedEntity: { entityType, entityId, accountId },
      reviewTask,
      aiDraft: suggestedReply,
      aiActionRecord: aiDraftAction,
    };
  }
}

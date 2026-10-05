/**
 * Project Nexus - Contact Domain Service
 */
import { db } from '../../lib/db.js';
import { NotFoundError, ValidationError, ConcurrencyError } from '../../lib/errors.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TimelineService } from './timeline.service.js';

export class ContactService {
  static async createContact({ organizationId, userId, accountId = null, firstName, lastName, email, phone = null, title = null }) {
    if (!organizationId || !firstName || !lastName || !email) {
      throw new ValidationError('Organization ID, first name, last name, and email are required.');
    }

    if (accountId) {
      const account = await db.accounts.findUnique({ where: { id: accountId } });
      if (!account) throw new NotFoundError('Account');
      AuthorizationService.assertTenantScope(organizationId, account.organizationId);
    }

    const contact = await db.contacts.create({
      data: {
        organizationId,
        accountId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.toLowerCase().trim(),
        phone,
        title,
        version: 1,
      },
    });

    await AuditService.record({
      organizationId,
      userId,
      action: 'CONTACT_CREATED',
      entityType: 'Contact',
      entityId: contact.id,
      details: { email: contact.email, accountId },
    });

    await TimelineService.recordEvent({
      organizationId,
      entityType: 'Contact',
      entityId: contact.id,
      eventType: 'CONTACT_CREATED',
      summary: `Contact '${contact.firstName} ${contact.lastName}' was created.`,
      metadata: { email: contact.email, title: contact.title },
    });

    if (accountId) {
      await TimelineService.recordEvent({
        organizationId,
        entityType: 'Account',
        entityId: accountId,
        eventType: 'CONTACT_LINKED',
        summary: `Contact '${contact.firstName} ${contact.lastName}' linked to Account.`,
        metadata: { contactId: contact.id },
      });
    }

    return contact;
  }

  static async getContact(organizationId, contactId) {
    const contact = await db.contacts.findUnique({ where: { id: contactId } });
    if (!contact) throw new NotFoundError('Contact');
    AuthorizationService.assertTenantScope(organizationId, contact.organizationId);
    return contact;
  }

  static async listContacts(organizationId, { accountId = null, take = 50, skip = 0 } = {}) {
    const where = { organizationId };
    if (accountId) where.accountId = accountId;

    return await db.contacts.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  static async updateContact({ organizationId, userId, contactId, expectedVersion = null, data }) {
    const contact = await this.getContact(organizationId, contactId);

    if (expectedVersion !== null && contact.version !== expectedVersion) {
      throw new ConcurrencyError(`Contact version mismatch. Expected ${expectedVersion}, but found ${contact.version}.`);
    }

    const updated = await db.contacts.update({
      where: { id: contactId },
      data: {
        ...data,
        version: contact.version + 1,
      },
    });

    await AuditService.record({
      organizationId,
      userId,
      action: 'CONTACT_UPDATED',
      entityType: 'Contact',
      entityId: contact.id,
      details: data,
    });

    return updated;
  }
}

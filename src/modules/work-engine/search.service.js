/**
 * Project Nexus - Unified Cross-Entity Search Engine
 */
import { db } from '../../lib/db.js';
import { AuthorizationService } from '../authorization/authorization.service.js';

export class SearchService {
  /**
   * Performs tenant-isolated full search across CRM entities.
   */
  static async search(organizationId, query, { limit = 20 } = {}) {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return [];
    }

    AuthorizationService.assertTenantScope(organizationId, organizationId);
    const q = query.toLowerCase().trim();
    const results = [];

    // Search Accounts
    const accounts = await db.accounts.findMany({ where: { organizationId } });
    for (const a of accounts) {
      if (a.name.toLowerCase().includes(q) || (a.industry && a.industry.toLowerCase().includes(q))) {
        results.push({
          entityType: 'Account',
          id: a.id,
          title: a.name,
          subtitle: `${a.tier} • ${a.industry || 'No Industry'}`,
          url: `/crm/accounts/${a.id}`,
        });
      }
    }

    // Search Contacts
    const contacts = await db.contacts.findMany({ where: { organizationId } });
    for (const c of contacts) {
      const fullName = `${c.firstName} ${c.lastName}`.toLowerCase();
      if (fullName.includes(q) || c.email.toLowerCase().includes(q)) {
        results.push({
          entityType: 'Contact',
          id: c.id,
          title: `${c.firstName} ${c.lastName}`,
          subtitle: `${c.email} • ${c.title || 'No Title'}`,
          url: `/crm/contacts/${c.id}`,
        });
      }
    }

    // Search Leads
    const leads = await db.leads.findMany({ where: { organizationId } });
    for (const l of leads) {
      const fullName = `${l.firstName} ${l.lastName}`.toLowerCase();
      if (fullName.includes(q) || l.company.toLowerCase().includes(q) || l.email.toLowerCase().includes(q)) {
        results.push({
          entityType: 'Lead',
          id: l.id,
          title: `${l.firstName} ${l.lastName}`,
          subtitle: `${l.company} • Score: ${l.score} (${l.status})`,
          url: `/crm/leads/${l.id}`,
        });
      }
    }

    // Search Opportunities
    const opportunities = await db.opportunities.findMany({ where: { organizationId } });
    for (const o of opportunities) {
      if (o.title.toLowerCase().includes(q)) {
        results.push({
          entityType: 'Opportunity',
          id: o.id,
          title: o.title,
          subtitle: `${o.currency} ${o.value} • Status: ${o.status}`,
          url: `/crm/opportunities/${o.id}`,
        });
      }
    }

    return results.slice(0, limit);
  }
}

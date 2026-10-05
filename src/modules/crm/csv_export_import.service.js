/**
 * Project Nexus - CSV Bulk Import & Export Service
 * Provides tenant-isolated, schema-validated bulk data import and export.
 */
import { db } from '../../lib/db.js';
import { LeadService } from './lead.service.js';
import { AccountService } from './account.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export class CsvExportImportService {
  /**
   * Imports Leads from CSV text.
   * Format: firstName,lastName,email,company,source
   */
  static async importLeadsFromCsv({ organizationId, userId, csvContent }) {
    if (!organizationId || !csvContent) {
      throw new ValidationError('Organization ID and CSV content are required.');
    }

    AuthorizationService.assertTenantScope(organizationId, organizationId);

    const lines = csvContent
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length <= 1) {
      throw new ValidationError('CSV content must contain a header and at least one data row.');
    }

    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const emailIndex = header.indexOf('email');
    const firstNameIndex = header.indexOf('firstname');
    const lastNameIndex = header.indexOf('lastname');
    const companyIndex = header.indexOf('company');
    const sourceIndex = header.indexOf('source');

    if (emailIndex === -1 || firstNameIndex === -1 || companyIndex === -1) {
      throw new ValidationError("CSV header must include 'firstName', 'email', and 'company'.");
    }

    const createdLeads = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      if (cols.length < header.length) continue;

      const email = cols[emailIndex];
      const firstName = cols[firstNameIndex];
      const lastName = lastNameIndex !== -1 ? cols[lastNameIndex] : '';
      const company = cols[companyIndex];
      const source = sourceIndex !== -1 ? cols[sourceIndex] : 'csv_import';

      try {
        const lead = await LeadService.createLead({
          organizationId,
          userId,
          firstName,
          lastName,
          email,
          company,
          source,
        });
        createdLeads.push(lead);
      } catch (err) {
        errors.push({ row: i + 1, email, error: err.message });
      }
    }

    logger.info('CSV Leads Import Completed', {
      organizationId,
      totalRows: lines.length - 1,
      importedCount: createdLeads.length,
      errorsCount: errors.length,
    });

    return {
      totalRows: lines.length - 1,
      importedCount: createdLeads.length,
      createdLeads,
      errors,
    };
  }

  /**
   * Exports all tenant Accounts to CSV string.
   */
  static async exportAccountsToCsv(organizationId) {
    AuthorizationService.assertTenantScope(organizationId, organizationId);

    const accounts = await db.accounts.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const header = 'id,name,industry,website,tier,healthScore,createdAt';
    const rows = accounts.map((a) => {
      const isoDate = a.createdAt instanceof Date ? a.createdAt.toISOString() : new Date(a.createdAt).toISOString();
      return `"${a.id}","${a.name}","${a.industry || ''}","${a.website || ''}","${a.tier}","${a.healthScore}","${isoDate}"`;
    });

    return [header, ...rows].join('\n');
  }
}

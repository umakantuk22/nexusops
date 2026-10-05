import test from 'node:test';
import assert from 'node:assert';
import { db } from '../../src/lib/db.js';
import { CsvExportImportService } from '../../src/modules/crm/csv_export_import.service.js';
import { AccountService } from '../../src/modules/crm/account.service.js';
import { IdentityService } from '../../src/modules/identity/identity.service.js';
import { AuthorizationService, Roles } from '../../src/modules/authorization/authorization.service.js';
import { UnauthorizedError } from '../../src/lib/errors.js';

test('Unit & Integration: CSV Import/Export, Token Revocation, and Field-Level Security', async () => {
  await db.clearAll();

  const orgId = 'org_csv_fls_test';
  const userId = 'usr_csv_1';

  // 1. CSV Leads Import
  const csvContent = `
    firstName,lastName,email,company,source
    Alex,Johnson,alex@innovate.com,Innovate Corp,conference
    Elena,Rostova,elena@quant.io,Quant AI,inbound_web
  `;

  const importResult = await CsvExportImportService.importLeadsFromCsv({
    organizationId: orgId,
    userId,
    csvContent,
  });

  assert.strictEqual(importResult.importedCount, 2);
  assert.strictEqual(importResult.errors.length, 0);

  // 2. CSV Accounts Export
  await AccountService.createAccount({
    organizationId: orgId,
    userId,
    name: 'Apollo Systems',
    industry: 'Aerospace',
    tier: 'ENTERPRISE',
  });

  const exportedCsv = await CsvExportImportService.exportAccountsToCsv(orgId);
  assert.ok(exportedCsv.includes('Apollo Systems'));
  assert.ok(exportedCsv.includes('Aerospace'));

  // 3. Immediate Session Revocation
  const user = await IdentityService.register({
    email: 'revoke_test@nexus.io',
    password: 'Password1234!',
    name: 'Revoke User',
  });

  const auth = await IdentityService.authenticate({
    email: 'revoke_test@nexus.io',
    password: 'Password1234!',
  });

  // Verify token works
  const verifiedUser = await IdentityService.verifySession(auth.token);
  assert.strictEqual(verifiedUser.id, user.id);

  // Revoke token immediately
  IdentityService.revokeSession(auth.token);
  assert.strictEqual(IdentityService.isTokenRevoked(auth.token), true);

  // Verify token is rejected
  await assert.rejects(
    async () => {
      await IdentityService.verifySession(auth.token);
    },
    (err) => err instanceof UnauthorizedError && err.message.includes('Session has been revoked')
  );

  // 4. Field-Level Security (FLS)
  const sensitiveOpportunity = {
    id: 'opp_sec_1',
    title: 'Top Secret Defense Deal',
    value: 5000000,
    status: 'OPEN',
  };

  // VIEWER role viewing Opportunity: value must be filtered out
  const viewerSanitized = AuthorizationService.filterRestrictedFields(Roles.VIEWER, 'Opportunity', sensitiveOpportunity);
  assert.strictEqual(viewerSanitized.value, undefined, 'Financial value must be stripped for VIEWER role');
  assert.strictEqual(viewerSanitized.title, 'Top Secret Defense Deal');

  // OWNER role viewing Opportunity: value is retained
  const ownerSanitized = AuthorizationService.filterRestrictedFields(Roles.OWNER, 'Opportunity', sensitiveOpportunity);
  assert.strictEqual(ownerSanitized.value, 5000000, 'Financial value must be visible to OWNER');
});

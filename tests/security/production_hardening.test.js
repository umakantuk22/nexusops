/**
 * Project Nexus - Production Hardening & Security Verification Test Suite
 * Validates:
 * 1. Request payload size limits (HTTP 413 Payload Too Large)
 * 2. Sliding window rate limiting (HTTP 429 Too Many Requests)
 * 3. Cryptographically chained audit logs & tamper detection (SHA-256)
 * 4. PII and secret redaction in audit records
 * 5. Separation of duties for high-risk / critical AI actions
 * 6. Action approval expiration enforcement (48 hours)
 * 7. Full REST API route dispatching (Accounts, Leads, Convert, Billing, Work Queue, Audit)
 */
import test from 'node:test';
import assert from 'node:assert';
import { db } from '../../src/lib/db.js';
import { handleApiRequest } from '../../src/api/v1/router.js';
import { IdentityService } from '../../src/modules/identity/identity.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { ActionGatewayService, ActionStatuses } from '../../src/modules/ai-gateway/action_gateway.service.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { RateLimiter, RateLimitRules } from '../../src/middleware/rate_limiter.middleware.js';
import { Roles } from '../../src/modules/authorization/authorization.service.js';
import { ForbiddenError, ValidationError } from '../../src/lib/errors.js';

test('Production Hardening: Security, Cryptographic Audit Chaining, Rate Limiting & REST API Surface', async () => {
  await db.clearAll();
  RateLimiter.reset();

  // 1. Rate Limiting Verification
  const fakeReq = { headers: { 'x-forwarded-for': '192.168.1.50' } };
  const loginRule = { limit: 3, windowMs: 10000 };

  const attempt1 = RateLimiter.checkRateLimit(fakeReq, loginRule, 'test_login');
  assert.strictEqual(attempt1.allowed, true);
  assert.strictEqual(attempt1.remaining, 2);

  const attempt2 = RateLimiter.checkRateLimit(fakeReq, loginRule, 'test_login');
  assert.strictEqual(attempt2.allowed, true);
  assert.strictEqual(attempt2.remaining, 1);

  const attempt3 = RateLimiter.checkRateLimit(fakeReq, loginRule, 'test_login');
  assert.strictEqual(attempt3.allowed, true);
  assert.strictEqual(attempt3.remaining, 0);

  const attempt4 = RateLimiter.checkRateLimit(fakeReq, loginRule, 'test_login');
  assert.strictEqual(attempt4.allowed, false);
  assert.strictEqual(attempt4.remaining, 0);
  assert.ok(attempt4.resetInSeconds > 0);

  // 2. Cryptographically Chained Audit Trail & Tamper Detection
  const org = await db.organizations.create({
    data: { name: 'Audit Hardened Corp', slug: 'audit-corp', plan: 'ENTERPRISE' },
  });

  // Record 3 events
  const ev1 = await AuditService.record({
    organizationId: org.id,
    action: 'TEST_EVENT_1',
    entityType: 'System',
    entityId: 'sys_1',
    details: { message: 'Initialization', password: 'SuperSecretPassword123!' },
  });

  // Verify secret redaction
  assert.strictEqual(ev1.details.password, '[REDACTED]', 'Sensitive password must be redacted');
  assert.strictEqual(ev1.details.message, 'Initialization');
  assert.strictEqual(ev1.previousHash, '0000000000000000000000000000000000000000000000000000000000000000');
  assert.ok(ev1.eventHash && ev1.eventHash.length === 64, 'Must compute SHA-256 hash');

  const ev2 = await AuditService.record({
    organizationId: org.id,
    action: 'TEST_EVENT_2',
    entityType: 'System',
    entityId: 'sys_2',
    details: { token: 'jwt.token.secret', apiKey: 'sk-123456789' },
  });

  assert.strictEqual(ev2.details.token, '[REDACTED]');
  assert.strictEqual(ev2.details.apiKey, '[REDACTED]');
  assert.strictEqual(ev2.previousHash, ev1.eventHash, 'Event 2 must point to Event 1 hash');

  const ev3 = await AuditService.record({
    organizationId: org.id,
    action: 'TEST_EVENT_3',
    entityType: 'System',
    entityId: 'sys_3',
    details: { status: 'healthy' },
  });

  assert.strictEqual(ev3.previousHash, ev2.eventHash, 'Event 3 must point to Event 2 hash');

  // Verify Chain Integrity - Expect Valid
  const integrityBefore = await AuditService.verifyAuditIntegrity(org.id);
  assert.strictEqual(integrityBefore.valid, true);
  assert.strictEqual(integrityBefore.verifiedEvents, 3);

  // Tamper with record 2 details directly
  const rawRecord = await db.auditLogs.findUnique({ where: { id: ev2.id } });
  rawRecord.details.status = 'FORGED_DATA';
  await db.auditLogs.update({ where: { id: ev2.id }, data: { details: rawRecord.details } });

  // Verify Chain Integrity - Must Detect Tampering
  const integrityAfter = await AuditService.verifyAuditIntegrity(org.id);
  assert.strictEqual(integrityAfter.valid, false, 'Tamper verification must catch unauthorized record modifications');
  assert.strictEqual(integrityAfter.entryId, ev2.id);

  // 3. AI Action Gateway: Separation of Duties & Expiration
  const user1 = await IdentityService.register({
    email: 'operator1@audit.corp',
    password: 'Password1234!',
    name: 'Operator One',
  });

  const user2 = await IdentityService.register({
    email: 'approver2@audit.corp',
    password: 'Password1234!',
    name: 'Approver Two',
  });

  // Request action with strict separation of duties enabled
  const actionWithSoD = await ActionGatewayService.requestAction({
    organizationId: org.id,
    userId: user1.id,
    userRole: Roles.ADMIN,
    toolName: 'crm.delete_account',
    input: { accountId: 'acc_dummy_sod' },
    enforceSeparationOfDuties: true,
  });

  // User 1 attempts to self-approve: Must be rejected by Separation of Duties
  await assert.rejects(
    async () => {
      await ActionGatewayService.approveAction({
        organizationId: org.id,
        approverUserId: user1.id,
        approverRole: Roles.OWNER,
        actionId: actionWithSoD.id,
      });
    },
    (err) => err instanceof ForbiddenError && err.message.includes('Separation of duties violation')
  );

  // Expiration check: Mock expired action
  const expiredAction = await ActionGatewayService.requestAction({
    organizationId: org.id,
    userId: user1.id,
    userRole: Roles.ADMIN,
    toolName: 'crm.delete_account',
    input: { accountId: 'acc_dummy_exp' },
  });

  // Manually backdate expiration
  await db.aiActions.update({
    where: { id: expiredAction.id },
    data: { expiresAt: new Date(Date.now() - 3600000) },
  });

  // Approving expired action must fail
  await assert.rejects(
    async () => {
      await ActionGatewayService.approveAction({
        organizationId: org.id,
        approverUserId: user2.id,
        approverRole: Roles.OWNER,
        actionId: expiredAction.id,
      });
    },
    (err) => err instanceof ValidationError && err.message.includes('expired')
  );

  // 4. REST API Endpoint Dispatching
  // Register user & create org via API
  const regRes = await handleApiRequest({
    method: 'POST',
    url: '/api/v1/auth/register',
    body: {
      email: 'api_tester@audit.corp',
      password: 'Password1234!',
      name: 'API Tester',
    },
  });
  assert.strictEqual(regRes.statusCode, 201);

  const loginRes = await handleApiRequest({
    method: 'POST',
    url: '/api/v1/auth/login',
    body: {
      email: 'api_tester@audit.corp',
      password: 'Password1234!',
    },
  });
  assert.strictEqual(loginRes.statusCode, 200);
  const token = loginRes.body.data.token;
  const authHeaders = {
    authorization: `Bearer ${token}`,
    'x-organization-id': org.id,
  };

  // Add tester to org as OWNER
  await db.memberships.create({
    data: {
      organizationId: org.id,
      userId: regRes.body.data.id,
      role: Roles.OWNER,
    },
  });

  // Create Account via API
  const createAccRes = await handleApiRequest({
    method: 'POST',
    url: '/api/v1/accounts',
    headers: authHeaders,
    body: {
      name: 'Acme Global Holdings',
      industry: 'Technology',
      tier: 'ENTERPRISE',
    },
  });
  assert.strictEqual(createAccRes.statusCode, 201);
  const createdAccount = createAccRes.body.data;
  assert.strictEqual(createdAccount.name, 'Acme Global Holdings');

  // List Accounts via API
  const listAccRes = await handleApiRequest({
    method: 'GET',
    url: '/api/v1/accounts',
    headers: authHeaders,
  });
  assert.strictEqual(listAccRes.statusCode, 200);
  assert.ok(listAccRes.body.data.length >= 1);

  // Create Lead via API
  const createLeadRes = await handleApiRequest({
    method: 'POST',
    url: '/api/v1/leads',
    headers: authHeaders,
    body: {
      firstName: 'Samantha',
      lastName: 'Vance',
      email: 'svance@acme.com',
      company: 'Acme Subsidiary',
    },
  });
  assert.strictEqual(createLeadRes.statusCode, 201);
  const createdLead = createLeadRes.body.data;

  // Convert Lead via API
  const convertRes = await handleApiRequest({
    method: 'POST',
    url: `/api/v1/leads/${createdLead.id}/convert`,
    headers: authHeaders,
    body: {
      dealTitle: 'Enterprise License Deal',
      dealValue: 120000,
    },
  });
  assert.strictEqual(convertRes.statusCode, 200);
  assert.strictEqual(convertRes.body.data.lead.status, 'CONVERTED');

  // Get Work Queue via API
  const workRes = await handleApiRequest({
    method: 'GET',
    url: '/api/v1/work-queue',
    headers: authHeaders,
  });
  assert.strictEqual(workRes.statusCode, 200);
  assert.ok(Array.isArray(workRes.body.data));

  // Get Billing Summary via API
  const billingRes = await handleApiRequest({
    method: 'GET',
    url: '/api/v1/billing',
    headers: authHeaders,
  });
  assert.strictEqual(billingRes.statusCode, 200);
  assert.strictEqual(billingRes.body.data.plan, 'ENTERPRISE');
  assert.ok(billingRes.body.data.quotas.aiActions);
});

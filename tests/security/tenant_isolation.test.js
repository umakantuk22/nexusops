import test from 'node:test';
import assert from 'node:assert';
import { db } from '../../src/lib/db.js';
import { IdentityService } from '../../src/modules/identity/identity.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { handleApiRequest } from '../../src/api/v1/router.js';

test('Security: Multi-tenant boundary isolation & RBAC enforcement via API', async () => {
  await db.clearAll();

  // Create User 1 & Tenant 1
  const user1 = await IdentityService.register({
    email: 'tenant1_owner@company1.com',
    password: 'Password123!',
    name: 'Owner 1',
  });
  const auth1 = await IdentityService.authenticate({
    email: 'tenant1_owner@company1.com',
    password: 'Password123!',
  });
  const org1Result = await OrganizationService.createOrganization({
    name: 'Tenant 1 Org',
    slug: 'tenant-1-org',
    userId: user1.id,
  });
  const org1Id = org1Result.organization.id;

  // Create User 2 & Tenant 2
  const user2 = await IdentityService.register({
    email: 'tenant2_owner@company2.com',
    password: 'Password123!',
    name: 'Owner 2',
  });
  const auth2 = await IdentityService.authenticate({
    email: 'tenant2_owner@company2.com',
    password: 'Password123!',
  });
  const org2Result = await OrganizationService.createOrganization({
    name: 'Tenant 2 Org',
    slug: 'tenant-2-org',
    userId: user2.id,
  });
  const org2Id = org2Result.organization.id;

  // SCENARIO 1: User 1 attempts cross-tenant request to Tenant 2
  // Sending User 1's token with Tenant 2's Org ID header
  const crossTenantReq = {
    method: 'GET',
    url: '/api/v1/members',
    headers: {
      Authorization: `Bearer ${auth1.token}`,
      'X-Organization-Id': org2Id,
    },
  };

  const response1 = await handleApiRequest(crossTenantReq);
  assert.strictEqual(response1.statusCode, 403);
  assert.strictEqual(response1.body.error.code, 'TENANT_ISOLATION_VIOLATION');

  // SCENARIO 2: User 2 legitimately accesses Tenant 2
  const legitimateReq = {
    method: 'GET',
    url: '/api/v1/members',
    headers: {
      Authorization: `Bearer ${auth2.token}`,
      'X-Organization-Id': org2Id,
    },
  };

  const response2 = await handleApiRequest(legitimateReq);
  assert.strictEqual(response2.statusCode, 200);
  assert.strictEqual(response2.body.data.length, 1);
  assert.strictEqual(response2.body.data[0].email, 'tenant2_owner@company2.com');

  // SCENARIO 3: Role-based privilege escalation prevention
  // Invite User 3 as VIEWER into Tenant 1
  const user3 = await IdentityService.register({
    email: 'viewer@company1.com',
    password: 'Password123!',
    name: 'Viewer Member',
  });
  const auth3 = await IdentityService.authenticate({
    email: 'viewer@company1.com',
    password: 'Password123!',
  });

  const invite = await OrganizationService.inviteMember({
    organizationId: org1Id,
    operatorUserId: user1.id,
    email: 'viewer@company1.com',
    role: 'VIEWER',
  });

  await OrganizationService.acceptInvitation({
    token: invite.token,
    userId: user3.id,
  });

  // Viewer attempts to invite another member (Requires MEMBER_INVITE permission)
  const viewerUnauthorizedInviteReq = {
    method: 'POST',
    url: '/api/v1/members/invite',
    headers: {
      Authorization: `Bearer ${auth3.token}`,
      'X-Organization-Id': org1Id,
    },
    body: {
      email: 'hacker@outside.com',
      role: 'ADMIN',
    },
  };

  const response3 = await handleApiRequest(viewerUnauthorizedInviteReq);
  assert.strictEqual(response3.statusCode, 403);
  assert.strictEqual(response3.body.error.code, 'FORBIDDEN');
});

import test from 'node:test';
import assert from 'node:assert';
import { db } from '../../src/lib/db.js';
import { IdentityService } from '../../src/modules/identity/identity.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import { Roles } from '../../src/modules/authorization/authorization.service.js';

test('Integration: Identity & Organization Lifecycle', async () => {
  await db.clearAll();

  // 1. User Registration
  const userA = await IdentityService.register({
    email: 'alice@nexus.corp',
    password: 'SecurePassword123!',
    name: 'Alice Founder',
  });

  assert.ok(userA.id, 'User must have an ID');
  assert.strictEqual(userA.email, 'alice@nexus.corp');

  // 2. User Authentication
  const authA = await IdentityService.authenticate({
    email: 'alice@nexus.corp',
    password: 'SecurePassword123!',
  });

  assert.ok(authA.token, 'Token must be provided on login');
  assert.strictEqual(authA.user.id, userA.id);

  // 3. Organization Creation (Atomic Org + Owner Membership + Audit)
  const orgCreation = await OrganizationService.createOrganization({
    name: 'Nexus Corp',
    slug: 'nexus-corp',
    userId: userA.id,
  });

  assert.ok(orgCreation.organization.id);
  assert.strictEqual(orgCreation.organization.slug, 'nexus-corp');
  assert.strictEqual(orgCreation.membership.role, Roles.OWNER);

  // 4. Verify user organizations
  const userAOrgs = await OrganizationService.getUserOrganizations(userA.id);
  assert.strictEqual(userAOrgs.length, 1);
  assert.strictEqual(userAOrgs[0].role, Roles.OWNER);

  // 5. Register User B (Invitee)
  const userB = await IdentityService.register({
    email: 'bob@nexus.corp',
    password: 'BobSecurePassword123!',
    name: 'Bob Operator',
  });

  // 6. Invite User B as MEMBER
  const invitation = await OrganizationService.inviteMember({
    organizationId: orgCreation.organization.id,
    operatorUserId: userA.id,
    email: 'bob@nexus.corp',
    role: Roles.MEMBER,
  });

  assert.strictEqual(invitation.status, 'PENDING');
  assert.ok(invitation.token);

  // 7. User B accepts invitation
  const membershipB = await OrganizationService.acceptInvitation({
    token: invitation.token,
    userId: userB.id,
  });

  assert.strictEqual(membershipB.role, Roles.MEMBER);
  assert.strictEqual(membershipB.userId, userB.id);

  // 8. List Members
  const members = await OrganizationService.listMembers(orgCreation.organization.id, userA.id);
  assert.strictEqual(members.length, 2);

  // 9. Update User B role to MANAGER
  const updatedB = await OrganizationService.updateMemberRole({
    organizationId: orgCreation.organization.id,
    operatorUserId: userA.id,
    targetUserId: userB.id,
    newRole: Roles.MANAGER,
  });

  assert.strictEqual(updatedB.role, Roles.MANAGER);

  // 10. Audit Log Verification
  const auditLogs = await AuditService.getLogs({
    organizationId: orgCreation.organization.id,
  });

  assert.ok(auditLogs.length >= 4, 'Audit logs must capture org creation, invite, accept, and role update');
  const actions = auditLogs.map((l) => l.action);
  assert.ok(actions.includes('ORG_CREATED'));
  assert.ok(actions.includes('MEMBER_INVITED'));
  assert.ok(actions.includes('INVITATION_ACCEPTED'));
  assert.ok(actions.includes('MEMBER_ROLE_UPDATED'));

  // 11. Safeguard: Prevent removing the only OWNER
  await assert.rejects(
    async () => {
      await OrganizationService.updateMemberRole({
        organizationId: orgCreation.organization.id,
        operatorUserId: userA.id,
        targetUserId: userA.id,
        newRole: Roles.MEMBER,
      });
    },
    { message: /Cannot demote the only remaining Owner/ }
  );
});

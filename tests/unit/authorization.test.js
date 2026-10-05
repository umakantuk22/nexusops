import test from 'node:test';
import assert from 'node:assert';
import { AuthorizationService, Roles, Permissions } from '../../src/modules/authorization/authorization.service.js';
import { ForbiddenError, TenantIsolationError } from '../../src/lib/errors.js';

test('Authorization: Role hierarchy and permissions evaluation', () => {
  // OWNER has all permissions
  assert.strictEqual(AuthorizationService.hasPermission(Roles.OWNER, Permissions.ORG_DELETE), true);
  assert.strictEqual(AuthorizationService.hasPermission(Roles.OWNER, Permissions.MEMBER_INVITE), true);
  assert.strictEqual(AuthorizationService.hasPermission(Roles.OWNER, Permissions.CRM_DELETE), true);

  // ADMIN permissions
  assert.strictEqual(AuthorizationService.hasPermission(Roles.ADMIN, Permissions.MEMBER_INVITE), true);
  assert.strictEqual(AuthorizationService.hasPermission(Roles.ADMIN, Permissions.CRM_DELETE), true);
  assert.strictEqual(AuthorizationService.hasPermission(Roles.ADMIN, Permissions.ORG_DELETE), false);

  // MANAGER permissions
  assert.strictEqual(AuthorizationService.hasPermission(Roles.MANAGER, Permissions.CRM_CREATE), true);
  assert.strictEqual(AuthorizationService.hasPermission(Roles.MANAGER, Permissions.MEMBER_INVITE), true);
  assert.strictEqual(AuthorizationService.hasPermission(Roles.MANAGER, Permissions.CRM_DELETE), false);

  // MEMBER permissions
  assert.strictEqual(AuthorizationService.hasPermission(Roles.MEMBER, Permissions.CRM_READ), true);
  assert.strictEqual(AuthorizationService.hasPermission(Roles.MEMBER, Permissions.CRM_CREATE), true);
  assert.strictEqual(AuthorizationService.hasPermission(Roles.MEMBER, Permissions.MEMBER_INVITE), false);

  // VIEWER permissions
  assert.strictEqual(AuthorizationService.hasPermission(Roles.VIEWER, Permissions.CRM_READ), true);
  assert.strictEqual(AuthorizationService.hasPermission(Roles.VIEWER, Permissions.CRM_CREATE), false);
  assert.strictEqual(AuthorizationService.hasPermission(Roles.VIEWER, Permissions.MEMBER_INVITE), false);
});

test('Authorization: assertPermission throws ForbiddenError on unauthorized access', () => {
  assert.throws(
    () => {
      AuthorizationService.assertPermission(Roles.VIEWER, Permissions.CRM_DELETE);
    },
    (err) => err instanceof ForbiddenError && err.code === 'FORBIDDEN'
  );
});

test('Authorization: assertTenantScope detects and blocks cross-tenant violations', () => {
  // Matching tenants should pass
  assert.doesNotThrow(() => {
    AuthorizationService.assertTenantScope('org_tenant_1', 'org_tenant_1');
  });

  // Mismatched tenants should immediately throw TenantIsolationError
  assert.throws(
    () => {
      AuthorizationService.assertTenantScope('org_tenant_1', 'org_tenant_2');
    },
    (err) => err instanceof TenantIsolationError && err.code === 'TENANT_ISOLATION_VIOLATION'
  );

  // Missing tenant IDs must also throw
  assert.throws(
    () => {
      AuthorizationService.assertTenantScope(null, 'org_tenant_2');
    },
    (err) => err instanceof TenantIsolationError
  );
});

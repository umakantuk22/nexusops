/**
 * Project Nexus - Role-Based Access Control (RBAC) & Tenant Isolation Engine
 */
import { ForbiddenError, TenantIsolationError } from '../../lib/errors.js';

export const Roles = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER',
};

export const Permissions = {
  // Organization
  ORG_VIEW: 'org:view',
  ORG_UPDATE: 'org:update',
  ORG_DELETE: 'org:delete',

  // Members & Roles
  MEMBER_VIEW: 'member:view',
  MEMBER_INVITE: 'member:invite',
  MEMBER_UPDATE_ROLE: 'member:update_role',
  MEMBER_REMOVE: 'member:remove',

  // Core CRM
  CRM_READ: 'crm:read',
  CRM_CREATE: 'crm:create',
  CRM_UPDATE: 'crm:update',
  CRM_DELETE: 'crm:delete',

  // Work Engine
  WORK_VIEW: 'work:view',
  WORK_ASSIGN: 'work:assign',
  WORK_UPDATE: 'work:update',

  // AI & Action Gateway
  AI_RECOMMEND: 'ai:recommend',
  AI_APPROVE: 'ai:approve',
  AI_EXECUTE: 'ai:execute',

  // Audit Logs
  AUDIT_VIEW: 'audit:view',
};

const ROLE_PERMISSIONS = {
  [Roles.OWNER]: Object.values(Permissions),
  [Roles.ADMIN]: [
    Permissions.ORG_VIEW,
    Permissions.ORG_UPDATE,
    Permissions.MEMBER_VIEW,
    Permissions.MEMBER_INVITE,
    Permissions.MEMBER_UPDATE_ROLE,
    Permissions.MEMBER_REMOVE,
    Permissions.CRM_READ,
    Permissions.CRM_CREATE,
    Permissions.CRM_UPDATE,
    Permissions.CRM_DELETE,
    Permissions.WORK_VIEW,
    Permissions.WORK_ASSIGN,
    Permissions.WORK_UPDATE,
    Permissions.AI_RECOMMEND,
    Permissions.AI_APPROVE,
    Permissions.AI_EXECUTE,
    Permissions.AUDIT_VIEW,
  ],
  [Roles.MANAGER]: [
    Permissions.ORG_VIEW,
    Permissions.MEMBER_VIEW,
    Permissions.MEMBER_INVITE,
    Permissions.CRM_READ,
    Permissions.CRM_CREATE,
    Permissions.CRM_UPDATE,
    Permissions.WORK_VIEW,
    Permissions.WORK_ASSIGN,
    Permissions.WORK_UPDATE,
    Permissions.AI_RECOMMEND,
    Permissions.AI_APPROVE,
    Permissions.AUDIT_VIEW,
  ],
  [Roles.MEMBER]: [
    Permissions.ORG_VIEW,
    Permissions.MEMBER_VIEW,
    Permissions.CRM_READ,
    Permissions.CRM_CREATE,
    Permissions.CRM_UPDATE,
    Permissions.WORK_VIEW,
    Permissions.WORK_UPDATE,
    Permissions.AI_RECOMMEND,
  ],
  [Roles.VIEWER]: [
    Permissions.ORG_VIEW,
    Permissions.MEMBER_VIEW,
    Permissions.CRM_READ,
    Permissions.WORK_VIEW,
  ],
};

// Field-Level Security (FLS) restriction rules
const RESTRICTED_FIELDS = {
  Opportunity: {
    // Only Managers, Admins, and Owners can view financial deal values
    value: [Roles.OWNER, Roles.ADMIN, Roles.MANAGER],
  },
  Account: {
    // Internal health score hidden from viewers
    healthScore: [Roles.OWNER, Roles.ADMIN, Roles.MANAGER, Roles.MEMBER],
  },
};

export class AuthorizationService {
  /**
   * Checks if a given role has the requested permission.
   */
  static hasPermission(role, permission) {
    if (!role || !ROLE_PERMISSIONS[role]) {
      return false;
    }
    return ROLE_PERMISSIONS[role].includes(permission);
  }

  /**
   * Asserts that a given role has the requested permission, throwing ForbiddenError if not.
   */
  static assertPermission(role, permission) {
    if (!this.hasPermission(role, permission)) {
      throw new ForbiddenError(`Role '${role}' is not authorized to perform '${permission}'.`);
    }
  }

  /**
   * Defense-in-depth: Asserts that an operation's requested resource belongs strictly to the active tenant.
   */
  static assertTenantScope(activeTenantId, targetResourceTenantId) {
    if (!activeTenantId || !targetResourceTenantId) {
      throw new TenantIsolationError('Missing tenant scope context in authorization check.');
    }
    if (activeTenantId !== targetResourceTenantId) {
      throw new TenantIsolationError(
        `Cross-tenant boundary breach: Active tenant '${activeTenantId}' attempted access to tenant '${targetResourceTenantId}'.`
      );
    }
  }

  /**
   * Field-Level Security (FLS): Filters out sensitive attributes if role lacks access.
   */
  static filterRestrictedFields(role, entityType, data) {
    if (!data || typeof data !== 'object') return data;
    const rules = RESTRICTED_FIELDS[entityType];
    if (!rules) return data;

    const sanitized = { ...data };
    for (const [field, allowedRoles] of Object.entries(rules)) {
      if (!allowedRoles.includes(role)) {
        delete sanitized[field];
      }
    }
    return sanitized;
  }
}

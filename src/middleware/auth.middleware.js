/**
 * Project Nexus - Authentication, Tenancy & Security Middleware
 */
import { IdentityService } from '../modules/identity/identity.service.js';
import { db } from '../lib/db.js';
import { UnauthorizedError, ForbiddenError, TenantIsolationError } from '../lib/errors.js';
import { AuthorizationService } from '../modules/authorization/authorization.service.js';
import crypto from 'node:crypto';

export class RequestContext {
  constructor({ requestId = null, user = null, organizationId = null, role = null } = {}) {
    this.requestId = requestId || `req_${crypto.randomUUID().slice(0, 12)}`;
    this.user = user;
    this.organizationId = organizationId;
    this.role = role;
  }
}

/**
 * Extracts and verifies the bearer token from the request.
 */
export async function authenticateRequest(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid Authorization header.');
  }

  const token = authHeader.split(' ')[1];
  const user = await IdentityService.verifySession(token);
  return user;
}

/**
 * Resolves the tenant context and verifies user membership in the organization.
 */
export async function resolveTenantContext(req, user) {
  const orgHeader = req.headers?.['x-organization-id'] || req.headers?.['X-Organization-Id'];
  if (!orgHeader) {
    throw new ForbiddenError("Missing required tenant header: 'X-Organization-Id'.");
  }

  const membership = await db.memberships.findFirst({
    where: {
      organizationId: orgHeader,
      userId: user.id,
    },
  });

  if (!membership) {
    throw new TenantIsolationError("User is not a member of the requested organization tenant.");
  }

  return {
    organizationId: orgHeader,
    role: membership.role,
  };
}

/**
 * Enforces permission requirement on the current request context.
 */
export function requirePermission(context, permission) {
  if (!context || !context.role) {
    throw new ForbiddenError('Unauthorized: Missing active tenant context.');
  }
  AuthorizationService.assertPermission(context.role, permission);
}

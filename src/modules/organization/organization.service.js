/**
 * Project Nexus - Organization & Multi-Tenancy Domain Service
 */
import { db } from '../../lib/db.js';
import { generateSecureToken } from '../../lib/crypto.js';
import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from '../../lib/errors.js';
import { Roles, Permissions, AuthorizationService } from '../authorization/authorization.service.js';
import { AuditService } from '../audit/audit.service.js';

export class OrganizationService {
  /**
   * Atomically creates a new tenant Organization and assigns the creator as OWNER.
   */
  static async createOrganization({ name, slug, userId }) {
    if (!name || !slug || !userId) {
      throw new ValidationError('Organization name, slug, and userId are required.');
    }

    const normalizedSlug = slug.toLowerCase().trim();

    // Verify slug uniqueness
    const existing = await db.organizations.findUnique({
      where: { slug: normalizedSlug },
    });
    if (existing) {
      throw new ConflictError(`Organization slug '${normalizedSlug}' is already taken.`);
    }

    // Execute atomic creation in transaction
    return await db.$transaction(async (tx) => {
      const org = await tx.organizations.create({
        data: {
          name: name.trim(),
          slug: normalizedSlug,
          plan: 'free',
        },
      });

      const membership = await tx.memberships.create({
        data: {
          organizationId: org.id,
          userId,
          role: Roles.OWNER,
        },
      });

      await AuditService.record({
        organizationId: org.id,
        userId,
        action: 'ORG_CREATED',
        entityType: 'Organization',
        entityId: org.id,
        details: { name: org.name, slug: org.slug },
      });

      return {
        organization: org,
        membership,
      };
    });
  }

  /**
   * Lists all organizations where the specified user is a member.
   */
  static async getUserOrganizations(userId) {
    const memberships = await db.memberships.findMany({
      where: { userId },
    });

    const orgsWithRoles = [];
    for (const m of memberships) {
      const org = await db.organizations.findUnique({
        where: { id: m.organizationId },
      });
      if (org) {
        orgsWithRoles.push({
          id: org.id,
          name: org.name,
          slug: org.slug,
          plan: org.plan,
          role: m.role,
          joinedAt: m.createdAt,
        });
      }
    }

    return orgsWithRoles;
  }

  /**
   * Retrieves an organization by ID with membership validation.
   */
  static async getOrganization(organizationId, requestingUserId) {
    const membership = await db.memberships.findFirst({
      where: { organizationId, userId: requestingUserId },
    });

    if (!membership) {
      throw new ForbiddenError('You are not a member of this organization.');
    }

    const org = await db.organizations.findUnique({
      where: { id: organizationId },
    });

    if (!org) {
      throw new NotFoundError('Organization');
    }

    return {
      organization: org,
      role: membership.role,
    };
  }

  /**
   * Lists all members within an organization.
   */
  static async listMembers(organizationId, requestingUserId) {
    const requesterMembership = await db.memberships.findFirst({
      where: { organizationId, userId: requestingUserId },
    });

    if (!requesterMembership) {
      throw new ForbiddenError('You do not belong to this organization.');
    }

    AuthorizationService.assertPermission(requesterMembership.role, Permissions.MEMBER_VIEW);

    const memberships = await db.memberships.findMany({
      where: { organizationId },
    });

    const memberDetails = [];
    for (const m of memberships) {
      const user = await db.users.findUnique({ where: { id: m.userId } });
      if (user) {
        memberDetails.push({
          membershipId: m.id,
          userId: user.id,
          email: user.email,
          name: user.name,
          role: m.role,
          joinedAt: m.createdAt,
        });
      }
    }

    return memberDetails;
  }

  /**
   * Issues an invitation to join the organization.
   */
  static async inviteMember({ organizationId, operatorUserId, email, role = Roles.MEMBER }) {
    if (!organizationId || !operatorUserId || !email) {
      throw new ValidationError('Missing required parameters to invite member.');
    }

    const operatorMembership = await db.memberships.findFirst({
      where: { organizationId, userId: operatorUserId },
    });

    if (!operatorMembership) {
      throw new ForbiddenError('Operator is not a member of this organization.');
    }

    AuthorizationService.assertPermission(operatorMembership.role, Permissions.MEMBER_INVITE);

    const normalizedEmail = email.toLowerCase().trim();

    // Check if the user is already a member
    const existingUser = await db.users.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      const existingMembership = await db.memberships.findFirst({
        where: { organizationId, userId: existingUser.id },
      });
      if (existingMembership) {
        throw new ConflictError('User is already a member of this organization.');
      }
    }

    const token = generateSecureToken(24);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await db.invitations.create({
      data: {
        organizationId,
        email: normalizedEmail,
        role,
        token,
        expiresAt,
        status: 'PENDING',
      },
    });

    await AuditService.record({
      organizationId,
      userId: operatorUserId,
      action: 'MEMBER_INVITED',
      entityType: 'Invitation',
      entityId: invitation.id,
      details: { email: normalizedEmail, role },
    });

    return invitation;
  }

  /**
   * Accepts an invitation and provisions organization membership.
   */
  static async acceptInvitation({ token, userId }) {
    if (!token || !userId) {
      throw new ValidationError('Token and userId are required to accept invitation.');
    }

    const invitation = await db.invitations.findUnique({
      where: { token },
    });

    if (!invitation) {
      throw new NotFoundError('Invitation');
    }

    if (invitation.status !== 'PENDING') {
      throw new ConflictError(`Invitation is already ${invitation.status}.`);
    }

    if (new Date() > new Date(invitation.expiresAt)) {
      await db.invitations.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });
      throw new ValidationError('Invitation has expired.');
    }

    const user = await db.users.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundError('User');
    }

    return await db.$transaction(async (tx) => {
      // Check if already a member
      const existingMembership = await tx.memberships.findFirst({
        where: { organizationId: invitation.organizationId, userId },
      });

      if (existingMembership) {
        throw new ConflictError('User is already a member of this organization.');
      }

      const membership = await tx.memberships.create({
        data: {
          organizationId: invitation.organizationId,
          userId,
          role: invitation.role,
        },
      });

      await tx.invitations.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED' },
      });

      await AuditService.record({
        organizationId: invitation.organizationId,
        userId,
        action: 'INVITATION_ACCEPTED',
        entityType: 'Membership',
        entityId: membership.id,
        details: { role: invitation.role },
      });

      return membership;
    });
  }

  /**
   * Updates an existing member's role with safeguards protecting the last OWNER.
   */
  static async updateMemberRole({ organizationId, operatorUserId, targetUserId, newRole }) {
    const operatorMembership = await db.memberships.findFirst({
      where: { organizationId, userId: operatorUserId },
    });

    if (!operatorMembership) {
      throw new ForbiddenError('Operator is not a member of this organization.');
    }

    AuthorizationService.assertPermission(operatorMembership.role, Permissions.MEMBER_UPDATE_ROLE);

    const targetMembership = await db.memberships.findFirst({
      where: { organizationId, userId: targetUserId },
    });

    if (!targetMembership) {
      throw new NotFoundError('Target Membership');
    }

    // Safeguard: Do not demote the last OWNER
    if (targetMembership.role === Roles.OWNER && newRole !== Roles.OWNER) {
      const ownerCount = (
        await db.memberships.findMany({
          where: { organizationId, role: Roles.OWNER },
        })
      ).length;

      if (ownerCount <= 1) {
        throw new ForbiddenError('Cannot demote the only remaining Owner in the organization.');
      }
    }

    const updated = await db.memberships.update({
      where: { id: targetMembership.id },
      data: { role: newRole },
    });

    await AuditService.record({
      organizationId,
      userId: operatorUserId,
      action: 'MEMBER_ROLE_UPDATED',
      entityType: 'Membership',
      entityId: targetMembership.id,
      details: { previousRole: targetMembership.role, newRole },
    });

    return updated;
  }

  /**
   * Removes a member from an organization.
   */
  static async removeMember({ organizationId, operatorUserId, targetUserId }) {
    const operatorMembership = await db.memberships.findFirst({
      where: { organizationId, userId: operatorUserId },
    });

    if (!operatorMembership) {
      throw new ForbiddenError('Operator is not a member of this organization.');
    }

    AuthorizationService.assertPermission(operatorMembership.role, Permissions.MEMBER_REMOVE);

    const targetMembership = await db.memberships.findFirst({
      where: { organizationId, userId: targetUserId },
    });

    if (!targetMembership) {
      throw new NotFoundError('Target Membership');
    }

    // Safeguard: Cannot remove the last OWNER
    if (targetMembership.role === Roles.OWNER) {
      const ownerCount = (
        await db.memberships.findMany({
          where: { organizationId, role: Roles.OWNER },
        })
      ).length;

      if (ownerCount <= 1) {
        throw new ForbiddenError('Cannot remove the only remaining Owner in the organization.');
      }
    }

    await db.memberships.delete({
      where: { id: targetMembership.id },
    });

    await AuditService.record({
      organizationId,
      userId: operatorUserId,
      action: 'MEMBER_REMOVED',
      entityType: 'Membership',
      entityId: targetMembership.id,
      details: { removedUserId: targetUserId },
    });

    return { success: true };
  }
}

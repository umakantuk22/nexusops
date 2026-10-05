/**
 * Project Nexus - Non-Destructive Database Seed Engine
 * Guarantees zero data loss on restart: only seeds if database is uninitialized,
 * unless force=true is explicitly requested.
 */
import { db } from '../lib/db.js';
import { IdentityService } from '../modules/identity/identity.service.js';
import { OrganizationService } from '../modules/organization/organization.service.js';
import { AccountService } from '../modules/crm/account.service.js';
import { ContactService } from '../modules/crm/contact.service.js';
import { LeadService } from '../modules/crm/lead.service.js';
import { OpportunityService } from '../modules/crm/opportunity.service.js';
import { ActivityService } from '../modules/crm/activity.service.js';
import { ActionGatewayService } from '../modules/ai-gateway/action_gateway.service.js';
import { Roles } from '../modules/authorization/authorization.service.js';
import { logger } from '../lib/logger.js';

export async function seedDemoDatabase({ force = false } = {}) {
  // Check if database is already initialized
  const existingUsersCount = (await db.users.findMany()).length;
  if (existingUsersCount > 0 && !force) {
    logger.info('Database already contains records. Skipping destructive seed to preserve live tenant data.', {
      existingUsersCount,
    });
    return null;
  }

  if (force) {
    logger.warn('Force re-seed requested. Wiping existing database records...');
    await db.clearAll();
  }

  // 1. Create Admin User & Tenant
  const admin = await IdentityService.register({
    email: 'alex.morgan@nexusops.com',
    password: 'Password123!',
    name: 'Alex Morgan',
  });

  const orgResult = await OrganizationService.createOrganization({
    name: 'Nexus Enterprise Ops',
    slug: 'nexus-enterprise',
    userId: admin.id,
  });
  const orgId = orgResult.organization.id;

  // 2. Create Accounts
  const acc1 = await AccountService.createAccount({
    organizationId: orgId,
    userId: admin.id,
    name: 'Stripe Global',
    industry: 'Financial Infrastructure',
    website: 'https://stripe.com',
    tier: 'ENTERPRISE',
    healthScore: 94,
  });

  const acc2 = await AccountService.createAccount({
    organizationId: orgId,
    userId: admin.id,
    name: 'Linear App',
    industry: 'Developer Tools',
    website: 'https://linear.app',
    tier: 'MID_MARKET',
    healthScore: 68,
  });

  const acc3 = await AccountService.createAccount({
    organizationId: orgId,
    userId: admin.id,
    name: 'Vercel Cloud',
    industry: 'Cloud Infrastructure',
    website: 'https://vercel.com',
    tier: 'ENTERPRISE',
    healthScore: 42, // Critical risk
  });

  // 3. Create Contacts
  await ContactService.createContact({
    organizationId: orgId,
    userId: admin.id,
    accountId: acc1.id,
    firstName: 'Patrick',
    lastName: 'Collison',
    email: 'patrick@stripe.com',
    title: 'Chief Executive Officer',
  });

  await ContactService.createContact({
    organizationId: orgId,
    userId: admin.id,
    accountId: acc2.id,
    firstName: 'Karri',
    lastName: 'Saarinen',
    email: 'karri@linear.app',
    title: 'Head of Product',
  });

  // 4. Create Leads
  await LeadService.createLead({
    organizationId: orgId,
    userId: admin.id,
    firstName: 'Guillermo',
    lastName: 'Rauch',
    email: 'guillermo@vercel.com',
    company: 'Next.js Systems',
    source: 'Executive Referral',
  });

  // 5. Create Pipeline & Opportunities
  const pipelineResult = await OpportunityService.createPipeline({
    organizationId: orgId,
    name: 'Enterprise Revenue Pipeline',
    stages: [
      { name: 'Discovery', winProbability: 25 },
      { name: 'Security Review', winProbability: 50 },
      { name: 'Proposal / Pricing', winProbability: 75 },
      { name: 'Contract Review', winProbability: 90 },
      { name: 'Closed Won', winProbability: 100, isClosedWon: true },
      { name: 'Closed Lost', winProbability: 0, isClosedLost: true },
    ],
  });
  const stages = pipelineResult.stages;

  await OpportunityService.createOpportunity({
    organizationId: orgId,
    userId: admin.id,
    accountId: acc1.id,
    pipelineId: pipelineResult.pipeline.id,
    stageId: stages[2].id, // Proposal
    title: 'Stripe Connect AI Gateway Expansion',
    value: 380000,
  });

  await OpportunityService.createOpportunity({
    organizationId: orgId,
    userId: admin.id,
    accountId: acc3.id,
    pipelineId: pipelineResult.pipeline.id,
    stageId: stages[1].id, // Security Review
    title: 'Edge Deployment Security SLA',
    value: 145000,
  });

  // 6. Create Priority Activities
  await ActivityService.createActivity({
    organizationId: orgId,
    userId: admin.id,
    entityType: 'Account',
    entityId: acc3.id,
    type: 'CALL',
    subject: 'Emergency Customer Health Intervention (Health: 42%)',
    description: 'Vercel account health has dropped below 50. Inactivity detected over 14 days.',
    dueDate: new Date(Date.now() - 3600000), // Overdue by 1 hour (CRITICAL)
  });

  await ActivityService.createActivity({
    organizationId: orgId,
    userId: admin.id,
    entityType: 'Opportunity',
    entityId: acc1.id,
    type: 'TASK',
    subject: 'Deliver Custom SOC2 Security Addendum',
    description: 'Procurement team requires revised data retention clauses.',
    dueDate: new Date(Date.now() + 12 * 3600000), // Due in 12 hours (HIGH)
  });

  // 7. Request a High-Risk Action in Approval Queue
  await ActionGatewayService.requestAction({
    organizationId: orgId,
    userId: admin.id,
    userRole: Roles.OWNER,
    toolName: 'crm.delete_account',
    input: {
      accountId: acc2.id,
    },
  });

  logger.info('Demo seed database successfully initialized.');

  return {
    adminUser: admin,
    organizationId: orgId,
  };
}

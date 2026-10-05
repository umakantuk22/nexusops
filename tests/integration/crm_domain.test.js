import test from 'node:test';
import assert from 'node:assert';
import { db } from '../../src/lib/db.js';
import { IdentityService } from '../../src/modules/identity/identity.service.js';
import { OrganizationService } from '../../src/modules/organization/organization.service.js';
import { AccountService } from '../../src/modules/crm/account.service.js';
import { ContactService } from '../../src/modules/crm/contact.service.js';
import { LeadService } from '../../src/modules/crm/lead.service.js';
import { OpportunityService } from '../../src/modules/crm/opportunity.service.js';
import { ActivityService } from '../../src/modules/crm/activity.service.js';
import { TimelineService } from '../../src/modules/crm/timeline.service.js';
import { ConcurrencyError, TenantIsolationError } from '../../src/lib/errors.js';

test('Integration: Phase 2 — Core CRM Domain, Timeline & Concurrency', async () => {
  await db.clearAll();

  // Setup: User and Organization
  const user = await IdentityService.register({
    email: 'crm_admin@nexus.io',
    password: 'Password12345!',
    name: 'CRM Admin',
  });
  const orgResult = await OrganizationService.createOrganization({
    name: 'Acme Global',
    slug: 'acme-global',
    userId: user.id,
  });
  const orgId = orgResult.organization.id;

  // Setup Tenant 2 for cross-tenant checks
  const user2 = await IdentityService.register({
    email: 'other_admin@other.io',
    password: 'Password12345!',
    name: 'Other Admin',
  });
  const org2Result = await OrganizationService.createOrganization({
    name: 'Other Tenant',
    slug: 'other-tenant',
    userId: user2.id,
  });
  const org2Id = org2Result.organization.id;

  // 1. Account Creation
  const account = await AccountService.createAccount({
    organizationId: orgId,
    userId: user.id,
    name: 'Cyberdyne Systems',
    industry: 'Robotics',
    tier: 'ENTERPRISE',
  });
  assert.strictEqual(account.name, 'Cyberdyne Systems');
  assert.strictEqual(account.version, 1);

  // 2. Optimistic Concurrency on Account Update
  const updatedAccount = await AccountService.updateAccount({
    organizationId: orgId,
    userId: user.id,
    accountId: account.id,
    expectedVersion: 1,
    data: { healthScore: 92 },
  });
  assert.strictEqual(updatedAccount.healthScore, 92);
  assert.strictEqual(updatedAccount.version, 2);

  // Attempt update with stale version
  await assert.rejects(
    async () => {
      await AccountService.updateAccount({
        organizationId: orgId,
        userId: user.id,
        accountId: account.id,
        expectedVersion: 1, // Stale! Current is 2
        data: { healthScore: 50 },
      });
    },
    (err) => err instanceof ConcurrencyError
  );

  // 3. Contact Creation & Linking
  const contact = await ContactService.createContact({
    organizationId: orgId,
    userId: user.id,
    accountId: account.id,
    firstName: 'Miles',
    lastName: 'Dyson',
    email: 'miles@cyberdyne.com',
    title: 'Lead Architect',
  });
  assert.strictEqual(contact.accountId, account.id);

  // 4. Pipeline & Stages Setup
  const pipelineResult = await OpportunityService.createPipeline({
    organizationId: orgId,
    name: 'Standard Enterprise Sales',
    stages: [
      { name: 'Discovery', winProbability: 20 },
      { name: 'Proposal', winProbability: 60 },
      { name: 'Closed Won', winProbability: 100, isClosedWon: true },
      { name: 'Closed Lost', winProbability: 0, isClosedLost: true },
    ],
  });
  const pipeline = pipelineResult.pipeline;
  const stages = pipelineResult.stages;

  // 5. Lead Lifecycle & Atomic Conversion
  const lead = await LeadService.createLead({
    organizationId: orgId,
    userId: user.id,
    firstName: 'Sarah',
    lastName: 'Connor',
    email: 'sarah@resistance.org',
    company: 'Resistance Ops',
    source: 'inbound_web',
  });
  assert.strictEqual(lead.status, 'NEW');

  // Qualify Lead
  const qualifiedLead = await LeadService.qualifyLead({
    organizationId: orgId,
    userId: user.id,
    leadId: lead.id,
    score: 85,
  });
  assert.strictEqual(qualifiedLead.status, 'QUALIFIED');

  // Convert Lead into Account, Contact, and Opportunity in a single atomic transaction
  const conversion = await LeadService.convertLead({
    organizationId: orgId,
    userId: user.id,
    leadId: lead.id,
    dealTitle: 'Defense Systems Contract',
    dealValue: 250000,
    pipelineId: pipeline.id,
    stageId: stages[0].id,
  });

  assert.strictEqual(conversion.lead.status, 'CONVERTED');
  assert.ok(conversion.account.id);
  assert.strictEqual(conversion.account.name, 'Resistance Ops');
  assert.ok(conversion.contact.id);
  assert.strictEqual(conversion.contact.email, 'sarah@resistance.org');
  assert.ok(conversion.opportunity.id);
  assert.strictEqual(conversion.opportunity.value, 250000);

  // 6. Opportunity Stage Progression
  const movedToProposal = await OpportunityService.transitionStage({
    organizationId: orgId,
    userId: user.id,
    opportunityId: conversion.opportunity.id,
    newStageId: stages[1].id,
    expectedVersion: 1,
  });
  assert.strictEqual(movedToProposal.stageId, stages[1].id);
  assert.strictEqual(movedToProposal.status, 'OPEN');

  const closedWon = await OpportunityService.transitionStage({
    organizationId: orgId,
    userId: user.id,
    opportunityId: conversion.opportunity.id,
    newStageId: stages[2].id, // Closed Won
  });
  assert.strictEqual(closedWon.status, 'WON');

  // 7. Activity Management (Task & Meeting)
  const task = await ActivityService.createActivity({
    organizationId: orgId,
    userId: user.id,
    entityType: 'Account',
    entityId: conversion.account.id,
    type: 'TASK',
    subject: 'Send onboarding packet',
    dueDate: new Date(Date.now() + 86400000),
  });
  assert.strictEqual(task.status, 'PENDING');

  const completedTask = await ActivityService.completeActivity({
    organizationId: orgId,
    userId: user.id,
    activityId: task.id,
  });
  assert.strictEqual(completedTask.status, 'COMPLETED');

  // 8. Unified Timeline Aggregation Check
  const timeline = await TimelineService.getUnifiedTimeline(orgId, 'Account', account.id);
  assert.ok(timeline.length >= 2, 'Must contain account creation and contact link events');

  // 9. Cross-Tenant Isolation Enforcement
  // Tenant 2 attempts to fetch Tenant 1's Account
  await assert.rejects(
    async () => {
      await AccountService.getAccount(org2Id, account.id);
    },
    (err) => err instanceof TenantIsolationError
  );

  // Tenant 2 attempts to fetch Tenant 1's Lead
  await assert.rejects(
    async () => {
      await LeadService.getLead(org2Id, lead.id);
    },
    (err) => err instanceof TenantIsolationError
  );

  // Tenant 2 attempts to fetch Tenant 1's Opportunity
  await assert.rejects(
    async () => {
      await OpportunityService.getOpportunity(org2Id, conversion.opportunity.id);
    },
    (err) => err instanceof TenantIsolationError
  );
});

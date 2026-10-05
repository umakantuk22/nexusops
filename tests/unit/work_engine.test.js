import test from 'node:test';
import assert from 'node:assert';
import { PriorityService } from '../../src/modules/work-engine/priority.service.js';
import { WorkService } from '../../src/modules/work-engine/work.service.js';
import { SearchService } from '../../src/modules/work-engine/search.service.js';
import { db } from '../../src/lib/db.js';
import { AccountService } from '../../src/modules/crm/account.service.js';
import { ActivityService } from '../../src/modules/crm/activity.service.js';
import { LeadService } from '../../src/modules/crm/lead.service.js';

test('Unit: PriorityService scoring calculations', () => {
  // Overdue item on Enterprise account with $150k deal value and low health
  const critical = PriorityService.calculatePriorityScore({
    dueDate: new Date(Date.now() - 3600000), // Overdue by 1 hr
    dealValue: 150000,
    accountTier: 'ENTERPRISE',
    healthScore: 40, // Risky
  });

  assert.strictEqual(critical.priorityTier, 'CRITICAL');
  assert.ok(critical.score >= 80);

  // Future item on SMB account
  const low = PriorityService.calculatePriorityScore({
    dueDate: new Date(Date.now() + 10 * 86400000), // Due in 10 days
    dealValue: 1000,
    accountTier: 'SMB',
    healthScore: 100,
  });

  assert.ok(['LOW', 'MEDIUM'].includes(low.priorityTier));
  assert.ok(low.score < critical.score);
});

test('Integration: WorkService ranking & SearchService tenant isolation', async () => {
  await db.clearAll();

  const orgId = 'org_work_test_1';
  const org2Id = 'org_work_test_2';
  const userId = 'usr_work_1';

  // Create accounts
  const acc1 = await AccountService.createAccount({
    organizationId: orgId,
    userId,
    name: 'Wayne Enterprises',
    tier: 'ENTERPRISE',
    healthScore: 45,
  });

  const acc2 = await AccountService.createAccount({
    organizationId: orgId,
    userId,
    name: 'Stark Industries',
    tier: 'SMB',
    healthScore: 95,
  });

  // Create Activities
  // Urgent critical activity on Wayne Enterprises
  await ActivityService.createActivity({
    organizationId: orgId,
    userId,
    entityType: 'Account',
    entityId: acc1.id,
    type: 'TASK',
    subject: 'Emergency contract renewal',
    dueDate: new Date(Date.now() - 3600000), // Overdue
  });

  // Low priority activity on Stark Industries
  await ActivityService.createActivity({
    organizationId: orgId,
    userId,
    entityType: 'Account',
    entityId: acc2.id,
    type: 'CALL',
    subject: 'Routine check-in',
    dueDate: new Date(Date.now() + 7 * 86400000),
  });

  // Fetch Work queue
  const workItems = await WorkService.getMyWork(orgId, userId);
  assert.strictEqual(workItems.length, 2);
  // First item must be the higher priority one
  assert.strictEqual(workItems[0].title, 'Emergency contract renewal');
  assert.ok(workItems[0].priorityScore > workItems[1].priorityScore);

  // Search verification
  const searchResults = await SearchService.search(orgId, 'Wayne');
  assert.strictEqual(searchResults.length, 1);
  assert.strictEqual(searchResults[0].title, 'Wayne Enterprises');

  // Verify search tenant isolation (Tenant 2 searching should return 0 results)
  const tenant2Results = await SearchService.search(org2Id, 'Wayne');
  assert.strictEqual(tenant2Results.length, 0);
});

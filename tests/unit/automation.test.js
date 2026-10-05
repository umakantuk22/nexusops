import test from 'node:test';
import assert from 'node:assert';
import { db } from '../../src/lib/db.js';
import { OutboxService, JobStatuses } from '../../src/modules/automation/outbox.service.js';
import { WorkflowEngine } from '../../src/modules/automation/workflow.engine.js';
import { AccountService } from '../../src/modules/crm/account.service.js';

test('Unit & Integration: Outbox, Idempotency, Retries, and Workflow Engine', async () => {
  await db.clearAll();

  const orgId = 'org_auto_test_1';
  const userId = 'usr_auto_1';

  // 1. Enqueue job with idempotency key
  const idempotencyKey = 'idem_key_payment_12345';
  const job = await OutboxService.enqueue({
    organizationId: orgId,
    eventType: 'PaymentProcessed',
    payload: { amount: 500 },
    idempotencyKey,
  });

  assert.strictEqual(job.status, JobStatuses.PENDING);
  assert.strictEqual(job.attempts, 0);

  // Process job successfully
  const processed = await OutboxService.processJob(job.id, async (j) => {
    return { success: true, processedAt: Date.now() };
  });

  assert.strictEqual(processed.status, JobStatuses.COMPLETED);

  // 2. Idempotency Protection: Re-enqueuing with the same key must be rejected as duplicate
  const duplicateJob = await OutboxService.enqueue({
    organizationId: orgId,
    eventType: 'PaymentProcessed',
    payload: { amount: 500 },
    idempotencyKey,
  });

  assert.strictEqual(duplicateJob.duplicate, true);

  // 3. Transient Failure & Dead-Letter Handling
  const failingJob = await OutboxService.enqueue({
    organizationId: orgId,
    eventType: 'WebhookDispatch',
    payload: { url: 'https://flaky-webhook.com' },
  });

  // Attempt 1: Fails
  await assert.rejects(async () => {
    await OutboxService.processJob(failingJob.id, async () => {
      throw new Error('Connection timeout');
    });
  });
  assert.strictEqual(failingJob.status, JobStatuses.FAILED);
  assert.strictEqual(failingJob.attempts, 1);

  // Attempt 2: Fails
  await assert.rejects(async () => {
    await OutboxService.processJob(failingJob.id, async () => {
      throw new Error('503 Service Unavailable');
    });
  });
  assert.strictEqual(failingJob.status, JobStatuses.FAILED);
  assert.strictEqual(failingJob.attempts, 2);

  // Attempt 3: Fails -> Reaches maxAttempts (3) -> Moves to DEAD_LETTER
  await assert.rejects(async () => {
    await OutboxService.processJob(failingJob.id, async () => {
      throw new Error('Persistent Gateway Error');
    });
  });
  assert.strictEqual(failingJob.status, JobStatuses.DEAD_LETTER);
  assert.strictEqual(failingJob.attempts, 3);

  // 4. Workflow Engine Trigger Test
  const account = await AccountService.createAccount({
    organizationId: orgId,
    userId,
    name: 'MegaCorp Global',
    tier: 'ENTERPRISE',
  });

  const workflowTask = await WorkflowEngine.handleEvent({
    organizationId: orgId,
    eventType: 'OpportunityWon',
    payload: {
      opportunityId: 'opp_mega_1',
      accountId: account.id,
      userId,
      value: 75000, // Meets >= $50k trigger condition
    },
  });

  assert.ok(workflowTask, 'Must create automated onboarding task');
  assert.ok(workflowTask.subject.includes('Executive Onboarding Welcome'));
  assert.strictEqual(workflowTask.entityId, account.id);
});

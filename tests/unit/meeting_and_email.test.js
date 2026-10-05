import test from 'node:test';
import assert from 'node:assert';
import { db } from '../../src/lib/db.js';
import { MeetingIntelligenceService } from '../../src/modules/ai-context/meeting_intelligence.service.js';
import { EmailService } from '../../src/modules/communication/email.service.js';
import { ContactService } from '../../src/modules/crm/contact.service.js';

test('Unit & Integration: AI Meeting Intelligence & Action Extraction', async () => {
  await db.clearAll();

  const orgId = 'org_meeting_test';
  const userId = 'usr_meeting_1';

  const transcript = `
    Discussion with Stripe Execs:
    - We confirmed expansion scope for APAC regions.
    Action: Send updated MSA contract amendment by Friday.
    Todo: Schedule architecture walkthrough with security team.
    Client was thrilled with the response time and ready to sign.
  `;

  const result = await MeetingIntelligenceService.analyzeMeeting({
    organizationId: orgId,
    userId,
    entityType: 'Account',
    entityId: 'acc_dummy_stripe',
    meetingTitle: 'APAC Expansion Strategy',
    transcript,
  });

  assert.strictEqual(result.sentiment, 'POSITIVE');
  assert.strictEqual(result.actionItems.length, 2);
  assert.strictEqual(result.createdActivities.length, 2);
  assert.ok(result.createdActivities[0].subject.includes('Send updated MSA'));
});

test('Unit & Integration: Inbound Email Ingestion & AI Reply Drafting', async () => {
  await db.clearAll();

  const orgId = 'org_email_test';
  const userId = 'usr_email_1';

  // Setup Contact
  const contact = await ContactService.createContact({
    organizationId: orgId,
    userId,
    firstName: 'Patrick',
    lastName: 'Collison',
    email: 'patrick@stripe.com',
    title: 'CEO',
  });

  // Ingest inbound email
  const emailResult = await EmailService.ingestEmail({
    organizationId: orgId,
    fromEmail: 'patrick@stripe.com',
    toEmail: 'sales@nexusops.com',
    subject: 'Question on SOC2 compliance timeline',
    body: 'Can your team provide the updated SOC2 Type II report before our board meeting?',
  });

  assert.strictEqual(emailResult.matchedEntity.entityType, 'Contact');
  assert.strictEqual(emailResult.matchedEntity.entityId, contact.id);
  assert.ok(emailResult.reviewTask.id);
  assert.ok(emailResult.aiDraft.includes('Thank you for reaching out'));
  assert.strictEqual(emailResult.aiActionRecord.status, 'SUCCEEDED');
});

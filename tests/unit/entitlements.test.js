import test from 'node:test';
import assert from 'node:assert';
import { db } from '../../src/lib/db.js';
import { EntitlementService, PLANS } from '../../src/modules/billing/entitlement.service.js';
import { ForbiddenError } from '../../src/lib/errors.js';

test('Unit: EntitlementService Plan Checks & Quota Limits', async () => {
  await db.clearAll();
  EntitlementService.resetUsage();

  // Create Free Plan Org
  const freeOrg = await db.organizations.create({
    data: { name: 'Free Tier Org', slug: 'free-tier', plan: 'FREE' },
  });

  // Create Pro Plan Org
  const proOrg = await db.organizations.create({
    data: { name: 'Pro Tier Org', slug: 'pro-tier', plan: 'PRO' },
  });

  // 1. Free plan has 'crm.core'
  const allowedCore = await EntitlementService.assertFeatureEntitlement(freeOrg.id, 'crm.core');
  assert.strictEqual(allowedCore, true);

  // 2. Free plan does NOT have 'ai.gateway'
  await assert.rejects(
    async () => {
      await EntitlementService.assertFeatureEntitlement(freeOrg.id, 'ai.gateway');
    },
    (err) => err instanceof ForbiddenError && err.message.includes("not included in the 'Free' plan")
  );

  // 3. Pro plan has 'ai.gateway'
  const allowedPro = await EntitlementService.assertFeatureEntitlement(proOrg.id, 'ai.gateway');
  assert.strictEqual(allowedPro, true);

  // 4. Quota Enforcement: AI Actions limit on Free plan is 50
  for (let i = 0; i < 50; i++) {
    EntitlementService.recordUsage(freeOrg.id, 'aiActions', 1);
  }

  // 51st attempt must fail with ForbiddenError
  await assert.rejects(
    async () => {
      await EntitlementService.assertQuotaWithinLimit(freeOrg.id, 'aiActions');
    },
    (err) => err instanceof ForbiddenError && err.message.includes('Quota exceeded')
  );
});

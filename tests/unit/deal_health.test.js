import test from 'node:test';
import assert from 'node:assert';
import { db } from '../../src/lib/db.js';
import { DealHealthService } from '../../src/modules/crm/deal_health.service.js';
import { AccountService } from '../../src/modules/crm/account.service.js';
import { OpportunityService } from '../../src/modules/crm/opportunity.service.js';

test('Unit & Integration: DealHealthService Stalled Deals & Churn Risk', async () => {
  await db.clearAll();

  const orgId = 'org_health_test';
  const userId = 'usr_health_1';

  // 1. Account with Low Health Score (Churn risk)
  const atRiskAccount = await AccountService.createAccount({
    organizationId: orgId,
    userId,
    name: 'AtRisk Tech',
    tier: 'ENTERPRISE',
    healthScore: 35, // Below 50
  });

  const churnAlerts = await DealHealthService.scanChurnRisk(orgId, 50);
  assert.strictEqual(churnAlerts.length, 1);
  assert.strictEqual(churnAlerts[0].accountId, atRiskAccount.id);
  assert.strictEqual(churnAlerts[0].riskLevel, 'HIGH_RISK');

  // 2. Stalled Deal Detection
  const pipeline = await OpportunityService.createPipeline({
    organizationId: orgId,
    name: 'Test Pipeline',
    stages: [{ name: 'Proposal', winProbability: 50 }],
  });

  const opp = await OpportunityService.createOpportunity({
    organizationId: orgId,
    userId,
    accountId: atRiskAccount.id,
    pipelineId: pipeline.pipeline.id,
    stageId: pipeline.stages[0].id,
    title: 'Enterprise License',
    value: 90000,
  });

  // Manually backdate opportunity updatedAt to simulate 20 days idle
  await db.opportunities.update({
    where: { id: opp.id },
    data: {
      updatedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    },
  });

  const stalledDeals = await DealHealthService.scanStalledDeals(orgId, 14);
  assert.strictEqual(stalledDeals.length, 1);
  assert.strictEqual(stalledDeals[0].opportunityId, opp.id);
  assert.ok(stalledDeals[0].daysStalled >= 20);
});

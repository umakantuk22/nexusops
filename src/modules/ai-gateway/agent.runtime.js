/**
 * Project Nexus - Agent Runtime with Circuit Breakers & Observability
 */
import crypto from 'node:crypto';
import { ActionGatewayService } from './action_gateway.service.js';
import { logger } from '../../lib/logger.js';

export class AgentRuntime {
  /**
   * Runs an agent workflow step-by-step with strict execution limits.
   */
  static async executePlan({
    organizationId,
    userId,
    userRole,
    planSteps,
    maxSteps = 5,
    maxTokens = 4000,
    costBudgetDollars = 0.50,
  }) {
    const agentRunId = `run_${crypto.randomUUID()}`;
    const startTime = Date.now();

    const runMetrics = {
      agentRunId,
      organizationId,
      userId,
      stepsExecuted: 0,
      tokensUsed: 0,
      estimatedCost: 0,
      status: 'RUNNING',
      actions: [],
    };

    logger.info('Agent Run Started', { agentRunId, planStepsCount: planSteps.length });

    for (const step of planSteps) {
      // 1. Circuit Breaker: Max Steps
      if (runMetrics.stepsExecuted >= maxSteps) {
        runMetrics.status = 'STOPPED_STEP_LIMIT_EXCEEDED';
        logger.warn('Agent halted: max step limit reached', { agentRunId, maxSteps });
        break;
      }

      // 2. Circuit Breaker: Cost Budget Check
      if (runMetrics.estimatedCost >= costBudgetDollars) {
        runMetrics.status = 'STOPPED_COST_BUDGET_EXCEEDED';
        logger.warn('Agent halted: cost budget exceeded', { agentRunId, costBudgetDollars });
        break;
      }

      runMetrics.stepsExecuted += 1;
      runMetrics.tokensUsed += 250; // Metric tracking
      runMetrics.estimatedCost += 0.005;

      // Dispatch through AI Action Gateway
      const actionResult = await ActionGatewayService.requestAction({
        organizationId,
        userId,
        userRole,
        agentId: agentRunId,
        toolName: step.toolName,
        input: step.input,
      });

      runMetrics.actions.push(actionResult);
    }

    if (runMetrics.status === 'RUNNING') {
      runMetrics.status = 'COMPLETED';
    }

    runMetrics.durationMs = Date.now() - startTime;
    logger.info('Agent Run Finished', { agentRunId, status: runMetrics.status });

    return runMetrics;
  }
}

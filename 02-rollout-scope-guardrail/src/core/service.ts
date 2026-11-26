import { evaluateRuleSet } from './evaluator.ts';
import type { IncomingRequest, RuleSetConfig, SimulatedResponse } from './types.ts';
import { BoundedWorkerPool } from './workerPool.ts';

const BASELINE_FAST_PATH_MS = 2;

/**
 * Simulated API service combining rollout rule evaluation, per-rule concurrency bulkheads,
 * and a shared downstream worker pool.
 */
export class SimulatedRolloutService {
  private readonly config: RuleSetConfig;
  private readonly pool: BoundedWorkerPool;
  private readonly timeScale: number;
  private readonly ruleActiveCounts = new Map<string, number>();
  private readonly ruleDegradedCounts = new Map<string, number>();

  constructor(config: RuleSetConfig, timeScale = 1) {
    this.config = config;
    this.timeScale = timeScale;
    this.pool = new BoundedWorkerPool(config.workerPoolConfig, timeScale);
  }

  getPoolSnapshot() {
    return this.pool.getSnapshot();
  }

  getRuleDegradedCounts(): Record<string, number> {
    return Object.fromEntries(this.ruleDegradedCounts.entries());
  }

  async handleRequest(req: IncomingRequest): Promise<SimulatedResponse> {
    const decision = evaluateRuleSet(this.config, req);

    // Fast baseline path when no rollout rule matches
    if (!decision.matched || !decision.rule) {
      const res = await this.pool.execute(BASELINE_FAST_PATH_MS);
      return this.mapPoolResponse(req, null, res, false, decision.reason);
    }

    const rule = decision.rule;
    const cap = rule.execution.maxConcurrencyCap;
    const currentForRule = this.ruleActiveCounts.get(rule.id) ?? 0;

    // Enforce per-rule bulkhead if configured
    if (typeof cap === 'number' && currentForRule >= cap) {
      this.ruleDegradedCounts.set(rule.id, (this.ruleDegradedCounts.get(rule.id) ?? 0) + 1);

      if (rule.execution.fallbackOnCap === 'degrade_fast') {
        const res = await this.pool.execute(BASELINE_FAST_PATH_MS);
        return this.mapPoolResponse(req, rule.id, res, true, 'bulkhead_degraded_to_fast_path');
      }

      return {
        requestId: req.requestId,
        statusCode: 503,
        outcome: 'rejected_503',
        matchedRuleId: rule.id,
        latencyMs: 1,
        queueWaitMs: 0,
        workerUsed: false,
        degraded: false,
        reason: 'bulkhead_cap_rejected_503',
      };
    }

    this.ruleActiveCounts.set(rule.id, currentForRule + 1);
    try {
      const res = await this.pool.execute(rule.execution.executionCostMs);
      return this.mapPoolResponse(req, rule.id, res, false, 'heavy_rule_executed');
    } finally {
      this.ruleActiveCounts.set(rule.id, Math.max(0, (this.ruleActiveCounts.get(rule.id) ?? 1) - 1));
    }
  }

  private mapPoolResponse(
    req: IncomingRequest,
    matchedRuleId: string | null,
    poolRes: { status: 'completed' | 'rejected_queue_full' | 'timeout'; queueWaitMs: number; workMs: number },
    degraded: boolean,
    reason: string,
  ): SimulatedResponse {
    const totalLatency = Number((poolRes.queueWaitMs + poolRes.workMs).toFixed(2));

    if (poolRes.status === 'rejected_queue_full') {
      return {
        requestId: req.requestId,
        statusCode: 503,
        outcome: 'rejected_503',
        matchedRuleId,
        latencyMs: Math.max(1, totalLatency),
        queueWaitMs: Number(poolRes.queueWaitMs.toFixed(2)),
        workerUsed: false,
        degraded,
        reason: 'worker_pool_queue_full',
      };
    }

    if (poolRes.status === 'timeout') {
      return {
        requestId: req.requestId,
        statusCode: 504,
        outcome: 'timeout_504',
        matchedRuleId,
        latencyMs: Number((this.config.workerPoolConfig.requestTimeoutMs).toFixed(2)),
        queueWaitMs: Number(poolRes.queueWaitMs.toFixed(2)),
        workerUsed: true,
        degraded,
        reason: 'worker_pool_timeout',
      };
    }

    const outcome = degraded ? 'degraded_ok' : matchedRuleId ? 'heavy_ok' : 'fast_ok';
    return {
      requestId: req.requestId,
      statusCode: 200,
      outcome,
      matchedRuleId,
      latencyMs: totalLatency > 0 ? totalLatency : Number((BASELINE_FAST_PATH_MS / (this.timeScale || 1)).toFixed(2)),
      queueWaitMs: Number(poolRes.queueWaitMs.toFixed(2)),
      workerUsed: true,
      degraded,
      reason,
    };
  }
}

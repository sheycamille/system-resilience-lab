import {
  DEFAULT_TRAFFIC_MIX,
  estimateRuleTrafficFraction,
  isWildcardCohort,
  isWildcardRegion,
} from '../core/evaluator.ts';
import type { RolloutRule, RuleSetConfig, TrafficMix } from '../core/types.ts';

export type PolicySeverity = 'critical' | 'warning' | 'info';

export type PolicyFindingCode =
  | 'WILDCARD_COHORT_UNAPPROVED'
  | 'WILDCARD_REGION_UNAPPROVED'
  | 'AMPLIFICATION_EXCEEDED'
  | 'MISSING_CONCURRENCY_CAP'
  | 'OVERSIZED_CONCURRENCY_CAP'
  | 'PROJECTED_POOL_SATURATION'
  | 'APPROVAL_LIMIT_EXCEEDED'
  | 'MISSING_PATH_PREFIX';

export interface PolicyFinding {
  severity: PolicySeverity;
  code: PolicyFindingCode;
  ruleId: string;
  ruleName: string;
  message: string;
  beforeValue: string;
  afterValue: string;
  remediation: string;
}

export interface RuleAmplificationDelta {
  ruleId: string;
  ruleName: string;
  beforeFraction: number;
  afterFraction: number;
  amplificationFactor: number;
  projectedPeakWorkers: number;
  hasBulkheadCap: boolean;
  maxConcurrencyCap: number | null;
  approvedMaxPercent: number | null;
}

export interface PolicyOptions {
  /** Maximum unapproved audience jump multiplier before flagging */
  maxUnapprovedAmplification?: number;
  /** Peak RPS assumed for Little's Law capacity projection */
  assumedPeakRps?: number;
  /** Heavy path threshold in ms requiring a bulkhead cap when audience > 5% */
  heavyCostThresholdMs?: number;
  trafficMix?: TrafficMix;
}

export interface PolicyAuditReport {
  passed: boolean;
  baselineVersion: string;
  candidateVersion: string;
  criticalCount: number;
  warningCount: number;
  assumedPeakRps: number;
  poolMaxWorkers: number;
  ruleDeltas: RuleAmplificationDelta[];
  findings: PolicyFinding[];
  summary: string;
}

function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`;
}

export function auditRuleSetPolicy(
  baseline: RuleSetConfig,
  candidate: RuleSetConfig,
  options: PolicyOptions = {},
): PolicyAuditReport {
  const maxUnapprovedAmplification = options.maxUnapprovedAmplification ?? 5;
  const assumedPeakRps = options.assumedPeakRps ?? 350;
  const heavyCostThresholdMs = options.heavyCostThresholdMs ?? 20;
  const mix = options.trafficMix ?? DEFAULT_TRAFFIC_MIX;

  const baselineMap = new Map<string, RolloutRule>(
    baseline.rules.map((r) => [r.id, r]),
  );

  const findings: PolicyFinding[] = [];
  const ruleDeltas: RuleAmplificationDelta[] = [];
  const poolMaxWorkers = candidate.workerPoolConfig.maxWorkers;

  for (const rule of candidate.rules) {
    if (!rule.enabled) {
      continue;
    }

    const baseRule = baselineMap.get(rule.id);
    const beforeFraction = baseRule ? estimateRuleTrafficFraction(baseRule, mix) : 0;
    const afterFraction = estimateRuleTrafficFraction(rule, mix);
    const afterPercent = afterFraction * 100;

    const amplificationFactor =
      beforeFraction > 0
        ? Number((afterFraction / beforeFraction).toFixed(1))
        : afterFraction > 0
          ? Number((afterFraction * 1000).toFixed(1))
          : 1;

    // Little's Law: L = lambda * W
    const projectedPeakWorkers = Number(
      (assumedPeakRps * afterFraction * (rule.execution.executionCostMs / 1000)).toFixed(2),
    );

    const cap = rule.execution.maxConcurrencyCap;
    const hasBulkheadCap = typeof cap === 'number' && cap > 0;

    ruleDeltas.push({
      ruleId: rule.id,
      ruleName: rule.name,
      beforeFraction,
      afterFraction,
      amplificationFactor,
      projectedPeakWorkers,
      hasBulkheadCap,
      maxConcurrencyCap: cap ?? null,
      approvedMaxPercent: rule.approval?.maxAllowedAudiencePercent ?? null,
    });

    const hasValidApproval = Boolean(
      rule.approval &&
        rule.approval.ticketId.trim().length > 0 &&
        rule.approval.approvedBy.trim().length > 0,
    );

    // 1. Check approval ceiling if approval exists
    if (rule.approval && afterPercent > rule.approval.maxAllowedAudiencePercent) {
      findings.push({
        severity: 'critical',
        code: 'APPROVAL_LIMIT_EXCEEDED',
        ruleId: rule.id,
        ruleName: rule.name,
        message: `Estimated audience (${formatPct(afterFraction)}) exceeds approved ceiling (${rule.approval.maxAllowedAudiencePercent}%).`,
        beforeValue: `Approved <= ${rule.approval.maxAllowedAudiencePercent}%`,
        afterValue: formatPct(afterFraction),
        remediation: 'Lower rolloutPercent, narrow cohorts/regions, or obtain updated approval.',
      });
    }

    // 2. Check unapproved wildcard cohort widening
    const baseWildcardCohort = baseRule ? isWildcardCohort(baseRule) : false;
    if (isWildcardCohort(rule) && !baseWildcardCohort && !hasValidApproval) {
      findings.push({
        severity: 'critical',
        code: 'WILDCARD_COHORT_UNAPPROVED',
        ruleId: rule.id,
        ruleName: rule.name,
        message: 'Cohort constraint was removed or widened to wildcard (*) without release approval.',
        beforeValue: baseRule ? baseRule.scope.cohorts.join(', ') : 'none',
        afterValue: rule.scope.cohorts.length ? rule.scope.cohorts.join(', ') : '[] (all)',
        remediation: 'Restore explicit cohort filter (e.g. ["internal"]) or attach approval metadata.',
      });
    }

    // 3. Check unapproved wildcard region widening
    const baseWildcardRegion = baseRule ? isWildcardRegion(baseRule) : false;
    if (isWildcardRegion(rule) && !baseWildcardRegion && !hasValidApproval) {
      findings.push({
        severity: 'warning',
        code: 'WILDCARD_REGION_UNAPPROVED',
        ruleId: rule.id,
        ruleName: rule.name,
        message: 'Region constraint was widened to wildcard (*) without release approval.',
        beforeValue: baseRule ? baseRule.scope.regions.join(', ') : 'none',
        afterValue: rule.scope.regions.length ? rule.scope.regions.join(', ') : '[] (all)',
        remediation: 'Scope rollout to a single canary region first or attach release approval.',
      });
    }

    // 4. Check audience amplification multiplier without approval
    if (
      beforeFraction > 0 &&
      amplificationFactor > maxUnapprovedAmplification &&
      (!hasValidApproval || afterPercent > (rule.approval?.maxAllowedAudiencePercent ?? 0))
    ) {
      findings.push({
        severity: 'critical',
        code: 'AMPLIFICATION_EXCEEDED',
        ruleId: rule.id,
        ruleName: rule.name,
        message: `Audience jumped ${amplificationFactor}x (${formatPct(beforeFraction)} -> ${formatPct(afterFraction)}) without sufficient approval.`,
        beforeValue: formatPct(beforeFraction),
        afterValue: `${formatPct(afterFraction)} (${amplificationFactor}x)`,
        remediation: 'Keep amplification <= 5x per step or provide signed approval with concurrency cap.',
      });
    }

    // 5. Check path prefix widening
    if (
      baseRule?.scope.pathPrefix &&
      baseRule.scope.pathPrefix !== '/api/' &&
      (!rule.scope.pathPrefix || rule.scope.pathPrefix === '*' || rule.scope.pathPrefix === '/api/')
    ) {
      findings.push({
        severity: 'warning',
        code: 'MISSING_PATH_PREFIX',
        ruleId: rule.id,
        ruleName: rule.name,
        message: 'Path prefix filter was broadened from a targeted endpoint to all API routes.',
        beforeValue: baseRule.scope.pathPrefix,
        afterValue: rule.scope.pathPrefix ?? '(none)',
        remediation: `Restrict pathPrefix to ${baseRule.scope.pathPrefix} unless global matching is intended.`,
      });
    }

    // 6. Check bulkhead concurrency cap for expensive paths
    const isExpensiveAndWide =
      rule.execution.executionCostMs >= heavyCostThresholdMs && afterPercent > 5;

    if (isExpensiveAndWide && !hasBulkheadCap) {
      findings.push({
        severity: 'critical',
        code: 'MISSING_CONCURRENCY_CAP',
        ruleId: rule.id,
        ruleName: rule.name,
        message: `Expensive rule (${rule.execution.executionCostMs}ms) affects ${formatPct(afterFraction)} of traffic with no maxConcurrencyCap bulkhead.`,
        beforeValue: baseRule?.execution.maxConcurrencyCap ? `cap=${baseRule.execution.maxConcurrencyCap}` : 'none',
        afterValue: 'unbounded',
        remediation: `Set execution.maxConcurrencyCap <= ${Math.max(1, Math.floor(poolMaxWorkers * 0.5))} with fallbackOnCap: "degrade_fast".`,
      });
    } else if (
      isExpensiveAndWide &&
      typeof cap === 'number' &&
      cap > Math.floor(poolMaxWorkers * 0.75)
    ) {
      findings.push({
        severity: 'warning',
        code: 'OVERSIZED_CONCURRENCY_CAP',
        ruleId: rule.id,
        ruleName: rule.name,
        message: `Rule concurrency cap (${cap}) consumes >75% of shared worker pool (${poolMaxWorkers} workers).`,
        beforeValue: `${cap} workers`,
        afterValue: `Pool size ${poolMaxWorkers}`,
        remediation: `Lower maxConcurrencyCap to <= ${Math.max(1, Math.floor(poolMaxWorkers * 0.5))} to protect shared baseline routes.`,
      });
    }

    // 7. Little's Law projected pool saturation check
    const protectedByFastDegrade =
      hasBulkheadCap &&
      typeof cap === 'number' &&
      cap <= Math.floor(poolMaxWorkers * 0.65) &&
      rule.execution.fallbackOnCap === 'degrade_fast';

    if (projectedPeakWorkers > poolMaxWorkers * 0.85 && !protectedByFastDegrade) {
      findings.push({
        severity: 'critical',
        code: 'PROJECTED_POOL_SATURATION',
        ruleId: rule.id,
        ruleName: rule.name,
        message: `At ${assumedPeakRps} req/s, rule requires ~${projectedPeakWorkers} concurrent workers against ${poolMaxWorkers} pool workers without safe fast-degrade bulkhead.`,
        beforeValue: `Pool capacity ${poolMaxWorkers} workers`,
        afterValue: `Projected demand ${projectedPeakWorkers} workers`,
        remediation: 'Add maxConcurrencyCap with fallbackOnCap: "degrade_fast" or reduce rolloutPercent.',
      });
    }
  }

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const passed = criticalCount === 0;

  const summary = passed
    ? warningCount === 0
      ? `Policy check passed (${candidate.version}): no unsafe scope expansion or pool saturation risk detected.`
      : `Policy check passed with ${warningCount} warning(s) (${candidate.version}).`
    : `Policy check FAILED (${candidate.version}): ${criticalCount} critical guardrail violation(s) blocked rollout.`;

  return {
    passed,
    baselineVersion: baseline.version,
    candidateVersion: candidate.version,
    criticalCount,
    warningCount,
    assumedPeakRps,
    poolMaxWorkers,
    ruleDeltas,
    findings,
    summary,
  };
}

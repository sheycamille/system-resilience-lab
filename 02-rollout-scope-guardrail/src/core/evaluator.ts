import type {
  Cohort,
  EvaluationDecision,
  IncomingRequest,
  Region,
  RolloutRule,
  RuleSetConfig,
  TrafficMix,
} from './types.ts';

export const DEFAULT_TRAFFIC_MIX: TrafficMix = {
  cohorts: {
    internal: 0.02,
    beta: 0.08,
    free: 0.55,
    pro: 0.25,
    enterprise: 0.10,
  },
  regions: {
    'us-east': 0.50,
    'eu-west': 0.30,
    'ap-south': 0.20,
  },
  inspectPathShare: 0.45,
};

/**
 * Deterministic 32-bit FNV-1a hash mapped to bucket [0, 99] for stable user bucketing.
 */
export function hashToBucket(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

export function isWildcardCohort(rule: RolloutRule): boolean {
  return rule.scope.cohorts.length === 0 || rule.scope.cohorts.includes('*');
}

export function isWildcardRegion(rule: RolloutRule): boolean {
  return rule.scope.regions.length === 0 || rule.scope.regions.includes('*');
}

export function evaluateRule(rule: RolloutRule, req: IncomingRequest): EvaluationDecision {
  const bucket = hashToBucket(`${rule.id}:${req.userId}`);

  if (!rule.enabled) {
    return { matched: false, rule: null, reason: 'rule_disabled', bucket };
  }

  const cohortOk = isWildcardCohort(rule) || rule.scope.cohorts.includes(req.cohort);
  if (!cohortOk) {
    return { matched: false, rule: null, reason: 'cohort_filtered', bucket };
  }

  const regionOk = isWildcardRegion(rule) || rule.scope.regions.includes(req.region);
  if (!regionOk) {
    return { matched: false, rule: null, reason: 'region_filtered', bucket };
  }

  const prefix = rule.scope.pathPrefix;
  const pathOk = !prefix || prefix === '*' || req.path.startsWith(prefix);
  if (!pathOk) {
    return { matched: false, rule: null, reason: 'path_filtered', bucket };
  }

  if (bucket >= rule.scope.rolloutPercent) {
    return { matched: false, rule: null, reason: 'percent_bucket_excluded', bucket };
  }

  return { matched: true, rule, reason: 'scope_matched', bucket };
}

/**
 * Evaluates all rules in priority order and returns the highest-cost matching rule
 * (modeling worst-case execution path amplification when multiple rules match).
 */
export function evaluateRuleSet(config: RuleSetConfig, req: IncomingRequest): EvaluationDecision {
  let bestMatch: EvaluationDecision | null = null;
  let lastDecision: EvaluationDecision = {
    matched: false,
    rule: null,
    reason: 'no_rules_configured',
    bucket: 0,
  };

  for (const rule of config.rules) {
    const decision = evaluateRule(rule, req);
    lastDecision = decision;
    if (decision.matched && decision.rule) {
      if (!bestMatch || !bestMatch.rule || decision.rule.execution.executionCostMs > bestMatch.rule.execution.executionCostMs) {
        bestMatch = decision;
      }
    }
  }

  return bestMatch ?? lastDecision;
}

/**
 * Estimates the fraction [0..1] of total production traffic that matches this rule
 * based on the modeled traffic distribution.
 */
export function estimateRuleTrafficFraction(rule: RolloutRule, mix: TrafficMix = DEFAULT_TRAFFIC_MIX): number {
  if (!rule.enabled || rule.scope.rolloutPercent <= 0) {
    return 0;
  }

  const cohortWeight = isWildcardCohort(rule)
    ? 1
    : (rule.scope.cohorts as Cohort[]).reduce((acc, c) => acc + (mix.cohorts[c] ?? 0), 0);

  const regionWeight = isWildcardRegion(rule)
    ? 1
    : (rule.scope.regions as Region[]).reduce((acc, r) => acc + (mix.regions[r] ?? 0), 0);

  const prefix = rule.scope.pathPrefix;
  let pathWeight = 1;
  if (prefix && prefix !== '*' && prefix !== '/api/') {
    pathWeight = prefix.startsWith('/api/inspect') ? mix.inspectPathShare : 0.25;
  }

  const rolloutWeight = Math.min(100, Math.max(0, rule.scope.rolloutPercent)) / 100;
  return Math.min(1, cohortWeight * regionWeight * pathWeight * rolloutWeight);
}

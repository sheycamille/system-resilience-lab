import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { estimateRuleTrafficFraction, evaluateRuleSet } from '../src/core/evaluator.ts';
import type { RuleSetConfig } from '../src/core/types.ts';
import { auditRuleSetPolicy } from '../src/guardrail/policyCheck.ts';

function loadJson(relPath: string): RuleSetConfig {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf-8')) as RuleSetConfig;
}

const beforeConfig = loadJson('configs/rules.before.json');
const mutatedConfig = loadJson('configs/rules.mutated.json');
const cappedConfig = loadJson('configs/rules.capped.json');

test('baseline config restricts heavy inspector to a tiny internal fraction', () => {
  const heavyRule = beforeConfig.rules.find((r) => r.id === 'deep-payload-inspector')!;
  const fraction = estimateRuleTrafficFraction(heavyRule);
  assert.ok(fraction < 0.01, `Expected < 1% traffic, got ${(fraction * 100).toFixed(3)}%`);

  // External user should NOT trigger the heavy path in baseline
  const externalDecision = evaluateRuleSet(beforeConfig, {
    requestId: 'r-1',
    userId: 'user-ext-99',
    cohort: 'free',
    region: 'us-east',
    path: '/api/inspect',
  });
  assert.equal(externalDecision.matched, false);
});

test('mutated scope leak amplifies heavy path across 100% of external traffic', () => {
  const heavyMutated = mutatedConfig.rules.find((r) => r.id === 'deep-payload-inspector')!;
  const fraction = estimateRuleTrafficFraction(heavyMutated);
  assert.equal(fraction, 1);

  const externalDecision = evaluateRuleSet(mutatedConfig, {
    requestId: 'r-2',
    userId: 'user-ext-99',
    cohort: 'free',
    region: 'ap-south',
    path: '/api/status',
  });
  assert.equal(externalDecision.matched, true);
  assert.equal(externalDecision.rule?.id, 'deep-payload-inspector');
});

test('policy guardrail blocks unapproved scope leak and missing bulkhead cap', () => {
  const report = auditRuleSetPolicy(beforeConfig, mutatedConfig, { assumedPeakRps: 350 });

  assert.equal(report.passed, false);
  assert.ok(report.criticalCount >= 3, 'Expected multiple critical violations on mutated config');

  const codes = new Set(report.findings.map((f) => f.code));
  assert.ok(codes.has('WILDCARD_COHORT_UNAPPROVED'));
  assert.ok(codes.has('AMPLIFICATION_EXCEEDED'));
  assert.ok(codes.has('MISSING_CONCURRENCY_CAP'));
  assert.ok(codes.has('PROJECTED_POOL_SATURATION'));
});

test('policy guardrail allows explicitly approved and concurrency-capped rollout', () => {
  const report = auditRuleSetPolicy(beforeConfig, cappedConfig, { assumedPeakRps: 350 });

  assert.equal(
    report.passed,
    true,
    `Expected capped config to pass policy audit, got: ${report.findings.map((f) => f.code).join(', ')}`,
  );
  assert.equal(report.criticalCount, 0);
});

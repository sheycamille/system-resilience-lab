import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { RuleSetConfig } from '../src/core/types.ts';
import { runLoadSaturationTest } from '../src/load/saturationTest.ts';

function loadJson(relPath: string): RuleSetConfig {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf-8')) as RuleSetConfig;
}

const beforeConfig = loadJson('configs/rules.before.json');
const mutatedConfig = loadJson('configs/rules.mutated.json');
const cappedConfig = loadJson('configs/rules.capped.json');

test('before (scoped) configuration satisfies latency and 5xx SLOs under concurrent load', async () => {
  const result = await runLoadSaturationTest(beforeConfig, {
    totalRequests: 140,
    concurrency: 28,
    timeScale: 0.5,
    maxErrorRatePercent: 1.0,
    maxP95LatencyMs: 100,
  });

  assert.equal(result.sloPassed, true, `Expected scoped rollout to pass SLOs: ${result.sloViolations.join('; ')}`);
  assert.equal(result.errorRatePercent, 0);
  assert.ok(result.latencyP95Ms < 30, `Expected low p95 latency, got ${result.latencyP95Ms}ms`);
});

test('mutated (scope leak) configuration saturates worker pool and breaches SLOs under concurrency', async () => {
  const result = await runLoadSaturationTest(mutatedConfig, {
    totalRequests: 140,
    concurrency: 28,
    timeScale: 0.5,
    maxErrorRatePercent: 1.0,
    maxP95LatencyMs: 100,
  });

  assert.equal(result.sloPassed, false, 'Expected leaked rollout to breach latency/error SLOs');
  assert.equal(result.peakActiveWorkers, result.poolMaxWorkers);
  assert.ok(
    result.rejected503Count + result.timeout504Count > 0 || result.latencyP95Ms > 120,
    'Expected queue rejections, timeouts, or severe latency spike when scope leaks to 100%',
  );
});

test('capped (bulkhead + degrade_fast) configuration absorbs peak concurrency without 5xx errors', async () => {
  const result = await runLoadSaturationTest(cappedConfig, {
    totalRequests: 140,
    concurrency: 28,
    timeScale: 0.5,
    maxErrorRatePercent: 1.0,
    maxP95LatencyMs: 100,
  });

  assert.equal(result.sloPassed, true, `Expected capped rollout to stay within SLOs: ${result.sloViolations.join('; ')}`);
  assert.equal(result.errorRatePercent, 0);
  assert.ok(result.degradedOkCount > 0, 'Expected bulkhead to shed excess heavy calls to fast fallback');
});

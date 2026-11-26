import fs from 'node:fs';
import path from 'node:path';
import type { RuleSetConfig } from '../src/core/types.ts';
import { runLoadSaturationTest } from '../src/load/saturationTest.ts';

function loadConfig(filePath: string): RuleSetConfig {
  const abs = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(abs, 'utf-8')) as RuleSetConfig;
}

async function main() {
  const scenarios = [
    { label: '1. Before (Scoped Canary)', file: 'configs/rules.before.json' },
    { label: '2. Mutated (Unbounded Scope Leak)', file: 'configs/rules.mutated.json' },
    { label: '3. Capped (Approved + Bulkhead Guard)', file: 'configs/rules.capped.json' },
  ];

  console.log('========================================================================');
  console.log('SIMULATED LOAD & WORKER POOL SATURATION COMPARISON');
  console.log('Traffic: 140 concurrent requests (concurrency=28, timeScale=0.5)');
  console.log('SLOs   : 5xx error rate <= 1.00% | p95 latency <= 100ms');
  console.log('========================================================================\n');

  for (const scenario of scenarios) {
    const config = loadConfig(scenario.file);
    const result = await runLoadSaturationTest(config, {
      totalRequests: 140,
      concurrency: 28,
      timeScale: 0.5,
      maxErrorRatePercent: 1.0,
      maxP95LatencyMs: 100,
    });

    console.log(`Scenario: ${scenario.label} [${result.configVersion}]`);
    console.log(
      `  200 OK : ${result.okCount}/${result.totalRequests} ` +
        `(heavy=${result.heavyOkCount}, fast=${result.fastOkCount}, degraded=${result.degradedOkCount})`,
    );
    console.log(
      `  5xx Err: ${result.rejected503Count + result.timeout504Count} ` +
        `(503=${result.rejected503Count}, 504=${result.timeout504Count}, rate=${result.errorRatePercent}%)`,
    );
    console.log(
      `  Latency: p50=${result.latencyP50Ms}ms | p95=${result.latencyP95Ms}ms | p99=${result.latencyP99Ms}ms | max=${result.latencyMaxMs}ms`,
    );
    console.log(
      `  Pool   : peakActive=${result.peakActiveWorkers}/${result.poolMaxWorkers} | peakQueue=${result.peakQueueDepth}`,
    );
    console.log(`  Verdict: ${result.sloPassed ? 'PASS (SLOs met)' : `FAIL (${result.sloViolations.join('; ')})`}\n`);
  }
}

void main();

import fs from 'node:fs';
import path from 'node:path';
import type { RuleSetConfig } from '../src/core/types.ts';
import { auditRuleSetPolicy } from '../src/guardrail/policyCheck.ts';

function parseArgs(argv: string[]) {
  let baselinePath = 'configs/rules.before.json';
  let candidatePath = 'configs/rules.mutated.json';
  let peakRps = 350;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--baseline' && argv[i + 1]) {
      baselinePath = argv[++i];
    } else if (argv[i] === '--candidate' && argv[i + 1]) {
      candidatePath = argv[++i];
    } else if (argv[i] === '--peak-rps' && argv[i + 1]) {
      peakRps = Number(argv[++i]) || 350;
    }
  }
  return { baselinePath, candidatePath, peakRps };
}

function loadConfig(filePath: string): RuleSetConfig {
  const abs = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(abs, 'utf-8')) as RuleSetConfig;
}

const { baselinePath, candidatePath, peakRps } = parseArgs(process.argv.slice(2));
const baseline = loadConfig(baselinePath);
const candidate = loadConfig(candidatePath);

const report = auditRuleSetPolicy(baseline, candidate, { assumedPeakRps: peakRps });

console.log('========================================================================');
console.log('ROLLOUT SCOPE POLICY AUDIT');
console.log(`Baseline : ${baselinePath} (${report.baselineVersion})`);
console.log(`Candidate: ${candidatePath} (${report.candidateVersion})`);
console.log(`Assumed Peak RPS: ${report.assumedPeakRps} | Shared Pool Workers: ${report.poolMaxWorkers}`);
console.log('------------------------------------------------------------------------');

for (const delta of report.ruleDeltas) {
  console.log(
    `Rule [${delta.ruleId}]: ${(delta.beforeFraction * 100).toFixed(2)}% -> ${(delta.afterFraction * 100).toFixed(2)}% ` +
      `(${delta.amplificationFactor}x) | Projected Workers: ${delta.projectedPeakWorkers} | ` +
      `Bulkhead Cap: ${delta.maxConcurrencyCap ?? 'none'}`,
  );
}

console.log('------------------------------------------------------------------------');
if (report.findings.length === 0) {
  console.log('No policy findings detected.');
} else {
  for (const finding of report.findings) {
    console.log(`[${finding.severity.toUpperCase()}] ${finding.code} (${finding.ruleId})`);
    console.log(`  Detail     : ${finding.message}`);
    console.log(`  Diff       : ${finding.beforeValue} -> ${finding.afterValue}`);
    console.log(`  Remediation: ${finding.remediation}`);
  }
}

console.log('------------------------------------------------------------------------');
console.log(report.summary);
console.log('========================================================================');

if (!report.passed) {
  process.exit(1);
}

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { SimulatedRolloutService } from './core/service.ts';
import type { Cohort, Region, RuleSetConfig } from './core/types.ts';
import { auditRuleSetPolicy } from './guardrail/policyCheck.ts';
import { runLoadSaturationTest } from './load/saturationTest.ts';

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

function loadConfig(relPath: string): RuleSetConfig {
  const abs = path.resolve(process.cwd(), relPath);
  return JSON.parse(fs.readFileSync(abs, 'utf-8')) as RuleSetConfig;
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

const baselineConfig = loadConfig('configs/rules.before.json');
const mutatedConfig = loadConfig('configs/rules.mutated.json');
const cappedConfig = loadConfig('configs/rules.capped.json');

const services: Record<string, SimulatedRolloutService> = {
  before: new SimulatedRolloutService(baselineConfig, 1),
  mutated: new SimulatedRolloutService(mutatedConfig, 1),
  capped: new SimulatedRolloutService(cappedConfig, 1),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/health') {
    return sendJson(res, 200, { status: 'ok', service: 'rollout-scope-guardrail-lab' });
  }

  if (pathname === '/') {
    return sendJson(res, 200, {
      name: 'Rollout Scope Guardrail & Load Amplification Lab (Headless API)',
      note: 'Simulated reliability lab — no frontend UI. Use CLI scripts or these JSON endpoints.',
      endpoints: {
        health: 'GET /health',
        evaluateRequest:
          'GET /api/inspect?mode=before|mutated|capped&cohort=free&region=us-east&userId=user-101',
        statusRoute:
          'GET /api/status?mode=before|mutated|capped&cohort=free&region=us-east&userId=user-101',
        policyAudit: 'GET /policy-audit?candidate=mutated|capped',
        loadSimulation: 'GET /simulate-load?requests=140&concurrency=28',
      },
      cliCommands: [
        'npm test',
        'npm run policy:check',
        'npm run policy:check:mutated',
        'npm run sim:load',
      ],
    });
  }

  if (pathname === '/policy-audit') {
    const candidateKey = url.searchParams.get('candidate') === 'capped' ? 'capped' : 'mutated';
    const candidate = candidateKey === 'capped' ? cappedConfig : mutatedConfig;
    const peakRps = Number(url.searchParams.get('peakRps') ?? '350') || 350;
    const report = auditRuleSetPolicy(baselineConfig, candidate, { assumedPeakRps: peakRps });
    return sendJson(res, report.passed ? 200 : 422, report);
  }

  if (pathname === '/simulate-load') {
    const totalRequests = Math.min(400, Math.max(20, Number(url.searchParams.get('requests') ?? '140') || 140));
    const concurrency = Math.min(64, Math.max(4, Number(url.searchParams.get('concurrency') ?? '28') || 28));
    const opts = {
      totalRequests,
      concurrency,
      timeScale: 0.5,
      maxErrorRatePercent: 1.0,
      maxP95LatencyMs: 100,
    };

    const [before, mutated, capped] = await Promise.all([
      runLoadSaturationTest(baselineConfig, opts),
      runLoadSaturationTest(mutatedConfig, opts),
      runLoadSaturationTest(cappedConfig, opts),
    ]);

    return sendJson(res, 200, {
      options: opts,
      scenarios: {
        before: { ...before, sampleResponses: undefined },
        mutated: { ...mutated, sampleResponses: undefined },
        capped: { ...capped, sampleResponses: undefined },
      },
    });
  }

  if (pathname.startsWith('/api/')) {
    const mode = url.searchParams.get('mode') ?? 'before';
    const svc = services[mode] ?? services.before;
    const cohort = (url.searchParams.get('cohort') ?? 'free') as Cohort;
    const region = (url.searchParams.get('region') ?? 'us-east') as Region;
    const userId = url.searchParams.get('userId') ?? `user-${Date.now()}`;

    const decision = await svc.handleRequest({
      requestId: `http-${Date.now()}`,
      userId,
      cohort,
      region,
      path: pathname,
    });

    return sendJson(res, decision.statusCode, {
      mode: mode in services ? mode : 'before',
      ...decision,
    });
  }

  return sendJson(res, 404, { error: 'Not Found', path: pathname });
});

server.listen(PORT, HOST, () => {
  console.log(`Rollout Scope Guardrail Lab HTTP server listening on http://${HOST}:${PORT}`);
});

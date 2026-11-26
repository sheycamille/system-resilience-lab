import { DEFAULT_TRAFFIC_MIX } from '../core/evaluator.ts';
import { SimulatedRolloutService } from '../core/service.ts';
import type {
  Cohort,
  IncomingRequest,
  Region,
  RuleSetConfig,
  SimulatedResponse,
  TrafficMix,
} from '../core/types.ts';

export interface LoadTestOptions {
  totalRequests?: number;
  concurrency?: number;
  /** Time acceleration factor for fast test runs (e.g. 0.15 = 15% of real ms) */
  timeScale?: number;
  maxErrorRatePercent?: number;
  maxP95LatencyMs?: number;
  trafficMix?: TrafficMix;
}

export interface LoadTestResult {
  configVersion: string;
  totalRequests: number;
  concurrency: number;
  durationWallMs: number;
  okCount: number;
  heavyOkCount: number;
  fastOkCount: number;
  degradedOkCount: number;
  rejected503Count: number;
  timeout504Count: number;
  errorRatePercent: number;
  degradedRatePercent: number;
  latencyMinMs: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  latencyMaxMs: number;
  peakActiveWorkers: number;
  peakQueueDepth: number;
  poolMaxWorkers: number;
  sloPassed: boolean;
  sloViolations: string[];
  sampleResponses: SimulatedResponse[];
}

function pickWeighted<T extends string>(weights: Record<T, number>, rand: number): T {
  const entries = Object.entries(weights) as [T, number][];
  let cumulative = 0;
  for (const [key, weight] of entries) {
    cumulative += weight;
    if (rand <= cumulative) {
      return key;
    }
  }
  return entries[entries.length - 1][0];
}

function deterministicFloat(index: number, salt: number): number {
  let x = (index + 1) * 374761393 + salt * 668265263;
  x = (x ^ (x >> 13)) * 1274126177;
  return ((x ^ (x >> 16)) >>> 0) / 4294967296;
}

export function generateSyntheticTraffic(
  count: number,
  mix: TrafficMix = DEFAULT_TRAFFIC_MIX,
): IncomingRequest[] {
  const requests: IncomingRequest[] = [];
  for (let i = 0; i < count; i++) {
    const cohort = pickWeighted<Cohort>(mix.cohorts, deterministicFloat(i, 1));
    const region = pickWeighted<Region>(mix.regions, deterministicFloat(i, 2));
    const path = deterministicFloat(i, 3) < mix.inspectPathShare ? '/api/inspect' : '/api/status';
    requests.push({
      requestId: `req-${String(i + 1).padStart(4, '0')}`,
      userId: `user-${1000 + i}`,
      cohort,
      region,
      path,
    });
  }
  return requests;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

/**
 * Runs concurrent simulated HTTP waves against the service to observe
 * worker saturation, queue contention, latency tail behavior, and 5xx rates.
 */
export async function runLoadSaturationTest(
  config: RuleSetConfig,
  options: LoadTestOptions = {},
): Promise<LoadTestResult> {
  const totalRequests = options.totalRequests ?? 140;
  const concurrency = options.concurrency ?? 28;
  const timeScale = options.timeScale ?? 0.5;
  const maxErrorRatePercent = options.maxErrorRatePercent ?? 1.0;
  const maxP95LatencyMs = options.maxP95LatencyMs ?? 100;
  const mix = options.trafficMix ?? DEFAULT_TRAFFIC_MIX;

  const service = new SimulatedRolloutService(config, timeScale);
  const requests = generateSyntheticTraffic(totalRequests, mix);
  const responses: SimulatedResponse[] = [];

  const wallStart = performance.now();

  // Dispatch requests in bounded concurrent batches to simulate burst pressure
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, totalRequests) }, async () => {
    while (cursor < requests.length) {
      const idx = cursor++;
      const res = await service.handleRequest(requests[idx]);
      responses.push(res);
    }
  });

  await Promise.all(workers);
  const durationWallMs = Number((performance.now() - wallStart).toFixed(1));

  const sortedLatencies = responses.map((r) => r.latencyMs).sort((a, b) => a - b);
  const okCount = responses.filter((r) => r.statusCode === 200).length;
  const heavyOkCount = responses.filter((r) => r.outcome === 'heavy_ok').length;
  const fastOkCount = responses.filter((r) => r.outcome === 'fast_ok').length;
  const degradedOkCount = responses.filter((r) => r.outcome === 'degraded_ok').length;
  const rejected503Count = responses.filter((r) => r.statusCode === 503).length;
  const timeout504Count = responses.filter((r) => r.statusCode === 504).length;

  const errorCount = rejected503Count + timeout504Count;
  const errorRatePercent = Number(((errorCount / totalRequests) * 100).toFixed(2));
  const degradedRatePercent = Number(((degradedOkCount / totalRequests) * 100).toFixed(2));

  const latencyP50Ms = percentile(sortedLatencies, 50);
  const latencyP95Ms = percentile(sortedLatencies, 95);
  const latencyP99Ms = percentile(sortedLatencies, 99);
  const latencyMinMs = sortedLatencies[0] ?? 0;
  const latencyMaxMs = sortedLatencies[sortedLatencies.length - 1] ?? 0;

  const poolSnapshot = service.getPoolSnapshot();

  const sloViolations: string[] = [];
  if (errorRatePercent > maxErrorRatePercent) {
    sloViolations.push(`5xx error rate ${errorRatePercent}% exceeded ${maxErrorRatePercent}% SLO`);
  }
  if (latencyP95Ms > maxP95LatencyMs) {
    sloViolations.push(`p95 latency ${latencyP95Ms}ms exceeded ${maxP95LatencyMs}ms SLO`);
  }

  return {
    configVersion: config.version,
    totalRequests,
    concurrency,
    durationWallMs,
    okCount,
    heavyOkCount,
    fastOkCount,
    degradedOkCount,
    rejected503Count,
    timeout504Count,
    errorRatePercent,
    degradedRatePercent,
    latencyMinMs,
    latencyP50Ms,
    latencyP95Ms,
    latencyP99Ms,
    latencyMaxMs,
    peakActiveWorkers: poolSnapshot.peakActiveWorkers,
    peakQueueDepth: poolSnapshot.peakQueueDepth,
    poolMaxWorkers: poolSnapshot.maxWorkers,
    sloPassed: sloViolations.length === 0,
    sloViolations,
    sampleResponses: responses.slice(0, 12),
  };
}

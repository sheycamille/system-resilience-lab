export type Cohort = 'internal' | 'beta' | 'free' | 'pro' | 'enterprise';
export type Region = 'us-east' | 'eu-west' | 'ap-south';

export type CohortFilter = Cohort | '*';
export type RegionFilter = Region | '*';

export interface RolloutScope {
  /** Empty array or ['*'] matches all cohorts */
  cohorts: CohortFilter[];
  /** Empty array or ['*'] matches all regions */
  regions: RegionFilter[];
  /** Percentage of matching traffic (0..100) */
  rolloutPercent: number;
  /** Optional API path prefix filter; omitted or '*' matches all paths */
  pathPrefix?: string;
}

export interface ExecutionProfile {
  /** Simulated downstream processing cost in milliseconds */
  executionCostMs: number;
  /** Optional bulkhead cap limiting concurrent heavy executions for this rule */
  maxConcurrencyCap?: number;
  /** Behavior when bulkhead cap is reached */
  fallbackOnCap: 'degrade_fast' | 'reject_503';
}

export interface RolloutApproval {
  approvedBy: string;
  ticketId: string;
  maxAllowedAudiencePercent: number;
  reason: string;
}

export interface RolloutRule {
  id: string;
  name: string;
  enabled: boolean;
  scope: RolloutScope;
  execution: ExecutionProfile;
  approval?: RolloutApproval | null;
}

export interface WorkerPoolConfig {
  maxWorkers: number;
  maxQueueSize: number;
  requestTimeoutMs: number;
}

export interface RuleSetConfig {
  version: string;
  description: string;
  workerPoolConfig: WorkerPoolConfig;
  rules: RolloutRule[];
}

export interface IncomingRequest {
  requestId: string;
  userId: string;
  cohort: Cohort;
  region: Region;
  path: string;
}

export interface EvaluationDecision {
  matched: boolean;
  rule: RolloutRule | null;
  reason: string;
  bucket: number;
}

export interface TrafficMix {
  cohorts: Record<Cohort, number>;
  regions: Record<Region, number>;
  inspectPathShare: number;
}

export type RequestOutcome = 'heavy_ok' | 'fast_ok' | 'degraded_ok' | 'rejected_503' | 'timeout_504';

export interface SimulatedResponse {
  requestId: string;
  statusCode: 200 | 503 | 504;
  outcome: RequestOutcome;
  matchedRuleId: string | null;
  latencyMs: number;
  queueWaitMs: number;
  workerUsed: boolean;
  degraded: boolean;
  reason: string;
}

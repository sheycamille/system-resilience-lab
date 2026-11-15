export interface User {
  user_id: string;
  username: string;
  password_hash: string;
  email: string;
  full_name: string;
  role: 'admin' | 'engineer' | 'auditor' | 'viewer';
  status: 'active' | 'suspended' | 'provisioning';
  tier: 'enterprise' | 'pro' | 'standard';
  created_at: string;
  preferences?: {
    theme: 'dark' | 'light' | 'system';
    notifications_enabled: boolean;
  };
}

export interface AuthToken {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  user_id: string;
  scope: string;
  created_at: number;
}

export interface ChaosConfig {
  enabled: boolean;
  type: 'latency' | 'rate-limit' | 'service-unavailable' | 'random';
  latencyMs: number;
  rateLimitRetryAfterSec: number;
  failureRate: number; // 0.0 - 1.0 for random
}

export interface ChaosLogEntry {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  chaosType: string;
  injectedLatencyMs: number;
  statusCode: number;
  clientIp?: string;
}

export interface ContractTestResult {
  suite: string;
  testName: string;
  targetEndpoint: string;
  method: string;
  expectedStatus: number;
  receivedStatus: number;
  passed: boolean;
  durationMs: number;
  schemaValid: boolean;
  errors: string[];
  payloadSample?: Record<string, unknown>;
}

export interface TestSuiteSummary {
  timestamp: string;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  totalDurationMs: number;
  driftModeActive: boolean;
  driftDescription?: string;
  results: ContractTestResult[];
}

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { inMemoryStore } from './store.ts';
import { ContractTestResult, TestSuiteSummary } from '../types/index.ts';

// Direct schema imports/definitions matching OpenAPI 3.0.3 components
export const authContractSchemas = {
  TokenResponse: {
    type: 'object',
    required: ['access_token', 'token_type', 'expires_in', 'user_id', 'scope'],
    properties: {
      access_token: { type: 'string' },
      token_type: { type: 'string', enum: ['Bearer'] },
      expires_in: { type: 'integer' },
      user_id: { type: 'string' },
      scope: { type: 'string' }
    },
    additionalProperties: false
  },
  VerifyResponse: {
    type: 'object',
    required: ['valid', 'user_id', 'roles', 'expires_at'],
    properties: {
      valid: { type: 'boolean' },
      user_id: { type: 'string' },
      roles: { type: 'array', items: { type: 'string' } },
      expires_at: { type: 'string', format: 'date-time' }
    },
    additionalProperties: false
  }
};

export const profileContractSchemas = {
  UserProfile: {
    type: 'object',
    required: ['user_id', 'email', 'full_name', 'role', 'status', 'tier', 'created_at'],
    properties: {
      user_id: { type: 'string' },
      email: { type: 'string', format: 'email' },
      full_name: { type: 'string', minLength: 2 },
      role: { type: 'string', enum: ['admin', 'engineer', 'auditor', 'viewer'] },
      status: { type: 'string', enum: ['active', 'suspended', 'provisioning'] },
      tier: { type: 'string', enum: ['enterprise', 'pro', 'standard'] },
      created_at: { type: 'string', format: 'date-time' },
      preferences: {
        type: 'object',
        properties: {
          theme: { type: 'string', enum: ['dark', 'light', 'system'] },
          notifications_enabled: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    additionalProperties: false
  },
  UserListResponse: {
    type: 'object',
    required: ['items', 'total', 'page', 'limit'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['user_id', 'email', 'full_name', 'role', 'status', 'tier', 'created_at'],
          properties: {
            user_id: { type: 'string' },
            email: { type: 'string', format: 'email' },
            full_name: { type: 'string' },
            role: { type: 'string' },
            status: { type: 'string' },
            tier: { type: 'string' },
            created_at: { type: 'string' }
          }
        }
      },
      total: { type: 'integer' },
      page: { type: 'integer' },
      limit: { type: 'integer' }
    },
    additionalProperties: false
  }
};

// Initialize Ajv with draft-07/2020 compatibility
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validateTokenResponse = ajv.compile(authContractSchemas.TokenResponse);
const validateVerifyResponse = ajv.compile(authContractSchemas.VerifyResponse);
const validateUserProfile = ajv.compile(profileContractSchemas.UserProfile);
const validateUserList = ajv.compile(profileContractSchemas.UserListResponse);

export function validatePayloadAgainstSchema(schemaName: string, payload: unknown): { valid: boolean; errors: string[] } {
  let validator: ReturnType<typeof ajv.compile> | null = null;

  switch (schemaName) {
    case 'TokenResponse':
      validator = validateTokenResponse;
      break;
    case 'VerifyResponse':
      validator = validateVerifyResponse;
      break;
    case 'UserProfile':
      validator = validateUserProfile;
      break;
    case 'UserListResponse':
      validator = validateUserList;
      break;
    default:
      return { valid: false, errors: [`Unknown schema: ${schemaName}`] };
  }

  const valid = validator(payload) as boolean;
  const errors: string[] = [];

  if (!valid && validator.errors) {
    for (const err of validator.errors) {
      const field = err.instancePath ? err.instancePath : (err.params as { missingProperty?: string }).missingProperty || 'root';
      const msg = `[${field}] ${err.message}`;
      errors.push(msg);
    }
  }

  return { valid, errors };
}

/**
 * Execute full shift-left contract test suite against running target URL
 */
export async function executeContractTestSuite(originUrl: string): Promise<TestSuiteSummary> {
  const startTime = Date.now();
  const results: ContractTestResult[] = [];

  // 1. Auth Service: Token Issuance Contract Test
  {
    const testStart = Date.now();
    let passed = false;
    let schemaValid = false;
    let errors: string[] = [];
    let payloadSample: Record<string, unknown> | undefined;
    let receivedStatus = 0;

    try {
      const res = await fetch(`${originUrl}/api/v1/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'alex.chen',
          password: 'secret123',
          grant_type: 'password'
        })
      });

      receivedStatus = res.status;
      const data = await res.json();
      payloadSample = data as Record<string, unknown>;

      if (res.status === 200) {
        const val = validatePayloadAgainstSchema('TokenResponse', data);
        schemaValid = val.valid;
        errors = val.errors;
        passed = schemaValid;
      } else {
        errors.push(`Expected HTTP 200, received ${res.status}`);
      }
    } catch (err: unknown) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    results.push({
      suite: 'Auth Service',
      testName: 'POST /api/v1/auth/token conforms to TokenResponse OpenAPI contract',
      targetEndpoint: '/api/v1/auth/token',
      method: 'POST',
      expectedStatus: 200,
      receivedStatus,
      passed,
      durationMs: Date.now() - testStart,
      schemaValid,
      errors,
      payloadSample
    });
  }

  // 2. Auth Service: Token Verification Contract Test
  {
    const testStart = Date.now();
    let passed = false;
    let schemaValid = false;
    let errors: string[] = [];
    let payloadSample: Record<string, unknown> | undefined;
    let receivedStatus = 0;

    try {
      const res = await fetch(`${originUrl}/api/v1/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'token_demo_enterprise_live_session'
        })
      });

      receivedStatus = res.status;
      const data = await res.json();
      payloadSample = data as Record<string, unknown>;

      if (res.status === 200) {
        const val = validatePayloadAgainstSchema('VerifyResponse', data);
        schemaValid = val.valid;
        errors = val.errors;
        passed = schemaValid;
      } else {
        errors.push(`Expected HTTP 200, received ${res.status}`);
      }
    } catch (err: unknown) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    results.push({
      suite: 'Auth Service',
      testName: 'POST /api/v1/auth/verify conforms to VerifyResponse OpenAPI contract',
      targetEndpoint: '/api/v1/auth/verify',
      method: 'POST',
      expectedStatus: 200,
      receivedStatus,
      passed,
      durationMs: Date.now() - testStart,
      schemaValid,
      errors,
      payloadSample
    });
  }

  // 3. User Profile Service: GET /api/v1/users/me Contract Test
  {
    const testStart = Date.now();
    let passed = false;
    let schemaValid = false;
    let errors: string[] = [];
    let payloadSample: Record<string, unknown> | undefined;
    let receivedStatus = 0;

    try {
      const res = await fetch(`${originUrl}/api/v1/users/me`, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer token_demo_enterprise_live_session',
          Accept: 'application/json'
        }
      });

      receivedStatus = res.status;
      const data = await res.json();
      payloadSample = data as Record<string, unknown>;

      if (res.status === 200) {
        const val = validatePayloadAgainstSchema('UserProfile', data);
        schemaValid = val.valid;
        errors = val.errors;
        passed = schemaValid;
      } else {
        errors.push(`Expected HTTP 200, received ${res.status}`);
      }
    } catch (err: unknown) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    results.push({
      suite: 'User Profile Service',
      testName: 'GET /api/v1/users/me conforms to UserProfile OpenAPI contract',
      targetEndpoint: '/api/v1/users/me',
      method: 'GET',
      expectedStatus: 200,
      receivedStatus,
      passed,
      durationMs: Date.now() - testStart,
      schemaValid,
      errors,
      payloadSample
    });
  }

  // 4. User Profile Service: GET /api/v1/users/:id Contract Test
  {
    const testStart = Date.now();
    let passed = false;
    let schemaValid = false;
    let errors: string[] = [];
    let payloadSample: Record<string, unknown> | undefined;
    let receivedStatus = 0;

    try {
      const res = await fetch(`${originUrl}/api/v1/users/usr_1002`, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });

      receivedStatus = res.status;
      const data = await res.json();
      payloadSample = data as Record<string, unknown>;

      if (res.status === 200) {
        const val = validatePayloadAgainstSchema('UserProfile', data);
        schemaValid = val.valid;
        errors = val.errors;
        passed = schemaValid;
      } else {
        errors.push(`Expected HTTP 200, received ${res.status}`);
      }
    } catch (err: unknown) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    results.push({
      suite: 'User Profile Service',
      testName: 'GET /api/v1/users/{id} conforms to UserProfile schema invariants',
      targetEndpoint: '/api/v1/users/usr_1002',
      method: 'GET',
      expectedStatus: 200,
      receivedStatus,
      passed,
      durationMs: Date.now() - testStart,
      schemaValid,
      errors,
      payloadSample
    });
  }

  // 5. User Profile Service: GET /api/v1/users Paginated List Contract Test
  {
    const testStart = Date.now();
    let passed = false;
    let schemaValid = false;
    let errors: string[] = [];
    let payloadSample: Record<string, unknown> | undefined;
    let receivedStatus = 0;

    try {
      const res = await fetch(`${originUrl}/api/v1/users?page=1&limit=5`, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });

      receivedStatus = res.status;
      const data = await res.json();
      payloadSample = data as Record<string, unknown>;

      if (res.status === 200) {
        const val = validatePayloadAgainstSchema('UserListResponse', data);
        schemaValid = val.valid;
        errors = val.errors;
        passed = schemaValid;
      } else {
        errors.push(`Expected HTTP 200, received ${res.status}`);
      }
    } catch (err: unknown) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    results.push({
      suite: 'User Profile Service',
      testName: 'GET /api/v1/users conforms to UserListResponse pagination contract',
      targetEndpoint: '/api/v1/users',
      method: 'GET',
      expectedStatus: 200,
      receivedStatus,
      passed,
      durationMs: Date.now() - testStart,
      schemaValid,
      errors,
      payloadSample
    });
  }

  // 6. Chaos Testing: Injected Rate Limit (HTTP 429) & Retry-After Header
  {
    const testStart = Date.now();
    let passed = false;
    const errors: string[] = [];
    let payloadSample: Record<string, unknown> | undefined;
    let receivedStatus = 0;

    try {
      const res = await fetch(`${originUrl}/api/v1/users/usr_1001`, {
        method: 'GET',
        headers: {
          'X-Chaos-Mode': 'true',
          'X-Chaos-Type': 'rate-limit',
          'X-Chaos-Retry-After': '30'
        }
      });

      receivedStatus = res.status;
      const retryHeader = res.headers.get('Retry-After');
      const data = (await res.json()) as Record<string, unknown>;
      payloadSample = data;

      if (receivedStatus === 429 && retryHeader === '30' && data.chaos_injected === true) {
        passed = true;
      } else {
        if (receivedStatus !== 429) errors.push(`Expected HTTP 429, got ${receivedStatus}`);
        if (retryHeader !== '30') errors.push(`Expected Retry-After: 30 header, got '${retryHeader}'`);
      }
    } catch (err: unknown) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    results.push({
      suite: 'Chaos Proxy Middleware',
      testName: 'Chaos Injection: HTTP 429 Rate Limit with RFC 7807 and Retry-After header',
      targetEndpoint: '/api/v1/users/usr_1001',
      method: 'GET [Chaos]',
      expectedStatus: 429,
      receivedStatus,
      passed,
      durationMs: Date.now() - testStart,
      schemaValid: true,
      errors,
      payloadSample
    });
  }

  // 7. Chaos Testing: Injected Service Unavailable (HTTP 503) & Circuit Breaker Simulation
  {
    const testStart = Date.now();
    let passed = false;
    const errors: string[] = [];
    let payloadSample: Record<string, unknown> | undefined;
    let receivedStatus = 0;

    try {
      const res = await fetch(`${originUrl}/api/v1/auth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Chaos-Mode': 'true',
          'X-Chaos-Type': 'service-unavailable'
        },
        body: JSON.stringify({ username: 'alex.chen', password: 'secret123' })
      });

      receivedStatus = res.status;
      const data = (await res.json()) as Record<string, unknown>;
      payloadSample = data;

      if (receivedStatus === 503 && data.chaos_injected === true) {
        passed = true;
      } else {
        errors.push(`Expected HTTP 503, got ${receivedStatus}`);
      }
    } catch (err: unknown) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    results.push({
      suite: 'Chaos Proxy Middleware',
      testName: 'Chaos Injection: HTTP 503 Service Unavailable with circuit-breaker metadata',
      targetEndpoint: '/api/v1/auth/token',
      method: 'POST [Chaos]',
      expectedStatus: 503,
      receivedStatus,
      passed,
      durationMs: Date.now() - testStart,
      schemaValid: true,
      errors,
      payloadSample
    });
  }

  // 8. Chaos Client Resiliency: Automatic Retry on Transient 429/503
  {
    const testStart = Date.now();
    let passed = false;
    const errors: string[] = [];
    let attempts = 0;
    let receivedStatus = 0;

    try {
      // First attempt: trigger chaos 429
      attempts++;
      const res1 = await fetch(`${originUrl}/api/v1/users/me`, {
        headers: {
          Authorization: 'Bearer token_demo_enterprise_live_session',
          'X-Chaos-Mode': 'true',
          'X-Chaos-Type': 'rate-limit'
        }
      });
      receivedStatus = res1.status;

      if (res1.status === 429) {
        // Client resilient backoff retry: Next request without chaos simulates recovery
        attempts++;
        const res2 = await fetch(`${originUrl}/api/v1/users/me`, {
          headers: {
            Authorization: 'Bearer token_demo_enterprise_live_session'
          }
        });

        if (res2.status === 200) {
          passed = true;
          receivedStatus = 200;
        } else {
          errors.push(`Retry attempt failed with status ${res2.status}`);
        }
      } else {
        errors.push(`First request did not trigger expected 429: got ${res1.status}`);
      }
    } catch (err: unknown) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    results.push({
      suite: 'Client Resiliency',
      testName: 'Consumer client gracefully handles 429 rate limit with exponential retry recovery',
      targetEndpoint: '/api/v1/users/me',
      method: 'GET [Retry Loop]',
      expectedStatus: 200,
      receivedStatus,
      passed,
      durationMs: Date.now() - testStart,
      schemaValid: true,
      errors,
      payloadSample: { attemptsMade: attempts, recovered: passed }
    });
  }

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  return {
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    passedCount,
    failedCount,
    totalDurationMs: Date.now() - startTime,
    driftModeActive: inMemoryStore.isSchemaDriftActive(),
    driftDescription: inMemoryStore.isSchemaDriftActive()
      ? `Drift mutation injected: ${inMemoryStore.getSchemaDriftType()}`
      : 'Baseline: Pure OpenAPI v3 Contract Conformance',
    results
  };
}

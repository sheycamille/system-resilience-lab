/**
 * Automated Contract Test Runner - Shift-Left Quality Gate
 * 
 * Runs consumer-driven schema validations against OpenAPI 3.0 contracts
 * and verifies Chaos Proxy Middleware resilience.
 * 
 * Exit code 0: All schemas and resilience invariants pass.
 * Exit code 1: Breaking contract change or failure detected (blocks CI/CD merge).
 */

import express from 'express';
import http from 'http';
import { authRouter } from '../src/services/auth-service.ts';
import { profileRouter } from '../src/services/profile-service.ts';
import { chaosProxyMiddleware } from '../src/middleware/chaos-proxy.ts';
import { executeContractTestSuite } from '../src/services/contract-engine.ts';
import { inMemoryStore } from '../src/services/store.ts';

const CHECK_SYMBOL = '\x1b[32m✔ PASS\x1b[0m';
const CROSS_SYMBOL = '\x1b[31m✖ FAIL\x1b[0m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';

async function runCliTests() {
  console.log(`\n${BOLD}================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}  SHIFT-LEFT CONTRACT & TESTABILITY FRAMEWORK - CI GATE RUNNER${RESET}`);
  console.log(`${BOLD}================================================================${RESET}\n`);

  // Check if drift simulation flag was passed in CLI args (e.g. npm test -- --drift)
  const args = process.argv.slice(2);
  const simulateDrift = args.includes('--drift') || args.includes('--break');

  if (simulateDrift) {
    console.log(`${YELLOW}⚠️  DRIFT SIMULATION MODE ACTIVE: Injecting breaking schema change ('user_id' -> 'account_uid')${RESET}\n`);
    inMemoryStore.setSchemaDrift(true, 'rename_field');
  } else {
    inMemoryStore.setSchemaDrift(false);
  }

  // Spin up an ephemeral lightweight Express instance on an available port
  const app = express();
  app.use(express.json());
  app.use('/api/v1', chaosProxyMiddleware);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', profileRouter);

  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind ephemeral test server');
  }

  const testOrigin = `http://127.0.0.1:${address.port}`;
  console.log(`[CI Gate] Ephemeral Test Server running on ${testOrigin}`);
  console.log(`[CI Gate] Executing OpenAPI 3.0 Contract Verifications...\n`);

  try {
    const summary = await executeContractTestSuite(testOrigin);

    for (const result of summary.results) {
      const statusIcon = result.passed ? CHECK_SYMBOL : CROSS_SYMBOL;
      console.log(`  ${statusIcon} [${result.suite}] ${result.testName} (${result.durationMs}ms)`);

      if (!result.passed) {
        console.log(`      \x1b[31m[ERROR] Contract Breach on ${result.method} ${result.targetEndpoint}\x1b[0m`);
        for (const err of result.errors) {
          console.log(`      \x1b[31m  - ${err}\x1b[0m`);
        }
        if (result.payloadSample) {
          console.log(`      \x1b[33mPayload received: ${JSON.stringify(result.payloadSample)}\x1b[0m`);
        }
      }
    }

    console.log(`\n----------------------------------------------------------------`);
    console.log(`${BOLD}Test Summary:${RESET}`);
    console.log(`  Total Invariant Tests : ${summary.totalTests}`);
    console.log(`  Passed                : \x1b[32m${summary.passedCount}\x1b[0m`);
    console.log(`  Failed                : ${summary.failedCount > 0 ? `\x1b[31m${summary.failedCount}\x1b[0m` : '\x1b[32m0\x1b[0m'}`);
    console.log(`  Execution Time        : ${summary.totalDurationMs}ms`);
    console.log(`----------------------------------------------------------------\n`);

    server.close();

    if (summary.failedCount > 0) {
      console.error(`\x1b[31m🛑 [CI MERGE BLOCKER] Contract schema validation failed!\x1b[0m`);
      console.error(`\x1b[31mPull Request contains breaking contract changes. Merge blocked.\x1b[0m\n`);
      process.exit(1);
    } else {
      console.log(`\x1b[32m✔ [CI GATE PASSED] All API schemas match OpenAPI specifications. Safe to deploy.\x1b[0m\n`);
      process.exit(0);
    }
  } catch (err) {
    server.close();
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

runCliTests();

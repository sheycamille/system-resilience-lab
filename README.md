# The Shift-Left Contract & Testability Framework

> **A lightweight, headless reference architecture for consumer-driven API contract enforcement, inline chaos testing, and CI/CD quality gates.**

---

## Executive Summary

In distributed microservice architectures, **silent schema drift** is one of the most expensive classes of outages. When a provider service renames a JSON field (e.g., `user_id` &rarr; `account_uid`), drops a required property, or mutates a data type, downstream consumers fail with unhandled parsing exceptions.

Traditional teams rely on shared staging environments and slow end-to-end integration tests to catch these regressions—by which time the author has switched context and pipelines are backed up.

**The Shift-Left Contract & Testability Framework** prevents silent breaking changes before code ever reaches staging:
- **Pre-Merge Contract Enforcement:** Every Pull Request validates live microservice JSON payloads against strict OpenAPI 3.0.3 schemas (`contracts/auth-schema.json` and `contracts/profile-schema.json`) using Ajv. Any drift returns exit code `1` and blocks merging in GitHub Actions.
- **Fast Feedback Loop:** The full contract + chaos resilience suite executes in **~120ms** against an ephemeral in-memory server.
- **Zero Infrastructure Overhead:** Pure Node.js + Express + TypeScript with in-memory maps. No Docker clusters, no external databases, and no UI build steps required.

---

## System Architecture

```mermaid
flowchart TD
    subgraph CI_CD["GitHub Actions CI/CD Quality Gate (.github/workflows/ci.yml)"]
        direction TB
        PR["Pull Request Created / Push"] --> Lint["01. TypeScript Check (npm run lint)"]
        Lint --> ContractGate["02. Shift-Left Contract Verification Gate\n(npm test)"]
        ContractGate -->|Schema Drift Detected| Block["MERGE BLOCKED\n(Exit Code 1 + JSON Path Diff)"]
        ContractGate -->|All Schemas Match| ChaosGate["03. Chaos Proxy Resilience Gate"]
        ChaosGate -->|Survives 429 & 503| Pass["MERGE APPROVED"]
    end

    subgraph Runtime["Headless Microservice Gateway (In-Memory Runtime)"]
        Client["API Client / Test Runner"] --> ChaosProxy["Lightweight Chaos Proxy Middleware\n(Header: X-Chaos-Mode: true)"]

        ChaosProxy -->|Normal Traffic| Routing{Service Router}
        ChaosProxy -.->|X-Chaos-Type: rate-limit| E429["HTTP 429 Too Many Requests\n(Retry-After: 30 + RFC 7807)"]
        ChaosProxy -.->|X-Chaos-Type: service-unavailable| E503["HTTP 503 Service Unavailable\n(Circuit Breaker Simulation)"]
        ChaosProxy -.->|X-Chaos-Type: latency| Latency["Simulated Network Latency\n(Configurable ms delay)"]

        Routing --> AuthService["Auth Microservice\nPOST /api/v1/auth/token\nPOST /api/v1/auth/verify"]
        Routing --> ProfileService["User Profile Microservice\nGET /api/v1/users/me\nGET /api/v1/users/:id\nGET /api/v1/users"]

        AuthService <--> Store[("In-Memory Store\n(src/services/store.ts)")]
        ProfileService <--> Store
    end

    subgraph OpenAPI["OpenAPI 3.0.3 Contract Schemas"]
        AuthSchema["contracts/auth-schema.json"]
        ProfileSchema["contracts/profile-schema.json"]
    end

    ContractGate -.->|Validates Against| AuthSchema
    ContractGate -.->|Validates Against| ProfileSchema
```

---

## Project Structure

```text
.
├── .github/workflows/ci.yml      # 3-stage GitHub Actions PR quality gate
├── contracts/
│   ├── auth-schema.json          # OpenAPI 3.0.3 contract for Auth Service
│   └── profile-schema.json       # OpenAPI 3.0.3 contract for User Profile Service
├── src/
│   ├── middleware/
│   │   └── chaos-proxy.ts        # Latency, HTTP 429 & HTTP 503 fault injection
│   ├── services/
│   │   ├── auth-service.ts       # Auth microservice router + drift simulation hook
│   │   ├── profile-service.ts    # User profile microservice router
│   │   ├── contract-engine.ts    # Ajv OpenAPI schema validator & test suite
│   │   └── store.ts              # In-memory data store (seeded with test users)
│   └── types/index.ts            # Shared TypeScript interfaces
├── tests/
│   └── run-contract-tests.ts     # Automated CLI contract & chaos test runner
├── server.ts                     # Headless Express gateway entry point (port 3000)
└── package.json
```

---

## 3-Step Local Quickstart (Under 2 Minutes)

**Prerequisites:** Node.js 20+ and npm.

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Run the Automated Contract & Chaos Test Suite
```bash
npm test
```
This spins up an ephemeral in-memory Express server on a random local port, runs all 8 contract and chaos resilience assertions, prints a pass/fail summary, and exits (`0` on pass, `1` on failure).

### Step 3: Start the Headless API Server (Optional Manual Testing)
```bash
npm run dev
```
The Express gateway starts on `http://localhost:3000`.

---

## How to Test Each Feature Manually (`curl`)

Once `npm run dev` is running on port `3000`:

### 1. Inspect Service Discovery & OpenAPI Schemas
```bash
curl -s http://localhost:3000/ | jq
curl -s http://localhost:3000/api/openapi/auth.json | jq
curl -s http://localhost:3000/api/openapi/profile.json | jq
```

### 2. Call the Microservices (Normal Traffic)
```bash
# Issue an auth token
curl -s -X POST http://localhost:3000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"username":"alex.chen","password":"secret123"}' | jq

# Fetch authenticated user profile
curl -s http://localhost:3000/api/v1/users/me \
  -H "Authorization: Bearer token_demo_enterprise_live_session" | jq

# List all in-memory users
curl -s http://localhost:3000/api/v1/users | jq
```

### 3. Trigger the Chaos Proxy Middleware
Pass `X-Chaos-Mode: true` along with `X-Chaos-Type` to inject faults without touching application code:

```bash
# Simulate HTTP 429 Rate Limit with Retry-After: 30
curl -i -H "X-Chaos-Mode: true" -H "X-Chaos-Type: rate-limit" \
  http://localhost:3000/api/v1/users/me

# Simulate HTTP 503 Service Unavailable
curl -i -H "X-Chaos-Mode: true" -H "X-Chaos-Type: service-unavailable" \
  http://localhost:3000/api/v1/users/me

# Simulate 1500ms network latency
curl -i -H "X-Chaos-Mode: true" -H "X-Chaos-Type: latency" -H "X-Chaos-Latency-Ms: 1500" \
  http://localhost:3000/api/v1/users/me
```

---

## Proving the CI Gate: Simulating a Breaking Contract Change

To verify that the test suite catches silent schema drift and blocks a Pull Request from merging, run:

```bash
npm run test:drift
```
*(or `npx tsx tests/run-contract-tests.ts --drift`)*

This injects a simulated breaking change (`user_id` renamed to `account_uid` / `id`). The contract runner immediately detects the missing required property and disallowed additional property, prints the exact JSON path violation, and exits with code `1`:

```text
  ✖ FAIL [Auth Service] POST /api/v1/auth/token conforms to TokenResponse OpenAPI contract
      [ERROR] Contract Breach on POST /api/v1/auth/token
        - [user_id] must have required property 'user_id'
        - [root] must NOT have additional properties

🛑 [CI MERGE BLOCKER] Contract schema validation failed!
Pull Request contains breaking contract changes. Merge blocked.
```

---

## Available NPM Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the headless Express API gateway on port `3000` |
| `npm test` | Runs all 8 OpenAPI contract & chaos middleware tests (exits `0` or `1`) |
| `npm run test:drift` | Simulates breaking schema drift to prove the CI gate blocks merges |
| `npm run lint` | Runs strict TypeScript typechecking (`tsc --noEmit`) |
| `npm run build` | Typechecks and bundles `server.ts` into `dist/server.js` |

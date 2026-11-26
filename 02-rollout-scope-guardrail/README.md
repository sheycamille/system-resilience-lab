# Rollout Scope Guardrail & Load Amplification Lab

A lightweight, runnable reliability engineering lab modeling how a single-line feature-flag or routing scope mistake can amplify traffic onto an expensive execution path—and how automated **policy guardrails**, **Little's Law capacity projections**, and **concurrency bulkheads** catch and contain the blast radius before users experience slowdowns or 5xx errors.

> **Scope & Honesty Note:** This is a self-contained **simulated model and automated test suite**, not a replay of any live production outage. It draws inspiration from real-world configuration incidents (such as Cloudflare's July 17, 2020 backbone outage, where a single-line rule change removed a route-scope guard and overloaded downstream capacity) to demonstrate practical quality and reliability engineering controls.

---

## Why 1% Canary & Single-User Tests Miss Scope Leaks

Standard functional tests typically check questions like:
- *"Does `/api/inspect` return HTTP 200 for an internal test user?"*
- *"Does the rule JSON parse cleanly?"*

Even a **1% canary test** in staging often passes when a rule's cohort or region filter is accidentally widened—because staging traffic volume is too low to saturate downstream workers.

In production, however, dropping a filter such as `cohorts: ["internal"]` or widening `rolloutPercent` from `5%` to `100%` can trigger a **1,000x–4,000x+ load amplification** on an expensive code path (`55ms` vs. `2ms` baseline). When that path shares a bounded worker pool (`maxWorkers: 8`), the pool saturates immediately:
1. Healthy baseline routes (`/api/status`) get stuck behind heavy requests in the shared queue.
2. Tail latency (`p95`/`p99`) spikes past SLA timeouts (`504 Gateway Timeout`).
3. Bounded queues overflow (`503 Service Unavailable`), forcing an emergency rollback.

---

## How This Lab Prevents That Failure Mode

1. **Simulated Service & Deterministic Rule Evaluator (`src/core/`)**
   - Evaluates `cohorts`, `regions`, `pathPrefix`, and deterministic FNV-1a `rolloutPercent` buckets.
   - Routes matched traffic through an expensive path (`55ms`) and unmatched traffic through a fast baseline path (`2ms`), backed by a shared `BoundedWorkerPool` with queue limits and SLA timeouts.
2. **Pre-Merge Scope & Capacity Policy Guardrail (`src/guardrail/policyCheck.ts`)**
   - Diffs candidate rule configurations against the production baseline.
   - Blocks unapproved wildcard widening (`cohorts: ["*"]` / `[]`), multi-fold audience jumps (`> 5x`), missing bulkhead caps (`maxConcurrencyCap`), and Little's Law pool saturation (`projectedWorkers > 85%` of pool capacity).
3. **Concurrent Load & Saturation Tests (`src/load/saturationTest.ts`, `tests/`)**
   - Fires concurrent request waves against three configurations:
     - `configs/rules.before.json` — Scoped internal canary (`~0.02%` traffic, passes SLOs).
     - `configs/rules.mutated.json` — Unbounded scope leak (`100%` traffic, saturates pool, triggers 504 timeouts & breaches latency SLO).
     - `configs/rules.capped.json` — Explicitly approved expansion (`25%` rollout) protected by a `3-worker` bulkhead and `degrade_fast` fallback (`0%` 5xx errors).
4. **Automated CI Gate (`.github/workflows/ci.yml`)**
   - Runs TypeScript typechecking, unit/load tests, and policy checks on every pull request.

---

## Project Structure

```text
├── .github/workflows/ci.yml      # PR/push CI running lint, tests, and policy checks
├── configs/
│   ├── rules.before.json         # Safe baseline (internal cohort, us-east, 5%, bulkhead cap)
│   ├── rules.mutated.json        # Simulated scope leak (wildcard * at 100%, no cap)
│   └── rules.capped.json         # Guarded expansion (approved ticket + 3-worker bulkhead)
├── scripts/
│   ├── run-policy-check.ts       # CLI policy diff checker (exits non-zero on critical findings)
│   └── run-load-sim.ts           # CLI concurrent load comparison across all 3 configs
├── src/
│   ├── core/
│   │   ├── types.ts              # Domain types for rules, requests, pool, and responses
│   │   ├── evaluator.ts          # Deterministic FNV-1a bucketing & traffic-mix estimator
│   │   ├── workerPool.ts         # Bounded async worker pool with queue & SLA timeouts
│   │   └── service.ts            # Simulated handler with per-rule concurrency bulkheads
│   ├── guardrail/
│   │   └── policyCheck.ts        # Static & Little's Law scope-amplification auditor
│   └── load/
│       └── saturationTest.ts     # Concurrent wave runner & p50/p95/5xx SLO evaluator
└── tests/
    ├── guardrail.test.ts         # Policy guardrail unit & diff tests
    └── load.test.ts              # Behavioral concurrency & saturation tests
```

---

## Running Locally (Under 2 Minutes)

Prerequisites: **Node.js 20+** (tested on Node 22). No external database, browser, or Docker required.

```bash
# 1. Install dependencies
npm install

# 2. Run the automated guardrail & load saturation test suite
npm test

# 3. Run the policy guardrail against the safe capped config (exits 0)
npm run policy:check

# 4. Run the policy guardrail against the leaked config (exits 1 and explains why)
npm run policy:check:mutated

# 5. Run the side-by-side concurrent load simulation in your terminal
npm run sim:load

# 6. Run full CI verification locally (typecheck + tests + policy check)
npm run ci:verify
```

---

## How to Talk About This (Interviews & LinkedIn)

Keep your framing accurate, grounded, and focused on engineering judgment:

### Interview Talking Points
- **Problem Framing:** *"Functional tests verify whether a feature works for one user; reliability testing asks what happens to shared capacity if a rule accidentally matches 100x more traffic."*
- **Defense in Depth:** *"I modeled two complementary layers: a pre-merge policy diff check that uses traffic-mix weights and Little's Law to block unapproved scope amplification, and a runtime concurrency bulkhead (`maxConcurrencyCap` + `degrade_fast`) so even an approved expansion degrades gracefully instead of starving healthy routes."*
- **Honest Limitations:** *"This uses an in-process simulated worker pool rather than distributed network hosts, which makes it fast enough to run in CI on every pull request while accurately demonstrating queueing contention and tail-latency spikes."*

### Sample LinkedIn Post (Grounded & Non-Overclaiming)
> Many high-impact outages aren't caused by broken business logic—they happen when a configuration change quietly widens who or what a rule applies to.
>
> Inspired by lessons from real-world routing and feature-flag incidents, I built a lightweight lab (**Rollout Scope Guardrail & Load Amplification Lab**) in TypeScript to explore two questions:
> 1. How do we catch unintended scope expansion (`internal` -> `*`) in CI before merge?
> 2. How do concurrency bulkheads + fast-path degradation protect shared worker pools when traffic spikes?
>
> Everything runs locally in seconds using Node's native test runner—including a simulated bounded worker pool, Little's Law capacity checks, and automated saturation tests. Happy to hear how your team tests config blast radius in CI!

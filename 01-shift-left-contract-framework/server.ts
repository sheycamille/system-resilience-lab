import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { chaosProxyMiddleware, globalChaosConfig } from './src/middleware/chaos-proxy.ts';
import { authRouter } from './src/services/auth-service.ts';
import { profileRouter } from './src/services/profile-service.ts';
import { inMemoryStore } from './src/services/store.ts';
import { executeContractTestSuite } from './src/services/contract-engine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json());

  // Root Service Discovery Index (headless API gateway)
  app.get('/', (_req, res) => {
    res.status(200).json({
      service: 'Shift-Left Contract & Testability Framework',
      mode: 'headless-api',
      endpoints: {
        health: 'GET /health',
        openapi: {
          auth: 'GET /api/openapi/auth.json',
          profile: 'GET /api/openapi/profile.json'
        },
        authService: {
          issueToken: 'POST /api/v1/auth/token',
          verifyToken: 'POST /api/v1/auth/verify'
        },
        profileService: {
          me: 'GET /api/v1/users/me',
          byId: 'GET /api/v1/users/:id',
          list: 'GET /api/v1/users'
        },
        chaosControls: {
          logs: 'GET /api/chaos/logs',
          config: 'POST /api/chaos/config'
        },
        contractTestRunner: {
          run: 'POST /api/test/run',
          drift: 'POST /api/test/drift',
          resetStore: 'POST /api/store/reset'
        }
      }
    });
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', uptime_seconds: Math.floor(process.uptime()) });
  });

  // Static OpenAPI Schemas
  const authSchemaPath = path.resolve(__dirname, 'contracts', 'auth-schema.json');
  const profileSchemaPath = path.resolve(__dirname, 'contracts', 'profile-schema.json');

  app.get('/api/openapi/auth.json', (_req, res) => {
    try {
      const data = fs.readFileSync(authSchemaPath, 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.send(data);
    } catch {
      res.status(500).json({ error: 'Failed to load auth schema' });
    }
  });

  app.get('/api/openapi/profile.json', (_req, res) => {
    try {
      const data = fs.readFileSync(profileSchemaPath, 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.send(data);
    } catch {
      res.status(500).json({ error: 'Failed to load profile schema' });
    }
  });

  // Chaos proxy middleware mounted ahead of microservice routes
  app.use('/api/v1', chaosProxyMiddleware);

  // Microservices Routers
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', profileRouter);

  // Contract Test & Chaos Management Endpoints
  app.post('/api/test/run', async (_req, res) => {
    try {
      const origin = `http://127.0.0.1:${PORT}`;
      const summary = await executeContractTestSuite(origin);
      res.status(200).json(summary);
    } catch (err: unknown) {
      res.status(500).json({
        error: 'test_execution_failed',
        message: err instanceof Error ? err.message : String(err)
      });
    }
  });

  app.post('/api/test/drift', (req, res) => {
    const { active, driftType } = req.body || {};
    inMemoryStore.setSchemaDrift(Boolean(active), driftType || 'rename_field');
    res.status(200).json({
      driftModeActive: inMemoryStore.isSchemaDriftActive(),
      driftType: inMemoryStore.getSchemaDriftType()
    });
  });

  app.get('/api/chaos/logs', (_req, res) => {
    res.status(200).json({
      logs: inMemoryStore.getChaosLogs(),
      globalConfig: globalChaosConfig
    });
  });

  app.post('/api/chaos/config', (req, res) => {
    const { enabled, type, latencyMs, rateLimitRetryAfterSec } = req.body || {};
    if (typeof enabled === 'boolean') globalChaosConfig.enabled = enabled;
    if (type) globalChaosConfig.type = type;
    if (typeof latencyMs === 'number') globalChaosConfig.latencyMs = latencyMs;
    if (typeof rateLimitRetryAfterSec === 'number') globalChaosConfig.rateLimitRetryAfterSec = rateLimitRetryAfterSec;

    res.status(200).json(globalChaosConfig);
  });

  app.post('/api/store/reset', (_req, res) => {
    inMemoryStore.reset();
    res.status(200).json({ status: 'ok', message: 'In-memory data store reset to baseline' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Shift-Left Framework] Headless API Gateway listening on port ${PORT}`);
    console.log(`[Shift-Left Framework] OpenAPI specs: /api/openapi/auth.json & /api/openapi/profile.json`);
  });
}

startServer();

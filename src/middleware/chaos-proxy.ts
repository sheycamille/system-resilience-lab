import { Request, Response, NextFunction } from 'express';
import { inMemoryStore } from '../services/store.ts';
import { ChaosConfig } from '../types/index.ts';

// Global default chaos config (can also be triggered per-request via headers)
export const globalChaosConfig: ChaosConfig = {
  enabled: false,
  type: 'latency',
  latencyMs: 1200,
  rateLimitRetryAfterSec: 30,
  failureRate: 0.5
};

export function chaosProxyMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Check if chaos mode is requested either via header or global flag
  const headerChaosMode = req.headers['x-chaos-mode'];
  const isHeaderTriggered =
    headerChaosMode === 'true' ||
    headerChaosMode === '1' ||
    (Array.isArray(headerChaosMode) && headerChaosMode[0] === 'true');

  const shouldTrigger = isHeaderTriggered || globalChaosConfig.enabled;

  if (!shouldTrigger) {
    return next();
  }

  // Determine specific chaos type
  const headerChaosType = req.headers['x-chaos-type'] as string | undefined;
  const chaosType = (headerChaosType || globalChaosConfig.type || 'latency').toLowerCase();

  // Determine custom latency if provided
  const headerLatency = req.headers['x-chaos-latency-ms'];
  const latencyMs = headerLatency ? parseInt(headerLatency as string, 10) : globalChaosConfig.latencyMs;

  // Determine retry after seconds
  const headerRetry = req.headers['x-chaos-retry-after'];
  const retryAfterSec = headerRetry ? parseInt(headerRetry as string, 10) : globalChaosConfig.rateLimitRetryAfterSec;

  // Set response header indicating chaos was intercepted
  res.setHeader('X-Chaos-Proxy-Intercepted', 'true');
  res.setHeader('X-Chaos-Injected-Type', chaosType);

  // 1. HTTP 429: Simulated Rate Limit Exceeded
  if (chaosType === 'rate-limit' || chaosType === '429') {
    inMemoryStore.logChaosEvent({
      method: req.method,
      path: req.originalUrl,
      chaosType: 'HTTP 429 Rate Limit',
      injectedLatencyMs: 25,
      statusCode: 429,
      clientIp: req.ip || '127.0.0.1'
    });

    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({
      type: 'https://errors.platform.internal/rate-limit-exceeded',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Simulated rate limit threshold exceeded. Client must honor exponential backoff.',
      instance: req.originalUrl,
      retry_after_seconds: retryAfterSec,
      chaos_injected: true,
      timestamp: new Date().toISOString()
    });
    return;
  }

  // 2. HTTP 503: Simulated Service Unavailable / Outage
  if (chaosType === 'service-unavailable' || chaosType === '503') {
    inMemoryStore.logChaosEvent({
      method: req.method,
      path: req.originalUrl,
      chaosType: 'HTTP 503 Service Unavailable',
      injectedLatencyMs: 30,
      statusCode: 503,
      clientIp: req.ip || '127.0.0.1'
    });

    res.setHeader('Retry-After', '60');
    res.status(503).json({
      type: 'https://errors.platform.internal/service-unavailable',
      title: 'Service Unavailable',
      status: 503,
      detail: 'Simulated upstream dependency partition or circuit-breaker open state.',
      instance: req.originalUrl,
      chaos_injected: true,
      timestamp: new Date().toISOString()
    });
    return;
  }

  // 3. Simulated Network Latency (default)
  const safeLatency = isNaN(latencyMs) ? 1200 : Math.min(Math.max(latencyMs, 100), 5000);

  inMemoryStore.logChaosEvent({
    method: req.method,
    path: req.originalUrl,
    chaosType: `Latency Delay (${safeLatency}ms)`,
    injectedLatencyMs: safeLatency,
    statusCode: 200,
    clientIp: req.ip || '127.0.0.1'
  });

  res.setHeader('X-Chaos-Latency-Injected-Ms', String(safeLatency));

  setTimeout(() => {
    next();
  }, safeLatency);
}

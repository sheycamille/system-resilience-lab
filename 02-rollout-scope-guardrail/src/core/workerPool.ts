import type { WorkerPoolConfig } from './types.ts';

interface QueuedTask {
  enqueuedAt: number;
  workMs: number;
  resolve: (result: PoolExecutionResult) => void;
}

export interface PoolExecutionResult {
  status: 'completed' | 'rejected_queue_full' | 'timeout';
  queueWaitMs: number;
  workMs: number;
}

export interface PoolSnapshot {
  activeWorkers: number;
  queuedCount: number;
  maxWorkers: number;
  maxQueueSize: number;
  peakActiveWorkers: number;
  peakQueueDepth: number;
  totalCompleted: number;
  totalRejected: number;
  totalTimedOut: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Bounded async worker pool modeling shared CPU/downstream capacity,
 * bounded queue backpressure, and request timeouts.
 */
export class BoundedWorkerPool {
  private readonly config: WorkerPoolConfig;
  private readonly timeScale: number;
  private activeWorkers = 0;
  private queue: QueuedTask[] = [];
  private peakActiveWorkers = 0;
  private peakQueueDepth = 0;
  private totalCompleted = 0;
  private totalRejected = 0;
  private totalTimedOut = 0;

  constructor(config: WorkerPoolConfig, timeScale = 1) {
    this.config = config;
    this.timeScale = timeScale;
  }

  getSnapshot(): PoolSnapshot {
    return {
      activeWorkers: this.activeWorkers,
      queuedCount: this.queue.length,
      maxWorkers: this.config.maxWorkers,
      maxQueueSize: this.config.maxQueueSize,
      peakActiveWorkers: this.peakActiveWorkers,
      peakQueueDepth: this.peakQueueDepth,
      totalCompleted: this.totalCompleted,
      totalRejected: this.totalRejected,
      totalTimedOut: this.totalTimedOut,
    };
  }

  async execute(workMs: number): Promise<PoolExecutionResult> {
    const now = performance.now();

    if (this.activeWorkers < this.config.maxWorkers) {
      return this.runOnWorker(workMs, 0);
    }

    if (this.queue.length >= this.config.maxQueueSize) {
      this.totalRejected += 1;
      return {
        status: 'rejected_queue_full',
        queueWaitMs: 0,
        workMs: 0,
      };
    }

    return new Promise<PoolExecutionResult>((resolve) => {
      this.queue.push({
        enqueuedAt: now,
        workMs,
        resolve,
      });
      if (this.queue.length > this.peakQueueDepth) {
        this.peakQueueDepth = this.queue.length;
      }
    });
  }

  private async runOnWorker(workMs: number, queueWaitMs: number): Promise<PoolExecutionResult> {
    this.activeWorkers += 1;
    if (this.activeWorkers > this.peakActiveWorkers) {
      this.peakActiveWorkers = this.activeWorkers;
    }

    try {
      const scaledWork = workMs * this.timeScale;
      const scaledTimeout = this.config.requestTimeoutMs * this.timeScale;

      // If queueWait + work exceeds SLA timeout, fail with timeout after waiting remaining budget
      if (queueWaitMs >= scaledTimeout) {
        this.totalTimedOut += 1;
        return {
          status: 'timeout',
          queueWaitMs: queueWaitMs / this.timeScale,
          workMs: 0,
        };
      }

      const remainingBudget = scaledTimeout - queueWaitMs;
      if (scaledWork > remainingBudget) {
        await delay(remainingBudget);
        this.totalTimedOut += 1;
        return {
          status: 'timeout',
          queueWaitMs: queueWaitMs / this.timeScale,
          workMs: remainingBudget / this.timeScale,
        };
      }

      await delay(scaledWork);
      this.totalCompleted += 1;
      return {
        status: 'completed',
        queueWaitMs: queueWaitMs / this.timeScale,
        workMs,
      };
    } finally {
      this.activeWorkers -= 1;
      this.drainNext();
    }
  }

  private drainNext(): void {
    while (this.activeWorkers < this.config.maxWorkers && this.queue.length > 0) {
      const next = this.queue.shift()!;
      const waitMs = performance.now() - next.enqueuedAt;
      const scaledTimeout = this.config.requestTimeoutMs * this.timeScale;

      if (waitMs >= scaledTimeout) {
        this.totalTimedOut += 1;
        next.resolve({
          status: 'timeout',
          queueWaitMs: waitMs / this.timeScale,
          workMs: 0,
        });
        continue;
      }

      void this.runOnWorker(next.workMs, waitMs).then(next.resolve);
    }
  }
}

import type { ConcurrencyConfig } from "../types/common.js";
import { PterodactylAbortError, PterodactylQueueFullError } from "../errors/specific.js";

export const DEFAULT_MAX_CONCURRENT_PER_PANEL = 5;
export const DEFAULT_MAX_QUEUE_SIZE_PER_PANEL = 100;

interface QueuedTask<T> {
  execute: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
}

class PanelQueue {
  public activeCount = 0;
  public readonly queue: QueuedTask<unknown>[] = [];

  constructor(
    public readonly maxConcurrent: number,
    public readonly maxQueueSize: number,
  ) {}
}

/**
 * Manages request concurrency and queueing on a per-panel basis.
 * Prevents overwhelming individual Pterodactyl panels while ensuring backlogs
 * on one panel do not block or delay operations on other panels.
 */
export class PanelConcurrencyManager {
  private readonly panels = new Map<string, PanelQueue>();

  constructor(private readonly globalConfig: ConcurrencyConfig = {}) {}

  /**
   * Retrieves or initializes the concurrency queue for a given panel origin.
   */
  private getOrCreateQueue(panelOrigin: string, config?: ConcurrencyConfig): PanelQueue {
    let queue = this.panels.get(panelOrigin);
    if (!queue) {
      const maxConcurrent =
        config?.maxConcurrent ??
        this.globalConfig.maxConcurrent ??
        DEFAULT_MAX_CONCURRENT_PER_PANEL;
      const maxQueueSize =
        config?.maxQueueSize ?? this.globalConfig.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE_PER_PANEL;

      queue = new PanelQueue(maxConcurrent, maxQueueSize);
      this.panels.set(panelOrigin, queue);
    }
    return queue;
  }

  /**
   * Acquires a concurrency slot for the specified panel, executing immediately if below
   * the limit, or queueing until a slot opens. Supports immediate cancellation.
   *
   * @param panelOrigin Normalized panel origin (e.g. "https://panel.example.com")
   * @param execute Async operation to execute once a concurrency slot is available
   * @param signal Optional AbortSignal to cancel pending queue wait
   * @param config Optional per-request concurrency overrides
   */
  public async acquire<T>(
    panelOrigin: string,
    execute: () => Promise<T>,
    signal?: AbortSignal,
    config?: ConcurrencyConfig,
  ): Promise<T> {
    const panelQueue = this.getOrCreateQueue(panelOrigin, config);

    // If caller's signal is already aborted, reject immediately without queueing
    if (signal?.aborted) {
      throw new PterodactylAbortError("Request aborted prior to acquiring concurrency slot.", {
        cause: signal.reason,
      });
    }

    // If below concurrency capacity, execute immediately
    if (panelQueue.activeCount < panelQueue.maxConcurrent) {
      panelQueue.activeCount++;
      return this.runTask(panelQueue, execute);
    }

    // Check bounded queue capacity
    if (panelQueue.queue.length >= panelQueue.maxQueueSize) {
      throw new PterodactylQueueFullError(
        `Concurrency queue limit (${panelQueue.maxQueueSize}) reached for panel "${panelOrigin}".`,
      );
    }

    // Queue request
    return new Promise<T>((resolve, reject) => {
      let onAbort: (() => void) | undefined;

      const item: QueuedTask<T> = {
        execute,
        resolve: (val) => {
          if (signal && onAbort) signal.removeEventListener("abort", onAbort);
          resolve(val);
        },
        reject: (err) => {
          if (signal && onAbort) signal.removeEventListener("abort", onAbort);
          reject(err);
        },
        signal,
      };

      if (signal) {
        onAbort = () => {
          const index = panelQueue.queue.indexOf(item as QueuedTask<unknown>);
          if (index !== -1) {
            panelQueue.queue.splice(index, 1);
          }
          item.reject(
            new PterodactylAbortError("Request cancelled while waiting in concurrency queue.", {
              cause: signal.reason,
            }),
          );
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }

      panelQueue.queue.push(item as QueuedTask<unknown>);
    });
  }

  private async runTask<T>(panelQueue: PanelQueue, execute: () => Promise<T>): Promise<T> {
    try {
      return await execute();
    } finally {
      panelQueue.activeCount--;
      this.drainQueue(panelQueue);
    }
  }

  private drainQueue(panelQueue: PanelQueue): void {
    while (panelQueue.queue.length > 0 && panelQueue.activeCount < panelQueue.maxConcurrent) {
      const next = panelQueue.queue.shift();
      if (!next) break;

      // If aborted while in queue, skip execution
      if (next.signal?.aborted) {
        continue;
      }

      panelQueue.activeCount++;
      this.runTask(panelQueue, next.execute).then(next.resolve, next.reject);
    }

    // Cleanup idle queues to conserve memory
    if (panelQueue.activeCount === 0 && panelQueue.queue.length === 0) {
      for (const [origin, queue] of this.panels.entries()) {
        if (queue === panelQueue && queue.activeCount === 0 && queue.queue.length === 0) {
          this.panels.delete(origin);
          break;
        }
      }
    }
  }

  public getActiveCount(panelOrigin: string): number {
    return this.panels.get(panelOrigin)?.activeCount ?? 0;
  }

  public getQueueLength(panelOrigin: string): number {
    return this.panels.get(panelOrigin)?.queue.length ?? 0;
  }

  public clear(): void {
    for (const queue of this.panels.values()) {
      for (const item of queue.queue) {
        item.reject(new PterodactylAbortError("Concurrency queue cleared."));
      }
      queue.queue.length = 0;
      queue.activeCount = 0;
    }
    this.panels.clear();
  }
}

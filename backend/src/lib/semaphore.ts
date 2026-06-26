/**
 * Semaphore — Concurrency Limiter
 * --------------------------------
 * Simple counting semaphore for limiting concurrent operations.
 * Used by the widget health check scheduler to cap the number
 * of simultaneous Puppeteer browser instances.
 */

export class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) next();
  }

  get active(): number {
    return this.current;
  }

  get pending(): number {
    return this.queue.length;
  }
}

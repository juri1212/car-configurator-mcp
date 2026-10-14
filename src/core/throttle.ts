/** Runs requests one after another with a small gap, to stay polite. */
export class Throttle {
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(private readonly minGapMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastRequestAt + this.minGapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        this.lastRequestAt = Date.now();
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }
}

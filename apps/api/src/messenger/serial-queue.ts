/**
 * Runs tasks one at a time per key (one customer), and in parallel across keys, so a
 * customer's replies never cross. In-process only: fine for a single API instance.
 */
export class SerialQueue {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(
    private readonly onError: (key: string, error: unknown) => void,
  ) {}

  run(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous
      .then(task)
      .catch((error: unknown) => this.onError(key, error));
    this.tails.set(key, next);
    void next.then(() => {
      if (this.tails.get(key) === next) this.tails.delete(key);
    });
    return next;
  }

  /** Resolves once every queued task has finished. */
  async idle(): Promise<void> {
    while (this.tails.size > 0) {
      await Promise.all(this.tails.values());
    }
  }
}

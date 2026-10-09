export interface BatchJob {
  batchId: string;
}

/** Architecture section 1.4 / 16: in-process in v1; Azure Service Bus implementation later. */
export interface JobRunner {
  enqueue(job: BatchJob): Promise<void>;
  /** Resolves when every enqueued job has finished (tests, graceful shutdown). */
  drain(): Promise<void>;
  readonly pending: number;
}

export class InProcessJobRunner implements JobRunner {
  private readonly queue: BatchJob[] = [];
  private running = 0;
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly run: (job: BatchJob) => Promise<void>,
    private readonly concurrency = 2,
    private readonly onError: (job: BatchJob, err: unknown) => void = () => undefined,
  ) {}

  get pending(): number {
    return this.queue.length + this.running;
  }

  async enqueue(job: BatchJob): Promise<void> {
    this.queue.push(job);
    this.pump();
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift() as BatchJob;
      this.running += 1;
      const p = this.run(job)
        .catch((err) => this.onError(job, err))
        .finally(() => {
          this.running -= 1;
          this.inflight.delete(p);
          this.pump();
        });
      this.inflight.add(p);
    }
  }

  async drain(): Promise<void> {
    while (this.inflight.size > 0 || this.queue.length > 0) {
      await Promise.all([...this.inflight]);
    }
  }
}

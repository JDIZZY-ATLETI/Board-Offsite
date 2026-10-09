import { getAppContext, type AppContext } from "@/lib/app-context";
import { InProcessJobRunner, type JobRunner } from "./job-runner";
import { runBatch } from "./run";

export function createJobRunner(ctx: AppContext): JobRunner {
  return new InProcessJobRunner(
    (job) => runBatch(ctx, job.batchId).then(() => undefined),
    ctx.config.batchConcurrency,
    (job, err) => ctx.logger.error({ batchId: job.batchId, err }, "batch job crashed"),
  );
}

const g = globalThis as unknown as { __hooppJobRunner?: Promise<JobRunner> };

export function getJobRunner(): Promise<JobRunner> {
  if (!g.__hooppJobRunner) g.__hooppJobRunner = getAppContext().then(createJobRunner);
  return g.__hooppJobRunner;
}

export function setJobRunnerForTests(runner: JobRunner | null): void {
  g.__hooppJobRunner = runner ? Promise.resolve(runner) : undefined;
}

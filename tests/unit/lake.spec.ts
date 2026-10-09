import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FsLakeStore } from "@/lib/lake/fs-store";
import { lakePaths } from "@/lib/lake/paths";
import { assertLakePath, LakePathError, LakeWriteOnceError } from "@/lib/lake/store";

let root: string;
let lake: FsLakeStore;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lake-"));
  lake = new FsLakeStore(root);
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe("FsLakeStore", () => {
  it("writes once, reads back, lists and stats", async () => {
    const p = "raw/employer=0235/filetype=events/ingest_date=2026-10-08/batch=b1/original.csv";
    await lake.put(p, "hello");
    expect((await lake.get(p)).toString()).toBe("hello");
    expect(await lake.exists(p)).toBe(true);
    expect((await lake.stat(p))?.sizeBytes).toBe(5);
    expect(await lake.list("raw/employer=0235")).toEqual([p]);
    await expect(lake.put(p, "again")).rejects.toBeInstanceOf(LakeWriteOnceError);
  });
  it("allows overwrite only in gold", async () => {
    const g = "gold/employer=0235/filetype=events/ingest_date=2026-10-08/batch=b1/reports/execution-report.json";
    await lake.put(g, "1");
    await lake.put(g, "2", { overwrite: true });
    expect((await lake.get(g)).toString()).toBe("2");
    const s = "silver/employer=0235/filetype=events/ingest_date=2026-10-08/batch=b1/findings.ndjson";
    await lake.put(s, "1");
    await expect(lake.put(s, "2", { overwrite: true })).rejects.toBeInstanceOf(LakeWriteOnceError);
  });
  it("rejects traversal and unknown zones", () => {
    expect(() => assertLakePath("raw/../etc/passwd")).toThrow(LakePathError);
    expect(() => assertLakePath("tmp/x")).toThrow(LakePathError);
    expect(() => assertLakePath("raw/a b/c")).toThrow(LakePathError);
    expect(assertLakePath("bronze/employer=1/x.json")).toBe("bronze");
  });
  it("builds the section 5 layout", () => {
    const p = lakePaths({ employerId: "0235", batchId: "b1", ingestDate: "2026-10-08" });
    expect(p.raw.original).toBe("raw/employer=0235/filetype=events/ingest_date=2026-10-08/batch=b1/original.csv");
    expect(p.silver.rejected).toBe("silver/employer=0235/filetype=events/ingest_date=2026-10-08/batch=b1/rejected.csv");
    expect(p.gold.executionReportHtml).toBe("gold/employer=0235/filetype=events/ingest_date=2026-10-08/batch=b1/reports/execution-report.html");
  });
});

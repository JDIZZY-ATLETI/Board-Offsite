import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertLakePath, LakeWriteOnceError, type LakeStat, type LakeStore, type PutOptions } from "./store";

/** Filesystem lake (v1). Writes go to `<file>.tmp` then rename so readers never see partial files. */
export class FsLakeStore implements LakeStore {
  constructor(private readonly root: string) {}

  get rootDir(): string {
    return this.root;
  }

  private abs(rel: string): string {
    assertLakePath(rel);
    return path.join(this.root, ...rel.split("/"));
  }

  async put(rel: string, bytes: Uint8Array | string, opts: PutOptions = {}): Promise<LakeStat> {
    const zone = assertLakePath(rel);
    const target = this.abs(rel);
    const existing = await this.stat(rel);
    if (existing && !(opts.overwrite && zone === "gold")) throw new LakeWriteOnceError(rel);
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const data = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
    await writeFile(tmp, data);
    await rename(tmp, target);
    const s = await stat(target);
    return { path: rel, sizeBytes: s.size, modifiedAt: s.mtime.toISOString() };
  }

  async get(rel: string): Promise<Buffer> {
    return readFile(this.abs(rel));
  }

  async exists(rel: string): Promise<boolean> {
    return (await this.stat(rel)) !== null;
  }

  async stat(rel: string): Promise<LakeStat | null> {
    try {
      const s = await stat(this.abs(rel));
      return { path: rel, sizeBytes: s.size, modifiedAt: s.mtime.toISOString() };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const abs = path.join(this.root, ...prefix.split("/").filter(Boolean));
    const out: string[] = [];
    const walk = async (dir: string, relParts: string[]) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
      for (const e of entries) {
        if (e.name.endsWith(".tmp")) continue;
        const next = [...relParts, e.name];
        if (e.isDirectory()) await walk(path.join(dir, e.name), next);
        else out.push(next.join("/"));
      }
    };
    await walk(abs, prefix.split("/").filter(Boolean));
    return out.sort();
  }
}

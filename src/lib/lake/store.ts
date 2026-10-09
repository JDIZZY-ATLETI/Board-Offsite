export type LakeZone = "raw" | "bronze" | "silver" | "gold" | "anchors";
export const LAKE_ZONES: readonly LakeZone[] = ["raw", "bronze", "silver", "gold", "anchors"];

export interface LakeStat {
  path: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface PutOptions {
  /** Only honoured in the gold zone (regenerable reports). Any other overwrite throws. */
  overwrite?: boolean;
  contentType?: string;
}

/**
 * Zoned, write-once object store (architecture section 5). Paths are relative to the lake root and
 * always start with a zone name. FsLakeStore is the v1 implementation; AdlsLakeStore maps to ADLS Gen2.
 */
export interface LakeStore {
  put(path: string, bytes: Uint8Array | string, opts?: PutOptions): Promise<LakeStat>;
  get(path: string): Promise<Buffer>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<LakeStat | null>;
  list(prefix: string): Promise<string[]>;
}

export class LakeWriteOnceError extends Error {
  constructor(path: string) {
    super(`lake path already exists (write-once): ${path}`);
  }
}

export class LakePathError extends Error {}

const SEGMENT_RE = /^[A-Za-z0-9._=-]+$/;

/** Validates a lake-relative path: zone prefix, no traversal, conservative characters. */
export function assertLakePath(path: string): LakeZone {
  const segments = path.split("/");
  if (segments.length < 2) throw new LakePathError(`lake path must include a zone and a file: ${path}`);
  const zone = segments[0] as LakeZone;
  if (!LAKE_ZONES.includes(zone)) throw new LakePathError(`unknown lake zone in path: ${path}`);
  for (const s of segments) {
    if (s === "" || s === "." || s === ".." || !SEGMENT_RE.test(s)) {
      throw new LakePathError(`invalid lake path segment "${s}" in ${path}`);
    }
  }
  return zone;
}

import type { LakeStore } from "./store";

/**
 * Azure Data Lake Storage Gen2 implementation slot (architecture section 16).
 * Not implemented in v1; the interface is identical so the pipeline needs no changes.
 */
export interface AdlsLakeStoreOptions {
  accountUrl: string;
  fileSystem: string;
}

export class AdlsLakeStore implements LakeStore {
  constructor(private readonly options: AdlsLakeStoreOptions) {}

  private unsupported(): never {
    throw new Error(`AdlsLakeStore (${this.options.accountUrl}/${this.options.fileSystem}) is not implemented in v1`);
  }

  put(): never {
    return this.unsupported();
  }
  get(): never {
    return this.unsupported();
  }
  exists(): never {
    return this.unsupported();
  }
  stat(): never {
    return this.unsupported();
  }
  list(): never {
    return this.unsupported();
  }
}

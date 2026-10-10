import type { ArielMemberSnapshot, ArielRateTables } from "@/types";
import type { ArielBatchSnapshot } from "./snapshot";

/**
 * Architecture section 4.6 `ArielReferenceAdapter`. Callers never pass or receive a raw SIN: lookups are by
 * pseudonym; `findMembersBySin` hashes inside the adapter boundary.
 */
export interface ArielAdapter {
  readonly name: string;
  findMembersBySinPseudo(sinPseudo: string): Promise<ArielMemberSnapshot[]>;
  /** Hashes the raw SIN inside the adapter and delegates to the pseudonym lookup. */
  findMembersBySin(sin: string): Promise<ArielMemberSnapshot[]>;
  employerExists(employerId: string): Promise<boolean>;
  listEmployers(): Promise<Array<{ employerId: string; name: string }>>;
  rates(): Promise<ArielRateTables>;
  /** All lookups for a batch are served from this snapshot, taken once at validate start. */
  snapshotForBatch(batchId: string, employerId: string, sinPseudos: string[]): Promise<ArielBatchSnapshot>;
  /** Mock browser (/ariel). */
  listMembers(filter?: { employerId?: string; q?: string }): Promise<ArielMemberSnapshot[]>;
}
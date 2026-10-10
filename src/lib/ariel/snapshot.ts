import { sha256Hex } from "@/lib/crypto/hash";
import type { ArielMemberSnapshot, ArielRateTables, ArielSnapshotMeta, RateTableRow } from "@/types";
import { StaticRateTables } from "./rates";

/**
 * Read model the rules engine sees (architecture section 7.1 `ArielBatchSnapshot`). Taken once per batch,
 * persisted to silver/ariel-snapshot.ndjson and reloadable for offline re-validation (AC5).
 */
export interface ArielBatchSnapshot {
  adapter: string;
  /** sha256 of the persisted NDJSON bytes. */
  hash: string;
  /** All members sharing a SIN pseudonym, sorted by memberId (B204 duplicate detection). */
  membersBySin(sinPseudo: string): ArielMemberSnapshot[];
  /** First member (by memberId) or null. */
  memberBySin(sinPseudo: string): ArielMemberSnapshot | null;
  members(): ArielMemberSnapshot[];
  meta: Omit<ArielSnapshotMeta, "kind" | "schemaVersion">;
  /**
   * Rate tables frozen with the snapshot (`{"kind":"rates"}` line, folded into `hash`) so offline re-validation
   * never consults the live adapter (AC5 / Phase 2 QA BUG-REVAL-1). Null for snapshots taken without rates (L0).
   */
  rates: ArielRateTables | null;
  /** Persisted form (silver/ariel-snapshot.ndjson). */
  toNdjson(): string;
}

function sortMember(m: ArielMemberSnapshot): ArielMemberSnapshot {
  const by = <T>(arr: T[], key: (t: T) => string) => [...arr].sort((a, b) => key(a).localeCompare(key(b)));
  return {
    ...m,
    membership: { ...m.membership, calculationIndicators: [...m.membership.calculationIndicators].sort(), statusHistory: by(m.membership.statusHistory, (s) => `${s.effectiveDate}|${s.status ?? ""}|${s.subStatus ?? ""}`) },
    employments: by(m.employments, (e) => `${e.permanencyDate}|${e.employmentId}`).map((e) => ({
      ...e,
      employmentTypeHistory: by(e.employmentTypeHistory, (h) => `${h.effectiveDate}|${h.type}`),
      serviceBreaks: by(e.serviceBreaks, (b) => `${b.startDate}|${b.type}|${b.breakId}`),
      service: by(e.service, (t) => `${t.targetDate}|${t.beginDate}|${t.txId}`),
      contributions: by(e.contributions, (t) => `${t.targetDate}|${t.beginDate}|${t.txId}`),
      salaryRates: by(e.salaryRates, (t) => `${t.effectiveDate}|${t.txId}`),
    })),
    pensionAdjustments: by(m.pensionAdjustments, (p) => `${p.calculationYear}|${p.entryDate}|${p.paId}`),
    addresses: by(m.addresses, (a) => a.effectiveStartDate),
  };
}

export class InMemoryArielSnapshot implements ArielBatchSnapshot {
  readonly adapter: string;
  readonly hash: string;
  readonly meta: ArielBatchSnapshot["meta"];
  readonly rates: ArielRateTables | null;
  private readonly bySin = new Map<string, ArielMemberSnapshot[]>();
  private readonly all: ArielMemberSnapshot[];
  private readonly ndjson: string;

  constructor(members: ArielMemberSnapshot[], meta: ArielBatchSnapshot["meta"], rateRows: RateTableRow[] | null = null) {
    this.adapter = meta.adapter;
    this.meta = meta;
    const rates = rateRows ? new StaticRateTables(rateRows) : null;
    this.rates = rates;
    this.all = members.map(sortMember).sort((a, b) => a.sinPseudo.localeCompare(b.sinPseudo) || a.memberId.localeCompare(b.memberId));
    for (const m of this.all) {
      const list = this.bySin.get(m.sinPseudo) ?? [];
      list.push(m);
      this.bySin.set(m.sinPseudo, list);
    }
    // The batch id is not persisted: the lake folder already names the batch, and leaving it out makes the
    // hash a pure function of the Ariel data seen, so two runs over the same members share one hash (AC2).
    const { batchId: _batchId, ...persisted } = meta;
    void _batchId;
    const metaLine: ArielSnapshotMeta = { kind: "meta", schemaVersion: 1, ...persisted, found: this.all.length };
    const ratesLine = rates ? [JSON.stringify({ kind: "rates", rows: rates.rows() })] : [];
    this.ndjson = [JSON.stringify(metaLine), ...ratesLine, ...this.all.map((m) => JSON.stringify({ kind: "member", ...m }))].join("\n") + "\n";
    this.hash = sha256Hex(this.ndjson);
  }

  membersBySin(sinPseudo: string): ArielMemberSnapshot[] {
    return this.bySin.get(sinPseudo) ?? [];
  }
  memberBySin(sinPseudo: string): ArielMemberSnapshot | null {
    return this.bySin.get(sinPseudo)?.[0] ?? null;
  }
  members(): ArielMemberSnapshot[] {
    return this.all;
  }
  toNdjson(): string {
    return this.ndjson;
  }

  static fromNdjson(text: string, batchId = ""): InMemoryArielSnapshot {
    const lines = text.split("\n").filter((l) => l.trim() !== "");
    let meta: ArielBatchSnapshot["meta"] | null = null;
    let rateRows: RateTableRow[] | null = null;
    const members: ArielMemberSnapshot[] = [];
    for (const line of lines) {
      const obj = JSON.parse(line) as { kind: string } & Record<string, unknown>;
      if (obj.kind === "rates") {
        rateRows = (obj as unknown as { rows: RateTableRow[] }).rows;
      } else if (obj.kind === "meta") {
        const { kind: _k, schemaVersion: _v, ...rest } = obj as unknown as ArielSnapshotMeta;
        void _k;
        void _v;
        meta = { ...rest, batchId: rest.batchId ?? batchId };
      } else if (obj.kind === "member") {
        const { kind: _k, ...rest } = obj;
        void _k;
        members.push(rest as unknown as ArielMemberSnapshot);
      }
    }
    if (!meta) throw new Error("ariel snapshot has no meta line");
    return new InMemoryArielSnapshot(members, meta, rateRows);
  }

  static empty(batchId = "", employerId = "", adapter = "none"): InMemoryArielSnapshot {
    return new InMemoryArielSnapshot([], { adapter, batchId, employerId, requested: 0, found: 0 });
  }
}
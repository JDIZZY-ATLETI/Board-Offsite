# HOOPP Events Ledger — Architecture & Build Specification

**Status:** v1.0 design baseline (single source of truth for the build)
**Scope:** Events file (TERFIN / DECFIN / RETFIN) ingestion, validation, hash-chained member ledger, reviewable Ariel Update Set
**Audience:** Developer agent, QA agent, UX designer, stakeholders
**Source material:** `docs/reference/hoopp-ch7-events-file-spec.txt` (Events File Layout v12, incl. Default Values & Reports sheets) and `docs/reference/hoopp-ch7-validations-v15.1.txt` (Full Office Validations v15.1)

---

## Table of contents

1. [Executive summary, goals, non-goals](#1-executive-summary-goals-and-non-goals)
2. [Why a hash-chained ledger and not a blockchain](#2-why-a-hash-chained-ledger-and-not-a-blockchain)
3. [Context & container diagrams](#3-context-and-container-diagrams)
4. [Domain model (TypeScript)](#4-domain-model)
5. [Data lake layout](#5-data-lake-layout)
6. [Postgres schema](#6-postgres-schema)
7. [Rules engine design + full Events rule catalogue](#7-rules-engine)
8. [Ariel derivation logic (projection to Ariel Update Set)](#8-ariel-derivation-logic)
9. [Ledger design](#9-ledger-design)
10. [Batch processing pipeline](#10-batch-processing-pipeline)
11. [API surface](#11-api-surface)
12. [UI pages](#12-ui-pages)
13. [Security](#13-security)
14. [Observability](#14-observability)
15. [Testing strategy](#15-testing-strategy)
16. [Azure target architecture mapping](#16-azure-target-architecture-mapping)
17. [Implementation phases / work breakdown](#17-implementation-phases)
18. [Open questions & assumptions](#18-open-questions-and-assumptions)

---

## 1. Executive summary, goals and non-goals

### 1.1 What we are building

HOOPP employers submit an **Events CSV** when a member terminates (`TERFIN`), dies (`DECFIN`) or retires (`RETFIN`). Today the legacy **DataImport** tool validates the file against the Chapter 7 rule set and writes directly into **Ariel** (pension administration DB). We replace that with a **ledger architecture**:

1. **Ingest** the employer file into a zoned data lake (raw → bronze → silver → gold) with a SHA-256 manifest.
2. **Validate** every record with a deterministic rules engine that implements the Events-applicable Chapter 7 rules (58 spec rules + 1 adopted; see §7.9).
3. **Derive** the Ariel changes exactly as the Events File Layout "Default Values" sheet prescribes (employment termination, membership status D-NCT, CTSRV service, RPPLOW/RPPHGH/RCAHGH contributions, salary rates, PA, service-break closure, calculation request / benefit re-evaluation flag).
4. **Append** every meaningful fact (file received, record validated/rejected, warning overridden, Ariel update proposed, approved, exported) to an **append-only, SHA-256 hash-chained ledger** in Postgres with a per-member stream and a global chain.
5. **Project** the ledger into (a) a **reviewable Ariel Update Set** per batch (JSON + CSV + human-readable diff) that a Reviewer approves or rejects before export, and (b) **member/employer read models** for portals.

Nothing writes to Ariel in v1. The approved Update Set is exported as files for the downstream Ariel loader.

### 1.2 Goals

| # | Goal | Measure |
|---|------|---------|
| G1 | Faster member file updates | Upload → reviewable Update Set in < 2 min for a 5,000-row file on a laptop |
| G2 | Full tamper-evident provenance | Every ledger entry verifiable; `POST /api/ledger/verify` returns `ok` over the whole chain |
| G3 | Rule parity with legacy DataImport for Events | 100 % of §7.9 rules implemented with positive/negative fixtures; message IDs and texts identical to spec |
| G4 | Reviewable, auditable Ariel changes | Every Ariel update item shows file value, current Ariel value, resulting value, and the derivation rule that produced it |
| G5 | Cloud-portable | Local-first (Docker Postgres + filesystem lake) with interfaces that map 1:1 to Azure services (§16) |
| G6 | PII safety | Raw SIN never appears in ledger public fields, logs, URLs or reports except the Rejected Individuals CSV (which must mirror the input) |

### 1.3 Non-goals (v1)

- No direct Ariel writes; no Ariel read against the real DB (mock adapter only).
- No Core Data / MDC, Retro, Leaves, Enrolments, MBI, Retirement Notice files (interfaces leave room).
- No GUI-only Death Contact fields (not present in CSV layout) → no Beneficiary/CRM derivation.
- No distributed consensus, no public verifiability beyond operator-published chain heads.
- No production identity provider integration (role header placeholder; Entra ID mapped in §16).
- No Workday/Ceridian/Meditech mappings shipped — only the adapter slot and the canonical mapping config format.

### 1.4 Key technology decisions (justification in-line)

| Concern | Choice | Why |
|---|---|---|
| App shell / API | Next.js 15 App Router, TypeScript strict, Node 22 | Already scaffolded; route handlers give us API + UI in one deployable |
| DB access | **Drizzle ORM** + `postgres` (postgres.js) driver, `drizzle-kit` migrations | SQL-first and type-safe; no generated engine binary (Prisma) to ship in containers; raw SQL escape hatch for ledger triggers and window queries; schema file doubles as documentation. node-postgres alone lacks types/migrations. |
| CSV parsing | `csv-parse` (streaming) + `iconv-lite` (`windows-1252` → UTF-8) | Spec says files are ANSI, comma-delimited, header row; `csv-parse` handles quoting/BOM and streams large files |
| Schema/validation lib | `zod` | Boundary validation of API bodies, env, manifest, canonical record; zod schemas also generate the rule fixtures' shape |
| Decimal math | `decimal.js` | Contributions/PA/AE must never be IEEE floats; all money is `Decimal` in code and `numeric` in Postgres |
| Dates | ISO `YYYY-MM-DD` strings + `date-fns` (no timezone math; business dates are civil dates) | Prevents TZ drift between lake, DB and UI |
| Canonical JSON for hashing | `canonicalize` (RFC 8785 JCS) + `node:crypto` SHA-256 / HMAC / AES-256-GCM | Deterministic bytes for hashing across runtimes |
| IDs | UUID v7 (`uuidv7`) | Time-ordered, index-friendly |
| Job processing | In-process `JobRunner` interface backed by `p-queue` (concurrency 1 per batch, N batches) | v1 runs inside the Next.js server process; interface allows BullMQ/Azure Service Bus later |
| Logging | `pino` with redaction paths | Structured JSON, cheap, redact SIN paths |
| Testing | **Vitest** (unit/integration), **Playwright** (E2E), Docker Compose Postgres for integration | Fast TS-native unit tests; Playwright for upload→approve→export |
| Reports | JSON + CSV always; HTML Execution Report; XLSX optional via `exceljs` in Phase 4 | Legacy reports were XLS/XLSX; CSV keeps v1 dependency-light |

---

## 2. Why a hash-chained ledger and not a blockchain

For stakeholders, in one paragraph:

A blockchain solves the problem of **many mutually-distrusting parties** agreeing on one history without a central operator. HOOPP has **one trusted operator** (HOOPP itself) and a regulatory obligation to prove that member data was not altered after the fact. That obligation is met by an **append-only log where every entry includes the SHA-256 hash of the previous entry** (a hash chain, the same primitive used inside Git and in certificate-transparency logs). Any change to a historical entry breaks every hash after it and is detected by a verification pass in seconds. We get:

- **Tamper evidence** – identical to a blockchain's integrity guarantee.
- **Event sourcing + CQRS** – the ledger is the write model; Update Sets and portal read models are projections that can be rebuilt from it.
- **No consensus overhead** – no mining, no peers, no gas; Postgres transactions give ordering.
- **Externally anchorable** – periodically publish the chain head hash (e.g., to Azure Confidential Ledger or a signed file) to prove the operator did not rewrite its own history. That is the only "blockchain-like" ingredient that adds value here, and it is optional.

What we deliberately do **not** take from blockchain: distributed consensus, tokens, smart contracts, public write access, immutability of *mistakes* (we append compensating entries instead).

---

## 3. Context and container diagrams

### 3.1 System context

```mermaid
flowchart LR
  subgraph Employers
    ES[Employer Submitter<br/>Employer Portal user]
  end
  subgraph HOOPP
    RV[Reviewer]
    AD[Admin]
  end
  ES -- uploads Events CSV --> SYS[(HOOPP Events Ledger<br/>Next.js app + Postgres + Lake)]
  RV -- reviews / approves Update Set --> SYS
  AD -- manages rules config, verifies ledger --> SYS
  SYS -- "Ariel Update Set export (JSON/CSV)" --> ARIEL[Ariel loader<br/>downstream, out of scope]
  SYS -- reads reference data via adapter --> AREF[(Ariel reference<br/>v1: mock seeded DB)]
  SYS -- read models --> PORTALS[Member / Employer portals<br/>future]
```

### 3.2 Container diagram

```mermaid
flowchart TB
  subgraph NextApp["Next.js 15 (Node 22) — single deployable"]
    UI[App Router UI<br/>Upload, Batches, Review, Ledger, Members, Mock Ariel]
    API[Route handlers /api/*]
    JOB[JobRunner<br/>in-process queue]
    subgraph Core["src/lib (framework-free domain)"]
      ING[Ingest: adapters → canonical EventsRecord]
      RUL[Rules Engine<br/>L0 file, L1 format, L2 business]
      DER[Ariel Derivation<br/>Default Values → UpdateItems]
      LED[Ledger service<br/>append / verify / streams]
      PRJ[Projections<br/>UpdateSet, MemberProjection, Reports]
      APR[Approval workflow]
    end
  end
  LAKE[(Data lake<br/>raw / bronze / silver / gold<br/>v1: filesystem)]
  PG[(Postgres 16<br/>batches, records, findings,<br/>ledger_entries, update sets,<br/>projections, ariel_mock_*)]
  AREF[[ArielReferenceAdapter<br/>MockArielAdapter v1]]
  UI --> API --> JOB
  JOB --> ING --> RUL --> DER --> LED --> PRJ --> APR
  ING <--> LAKE
  PRJ --> LAKE
  RUL --> AREF
  DER --> AREF
  LED <--> PG
  ING --> PG
  RUL --> PG
  PRJ --> PG
  AREF --> PG
```

### 3.3 Data flow through zones

```mermaid
sequenceDiagram
  participant E as EmployerSubmitter
  participant A as API /api/batches
  participant L as Lake
  participant Q as JobRunner
  participant R as RulesEngine
  participant D as Derivation
  participant G as Ledger
  participant P as Projections
  participant V as Reviewer
  E->>A: POST multipart CSV (employerId, fileType=EVENTS)
  A->>L: raw/…/original.csv + manifest.json (sha256)
  A->>G: append BatchReceived (stream batch:<id>)
  A-->>E: 202 {batchId, status: RECEIVED}
  Q->>L: read raw, decode windows-1252, parse CSV
  Q->>R: L0 file rules (I50, I51)
  Q->>L: bronze/…/records.ndjson (canonical, SIN pseudonymised)
  Q->>R: L1 per-record rules → findings
  Q->>D: provisional derivation (FileDerived.*) for accepted records
  Q->>R: L2 per-record rules (Ariel snapshot via adapter) → findings
  Q->>L: silver/…/accepted.ndjson, rejected.csv, findings.ndjson
  Q->>G: append per-member MemberRecordValidated / MemberRecordRejected
  Q->>D: final derivation → ArielUpdateItems
  Q->>G: append ArielUpdateProposed per member
  Q->>P: build UpdateSet (JSON/CSV/diff) + reports → gold/
  Q->>P: status PENDING_APPROVAL
  V->>A: POST /api/update-sets/{id}/approve
  A->>G: append UpdateSetApproved
  V->>A: POST /api/update-sets/{id}/export
  A->>G: append UpdateSetExported
  A->>L: gold/…/export/ariel-update-set.{json,csv}
```

---
## 4. Domain model

All domain types live in `src/types/` (pure TypeScript, no framework imports) and are mirrored by zod schemas in `src/lib/schemas/`. Money is `string` in transport (decimal literal, 2 dp) and `Decimal` in domain code. Dates are `IsoDate` = `YYYY-MM-DD`.

### 4.1 Canonical EventsRecord

The canonical record is the **HOOPP Events CSV layout** (Header sheet: 15 columns). Adapter output for other HRIS systems must produce this exact shape.

```ts
// src/types/events.ts
export type IsoDate = `${number}-${number}-${number}`;           // civil date, no TZ
export type DecimalString = string;                                // "523.64"
export type EventType = 'TERFIN' | 'DECFIN' | 'RETFIN';

/** Column names exactly as they must appear in the CSV header (order matters for I51). */
export const EVENTS_CSV_COLUMNS = [
  'SIN', 'LastName', 'FirstName', 'EventType', 'EmploymentEndDate',
  'Weeks_CurrentYear', 'LowContributions_CurrentYear', 'HighContributions_CurrentYear',
  'AnnualizedEarnings_CurrentYear', 'PA_CurrentYear',
  'Weeks_PreviousYear', 'LowContributions_PreviousYear', 'HighContributions_PreviousYear',
  'AnnualizedEarnings_PreviousYear', 'PA_PreviousYear',
] as const;
export type EventsCsvColumn = typeof EVENTS_CSV_COLUMNS[number];

/** Raw row as read from the file: every value is the untrimmed string or null when the cell is empty. */
export type RawEventsRow = {
  lineNumber: number;                       // 1-based physical line in the file (header = 1)
  values: Record<EventsCsvColumn, string | null>;
  extraValues: string[];                    // cells beyond the header width (I50)
};

/** Parsed/typed record. Fields that failed L1 parsing are `undefined` and carry findings. */
export interface EventsRecord {
  recordId: string;                         // uuid v7
  batchId: string;
  lineNumber: number;
  sin: string;                              // 9 digits, left-padded with "0" per layout; raw, in-memory only
  sinPseudo: string;                        // HMAC-SHA256(sin, pepper) hex — persisted/indexed form
  lastName: string | null;                  // information only, never written to Ariel
  firstName: string | null;
  eventType: EventType | undefined;
  employmentEndDate: IsoDate | undefined;   // mandatory for TERFIN/RETFIN
  dateOfDeath: IsoDate | undefined;         // GUI-only in legacy; null for CSV (see §18 Q1)
  currentYear: YearBlock;
  previousYear: YearBlock;
  /** Derived: Year(EmploymentEndDate) or Year(DateOfDeath) — the "termination year". */
  eventYear: number | undefined;
  eventDate: IsoDate | undefined;           // EmploymentEndDate (TERFIN/RETFIN) or DateOfDeath (DECFIN)
}

export interface YearBlock {
  weeks: DecimalString | null;              // Decimal(4,2) max len 5 incl. point
  lowContributions: DecimalString | null;   // max len 8
  highContributions: DecimalString | null;  // max len 8
  annualizedEarnings: number | null;        // Integer max len 6
  pa: number | null;                        // Integer max len 5
}
```

Mandatory-field matrix (drives I1 / I2; from File Layout "Mandatory Field" column):

| Field | Mandatory | Condition |
|---|---|---|
| SIN, LastName, FirstName, EventType | Yes | always |
| EmploymentEndDate | Yes | EventType ∈ {TERFIN, RETFIN} |
| DateOfDeath | Yes | EventType = DECFIN **(GUI only; not in CSV — §18 Q1)** |
| Weeks_CurrentYear, LowContributions_CurrentYear, PA_CurrentYear | Yes | always |
| HighContributions_CurrentYear, AnnualizedEarnings_CurrentYear | No | |
| all *_PreviousYear | No | (B192b enforces presence when MDC-1 never received) |

### 4.2 Batch, RawFile, ValidationFinding

```ts
// src/types/batch.ts
export type BatchStatus =
  | 'RECEIVED' | 'PARSED' | 'VALIDATED' | 'LEDGERED' | 'PROJECTION_BUILT'
  | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXPORTED'
  | 'FAILED' | 'FILE_REJECTED';

export interface Batch {
  batchId: string;
  employerId: string;                      // HOOPP employer code, e.g. "0235"
  fileType: 'EVENTS';
  sourceSystem: 'HOOPP_CSV' | 'WORKDAY' | 'CERIDIAN' | 'MEDITECH';
  status: BatchStatus;
  executionDate: IsoDate;                  // File.ExecutionDate used by rules & derivation (defaults to receipt date)
  rawFileId: string;
  uploadedBy: string;                      // actor id
  receivedAt: string;                      // ISO timestamp
  counts: { rows: number; accepted: number; rejected: number; warnings: number; infos: number };
  failureReason?: string;
}

export interface RawFile {
  rawFileId: string;
  batchId: string;
  originalFilename: string;
  sha256: string;                          // hex of original bytes
  sizeBytes: number;
  encodingDetected: 'windows-1252' | 'utf-8' | 'utf-8-bom';
  lakePath: string;                        // raw zone relative path
}

export type FindingLevel = 'L0' | 'L1' | 'L2';
export type FindingSeverity =
  | 'FILE_ERROR' | 'COMPLETE_MEMBER_ERROR' | 'WARNING' | 'INFORMATION';
export type FindingVisibility = 'PUBLIC' | 'PRIVATE';         // Private = HOOPP-only (CTL report)

export interface ValidationFinding {
  findingId: string;
  batchId: string;
  recordId: string | null;                 // null for file-level findings
  lineNumber: number | null;
  sinPseudo: string | null;
  ruleId: string;                          // e.g. "B184c"
  messageId: string;                       // e.g. "7854"
  level: FindingLevel;
  severity: FindingSeverity;
  visibility: FindingVisibility;
  field: EventsCsvColumn | null;           // offending field when applicable
  yearScope: 'CURRENT' | 'PREVIOUS' | null;// rules executed "twice" (B22, B53, B184, …)
  params: Record<string, string | number>; // {1: "...", 2: "..."} message parameters
  dataImportMessage: string;               // rendered with params
  portalMessage: string;                   // rendered without params
  overrideReasons: string[];               // allowed warning override reasons (empty if N/A)
  override?: { reason: string; actor: string; at: string; note?: string };
  calculated?: Record<string, string | number>; // e.g. {ES: 48.57, RS: 52} for auditing
}
```

### 4.3 LedgerEntry

```ts
// src/types/ledger.ts
export type LedgerEventType =
  | 'BatchReceived' | 'BatchParsed' | 'BatchFileRejected'
  | 'MemberRecordValidated' | 'MemberRecordRejected' | 'WarningOverridden'
  | 'ArielUpdateProposed' | 'UpdateSetBuilt'
  | 'UpdateSetApproved' | 'UpdateSetRejected' | 'UpdateSetExported'
  | 'CorrectionAppended' | 'ChainAnchorPublished';

export interface LedgerEntry {
  seq: number;                             // global monotonic (bigint)
  entryId: string;                         // uuid v7
  streamId: string;                        // "member:<sinPseudo>" | "batch:<batchId>" | "system"
  streamSeq: number;                       // monotonic within stream
  eventType: LedgerEventType;
  batchId: string | null;
  actor: string;                           // "user:<id>" | "system:pipeline"
  occurredAt: string;                      // ISO timestamp (UTC)
  payload: Record<string, unknown>;        // JCS-canonicalised when hashed; NO raw SIN
  payloadHash: string;                     // sha256(JCS(payload))
  prevHashGlobal: string;                  // hash of entry seq-1 ("0"*64 for genesis)
  prevHashStream: string;                  // hash of previous entry in same stream ("0"*64 if first)
  entryHash: string;                       // see §9.2 recipe
}
```

### 4.4 ArielUpdateSet / ArielUpdateItem

One `ArielUpdateItem` per derived Ariel record per the Default Values sheet. `operation` is `UPSERT_ADD` where the sheet says the value is *added* to existing same-key transactions.

```ts
// src/types/ariel-update.ts
export type ArielRecordType =
  | 'Employment' | 'CalculationsBenefit' | 'MembershipStatus'
  | 'TransactionsService' | 'TransactionsContributions' | 'TransactionsSalaryRates'
  | 'PlansTaxInfoPA' | 'TransactionsServiceBreak' | 'BenefitReevaluationFlag';

export type ArielOperation = 'UPDATE' | 'CREATE' | 'UPSERT_ADD' | 'CLOSE' | 'DELETE' | 'SET_FLAG';

export interface ArielUpdateItem {
  itemId: string;
  updateSetId: string;
  sinPseudo: string;
  memberDisplay: string;                   // "***-***-563 SMITH, JOHN" (masked)
  employerId: string;
  recordType: ArielRecordType;
  operation: ArielOperation;
  /** Natural key used by Ariel to match an existing record (e.g. type+indicator+summaryAttr+dates). */
  targetKey: Record<string, string | number | null>;
  fields: Record<string, string | number | boolean | null>;   // resulting values
  before: Record<string, string | number | boolean | null> | null; // Ariel snapshot values
  sourceFields: EventsCsvColumn[];         // provenance to file columns
  derivationRule: string;                  // e.g. "D-CONTRIB-RPPHGH-CLC-CY"
  explanation: string;                     // human-readable, e.g. formula with numbers substituted
  ledgerEntryId: string;                   // ArielUpdateProposed entry that carries this item
}

export type UpdateSetStatus = 'BUILDING' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXPORTED';

export interface ArielUpdateSet {
  updateSetId: string;
  batchId: string;
  status: UpdateSetStatus;
  itemCount: number;
  memberCount: number;
  contentHash: string;                     // sha256 over JCS(items sorted by sinPseudo, recordType, targetKey)
  artifacts: { json: string; csv: string; diffMd: string; exportJson?: string; exportCsv?: string }; // gold paths
  builtAt: string;
}

export interface Approval {
  approvalId: string;
  updateSetId: string;
  decision: 'APPROVED' | 'REJECTED';
  actor: string;
  role: 'Reviewer' | 'Admin';
  reason: string | null;                   // mandatory on REJECTED
  contentHashAtDecision: string;           // must equal updateSet.contentHash (prevents TOCTOU)
  decidedAt: string;
  ledgerEntryId: string;
}
```

### 4.5 MemberProjection (read model)

```ts
// src/types/projection.ts
export interface MemberProjection {
  sinPseudo: string;
  sinMasked: string;                       // "***-***-563"
  lastName: string | null; firstName: string | null;
  employerIds: string[];
  latestEvent: { type: EventType; eventDate: IsoDate; batchId: string } | null;
  arielStatus: { status: string; subStatus: string | null; effectiveDate: IsoDate } | null; // after projected updates
  pendingUpdateItems: number;
  exportedUpdateItems: number;
  lastLedgerSeq: number;
  streamHeadHash: string;
  timeline: Array<{ seq: number; eventType: LedgerEventType; occurredAt: string; summary: string }>;
  updatedAt: string;
}
```

### 4.6 Ariel reference model (adapter contract)

```ts
// src/lib/ariel/adapter.ts
export interface ArielMemberSnapshot {
  memberId: string;
  sin: string;                             // only inside adapter boundary; callers receive sinPseudo-keyed data
  dateOfBirth: IsoDate;
  dateOfDeath: IsoDate | null;
  membership: {
    status: 'A' | 'D' | 'P' | 'T';         // Active, Deferred, Pensioner, Terminated(paid out)
    subStatus: string | null;              // e.g. 'NCT'
    statusEffectiveDate: IsoDate;
    subStatusEffectiveDate: IsoDate | null;
    calculationIndicators: string[];       // e.g. ['NHHSTM']
    statusHistory: Array<{ status: string; subStatus: string | null; effectiveDate: IsoDate }>;
  };
  employments: ArielEmployment[];
  pensionAdjustments: Array<{ employerId: string; calculationYear: number; amount: number; calculationDate: IsoDate; entryDate: IsoDate }>;
  addresses: Array<{ effectiveStartDate: IsoDate }>;
}

export interface ArielEmployment {
  employmentId: string;
  employerId: string;
  permanencyDate: IsoDate;                 // "Date of Registration / Enrolment"
  terminationDate: IsoDate | null;
  terminationCode: 'TER' | 'DEC' | 'RET' | 'AMA' | null;
  lastAnnualDataUpdate: IsoDate | null;
  otherInformation: string | null;         // e.g. "RetNotice 2025-03-31"
  employmentType: 'FT' | 'PT';
  employmentTypeHistory: Array<{ type: 'FT' | 'PT'; effectiveDate: IsoDate }>;
  serviceBreaks: Array<{ breakId: string; type: string; startDate: IsoDate; endDate: IsoDate | null }>;
  service: Array<{ txId: string; type: 'CTSRV' | 'FASRV' | 'ACW'; amount: DecimalString; beginDate: IsoDate; endDate: IsoDate;
                   paymentDate: IsoDate; targetDate: IsoDate; indicator: 'PRV' | 'CLC' | 'REGUL' | 'RETRO'; summaryAttribute: string }>;
  contributions: Array<{ txId: string; type: 'RPPLOW' | 'RPPHGH' | 'RCAHGH'; amount: DecimalString; beginDate: IsoDate; endDate: IsoDate;
                   paymentDate: IsoDate; targetDate: IsoDate; indicator: 'PRV' | 'CLC' | 'REGUL' | 'RETRO'; summaryAttribute: string }>;
  salaryRates: Array<{ txId: string; type: 'REPORT' | 'FARATE'; rate: number; effectiveDate: IsoDate; indicator: string; summaryAttribute: string }>;
}

export interface ArielRateTables {
  ympe(year: number): number;                        // table "MGA"
  paMaxDb(year: number): number;                     // table "PAMAXDB"
  paOffset(year: number): number;                    // table "REDFE": 600 post-1998, 1000 pre-1998
  lowContributionRate(year: number): number;         // 0.069
  highContributionRate(year: number): number;        // 0.092
}

export interface ArielReferenceAdapter {
  findMemberBySin(sin: string): Promise<ArielMemberSnapshot | null>;
  findMembersBySin(sin: string): Promise<ArielMemberSnapshot[]>;   // B204 duplicate detection
  employerExists(employerId: string): Promise<boolean>;
  rates(): ArielRateTables;
  /** Cached per batch: all lookups for a batch are served from a snapshot taken at VALIDATING start. */
  snapshotForBatch(batchId: string, sins: string[]): Promise<Map<string /*sinPseudo*/, ArielMemberSnapshot>>;
}
```

#### Mock seed dataset (`MockArielAdapter`, seeded from `tests/fixtures/ariel-seed.json`)

All seed members belong to employer `0235` unless stated; execution date assumed `2026-10-08`; rates: YMPE 2025 = 71 300, 2026 = 74 600 (placeholder — §18 Q9); low rate 6.9 %, high rate 9.2 %; PAMAXDB 2026 = 34 416 (placeholder).

| # | SIN (test range 9xx) | Name | Scenario | Key Ariel facts |
|---|---|---|---|---|
| M1 | 900000001 | ABLE, Anna | **Happy path TERFIN** | A, FT, permanency 2015-03-02, no term, no breaks; MDC 2025 CTSRV 52 wks posted (summary "MDC – Core Data"), PA 2025 posted; no 2026 transactions |
| M2 | 900000002 | BAKER, Ben | **Happy path DECFIN** | A, FT, permanency 2010-01-04, no term; MDC 2025 posted |
| M3 | 900000003 | CHEN, Carol | **Happy path RETFIN** | A, FT, permanency 2001-09-10, `otherInformation = "RetNotice 2026-06-30"`, terminationDate 2026-06-30, terminationCode RET (retirement initiated); no CTSRV in 2026 |
| M4 | 900000004 | DIAZ, Dan | **Already terminated** | terminationDate 2025-11-15, code TER, membership D/NCT → B5 rejects TERFIN |
| M5 | 900000005 | EVANS, Eve | **Deceased** | dateOfDeath 2025-08-01, terminationCode DEC → B5 rejects RETFIN/DECFIN resubmission |
| M6 | 900000006 | FOX, Frank | **Retiree with CTSRV in year** | status P, terminationCode RET 2026-02-28; CTSRV 2026 8 wks already posted → B5 rejects RETFIN; used for Benefit Re-evaluation flag test when CTSRV absent (variant M6b 900000016, no CTSRV, status P → flag ON) |
| M7 | 900000007 | GREY, Gina | **Permanency after Jan 1 of event year** | permanency 2026-03-16 (mid-year enrolment) → service/contribution BeginDate = 2026-03-16; B184b/B186b path; B192b not triggered because Year(permanency) == event year |
| M8 | 900000008 | HALL, Hugo | **Under-age edge** | DOB 2009-05-05 (17 at event); no age rule applies to Events (B105/B108 are Retirement Notice only) — documents that *no* rejection occurs; used to prove rule scoping |
| M9 | 900000009 | IRWIN, Ida | **Over-71 edge** | DOB 1954-02-01 (72); same purpose as M8; RETFIN happy path with RetNotice |
| M10 | 900000010 | JONES, Jack | **LTD full year** | LTD break 2025-01-01 → open; triggers B22 when weeks/contribs reported; B53b path |
| M11 | 900000011 | KING, Kim | **WSO (waived) break** | WSO 2026-01-01→open → B19b requires AnnualizedEarnings; B19 rejects AE when absent (M1) |
| M12 | 900000012 | LEE, Liam | **Part-time with NC leave** | PT since 2024; NCP 2026-02-01→2026-04-30 → B214 path; B33 lump-sum path (has RPPLOW with summary RCL in 2026) |
| M13 | 900000013 | MOORE, Mia | **NHH member** | employer 0235 St. Michael's, indicator NHHSTM, merger 2019-07-01; previous-year targets before 2019-07-01 → B223 |
| M14 | 900000014 | NG, Noah | **Retro paid in year** | RETRO-indicator contribution paymentDate 2026-04-15 → B181/B182 when PA≠0 & zero weeks/contribs |
| M15 | 900000015 | OWEN, Olivia | **Enrolled Dec 8–31 last year** | permanency 2025-12-15 → B31 when Weeks_CurrentYear = 0 and executionDate year = 2025 (fixture sets executionDate) |
| M16 | 900000017 | PATEL, Priya | **Concurrent employer** | employments at 0235 (active) and 0359 (active) → B5 applies only to reporting employer |
| M17 | 900000018 | QUINN, Quentin | **Duplicate SIN in Ariel** | two member rows share SIN → B204 |
| M18 | 900000019 | ROSS, Rae | **Disability breaks on TERFIN** | breaks DTO 2026-01-10→open, NCS 2026-05-01→open, NCM 2026-11-01→2026-12-15 (starts after end date 2026-09-30) → closure/deletion rules |

SIN check: all test SINs must pass Luhn (mod-10) so B3-style checks (not applicable to Events, see §7.9.6) never interfere; the seed generator recomputes the check digit.

---

## 5. Data lake layout

Root is `LAKE_ROOT` (default `./.lake`, git-ignored). Interface `LakeStore` (`put`, `get`, `list`, `exists`, `stat`) with `FsLakeStore` (v1) and `AdlsLakeStore` (later). All writes are **write-once**: a put to an existing path throws unless the zone is `gold` and the file is a regenerated report.

```
<LAKE_ROOT>/
  raw/      employer=<employerId>/filetype=events/ingest_date=<YYYY-MM-DD>/batch=<batchId>/
              original.csv                 # bytes exactly as uploaded
              manifest.json
  bronze/   employer=<employerId>/filetype=events/ingest_date=<YYYY-MM-DD>/batch=<batchId>/
              records.ndjson               # canonical EventsRecord per line, SIN replaced by sinPseudo + sinMasked
              parse-errors.ndjson          # rows that could not be mapped at all (I50/I51 context)
              header.json                  # observed header, column order, encoding, delimiter
  silver/   employer=<employerId>/filetype=events/ingest_date=<YYYY-MM-DD>/batch=<batchId>/
              accepted.ndjson              # records with no COMPLETE_MEMBER_ERROR
              rejected.csv                 # Rejected Individuals: same layout as input, raw SIN (encrypted at rest by zone policy)
              findings.ndjson
              ariel-snapshot.ndjson        # adapter snapshot used (sinPseudo-keyed, raw SIN removed) — makes L2 reproducible
  gold/     employer=<employerId>/filetype=events/ingest_date=<YYYY-MM-DD>/batch=<batchId>/
              update-set/ariel-update-set.json
              update-set/ariel-update-set.csv
              update-set/diff.md
              reports/execution-report.html
              reports/execution-report.json
              reports/summary-of-validations.csv          # + .xlsx in Phase 4
              reports/summary-of-validations.private.csv  # includes PRIVATE findings (CTL)
              reports/modified-fields-report.csv
              reports/transactions-report.csv
              reports/membership-reconciliation.csv
              export/<exportId>/ariel-update-set.json     # only after approval
              export/<exportId>/ariel-update-set.csv
              export/<exportId>/export-manifest.json
  anchors/  chain-head-<YYYY-MM-DD>T<HHmmss>Z.json       # periodic published chain heads (§9.5)
```

### 5.1 `manifest.json`

```json
{
  "schemaVersion": 1,
  "batchId": "0192f3a4-7c2e-7a8e-9f3a-5d1b2c3d4e5f",
  "employerId": "0235",
  "fileType": "EVENTS",
  "sourceSystem": "HOOPP_CSV",
  "originalFilename": "events_2026-10-08.csv",
  "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "sizeBytes": 18234,
  "uploadedBy": "user:es-0235-jsmith",
  "receivedAt": "2026-10-08T14:03:11.412Z",
  "executionDate": "2026-10-08",
  "contentType": "text/csv",
  "encodingDetected": "windows-1252",
  "lineCount": 121,
  "retention": { "class": "regulatory", "deleteNotBefore": "2033-10-08" }
}
```

### 5.2 Retention

| Zone | Retention (default) | Rationale |
|---|---|---|
| raw | 7 years, immutable | Regulatory evidence of what the employer sent |
| bronze | 7 years | Reproducibility of parse |
| silver | 7 years | Rejected Individuals + findings are employer-facing records |
| gold | 7 years for `export/`, 2 years for regenerable reports | Exports are what reached Ariel |
| anchors | permanent | Chain integrity proof |

Deletion of PII on legal request is handled by **crypto-shredding**: raw SIN only exists encrypted under a per-member data key (§13.3); destroying the key renders raw/silver copies unreadable without touching the hash chain.

---

## 6. Postgres schema

Drizzle schema lives in `src/db/schema/*.ts`; migrations in `drizzle/`. The DDL below is normative; Drizzle must generate the equivalent. Postgres 16. Schema `public`; mock Ariel tables in schema `ariel_mock`.

```sql
-- ===== Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===== Enums
CREATE TYPE batch_status AS ENUM ('RECEIVED','PARSED','VALIDATED','LEDGERED','PROJECTION_BUILT',
  'PENDING_APPROVAL','APPROVED','REJECTED','EXPORTED','FAILED','FILE_REJECTED');
CREATE TYPE finding_level AS ENUM ('L0','L1','L2');
CREATE TYPE finding_severity AS ENUM ('FILE_ERROR','COMPLETE_MEMBER_ERROR','WARNING','INFORMATION');
CREATE TYPE finding_visibility AS ENUM ('PUBLIC','PRIVATE');
CREATE TYPE update_set_status AS ENUM ('BUILDING','PENDING_APPROVAL','APPROVED','REJECTED','EXPORTED');
CREATE TYPE ariel_operation AS ENUM ('UPDATE','CREATE','UPSERT_ADD','CLOSE','DELETE','SET_FLAG');

-- ===== Batches & files
CREATE TABLE raw_files (
  raw_file_id        uuid PRIMARY KEY,
  original_filename  text NOT NULL,
  sha256             char(64) NOT NULL,
  size_bytes         bigint NOT NULL,
  encoding_detected  text NOT NULL,
  lake_path          text NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE batches (
  batch_id        uuid PRIMARY KEY,
  employer_id     text NOT NULL,
  file_type       text NOT NULL CHECK (file_type = 'EVENTS'),
  source_system   text NOT NULL DEFAULT 'HOOPP_CSV',
  status          batch_status NOT NULL DEFAULT 'RECEIVED',
  execution_date  date NOT NULL,
  raw_file_id     uuid NOT NULL REFERENCES raw_files(raw_file_id),
  uploaded_by     text NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  rows_total      int NOT NULL DEFAULT 0,
  rows_accepted   int NOT NULL DEFAULT 0,
  rows_rejected   int NOT NULL DEFAULT 0,
  warnings_total  int NOT NULL DEFAULT 0,
  infos_total     int NOT NULL DEFAULT 0,
  failure_reason  text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- Idempotency: the same bytes from the same employer may only be processed once unless admin forces a reprocess
CREATE UNIQUE INDEX ux_batches_employer_filehash
  ON batches (employer_id, (SELECT sha256 FROM raw_files r WHERE r.raw_file_id = batches.raw_file_id));
-- (Drizzle: implement as a trigger or by storing file_sha256 denormalised on batches; see note below)
ALTER TABLE batches ADD COLUMN file_sha256 char(64) NOT NULL;
CREATE UNIQUE INDEX ux_batches_employer_sha ON batches (employer_id, file_sha256) WHERE status <> 'FILE_REJECTED';
CREATE INDEX ix_batches_status_received ON batches (status, received_at DESC);

CREATE TABLE batch_status_history (
  id          bigserial PRIMARY KEY,
  batch_id    uuid NOT NULL REFERENCES batches(batch_id),
  from_status batch_status,
  to_status   batch_status NOT NULL,
  actor       text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  note        text
);

-- ===== Records (PII-minimised; raw SIN never stored here)
CREATE TABLE events_records (
  record_id          uuid PRIMARY KEY,
  batch_id           uuid NOT NULL REFERENCES batches(batch_id),
  line_number        int NOT NULL,
  sin_pseudo         char(64) NOT NULL,                 -- HMAC-SHA256 hex
  sin_masked         char(11) NOT NULL,                 -- ***-***-563
  sin_enc            bytea NOT NULL,                    -- AES-256-GCM(raw SIN) under member data key; for Rejected Individuals + export
  last_name          text, first_name text,
  event_type         text CHECK (event_type IN ('TERFIN','DECFIN','RETFIN')),
  employment_end_date date,
  date_of_death      date,
  event_year         int,
  cy_weeks           numeric(6,2), cy_low numeric(10,2), cy_high numeric(10,2), cy_ae int, cy_pa int,
  py_weeks           numeric(6,2), py_low numeric(10,2), py_high numeric(10,2), py_ae int, py_pa int,
  raw_values         jsonb NOT NULL,                    -- original strings per column (SIN masked)
  parse_ok           boolean NOT NULL,
  accepted           boolean,                           -- null until VALIDATED
  UNIQUE (batch_id, line_number)
);
CREATE INDEX ix_records_batch_sin ON events_records (batch_id, sin_pseudo);
CREATE INDEX ix_records_sin ON events_records (sin_pseudo);

-- ===== Findings
CREATE TABLE validation_findings (
  finding_id     uuid PRIMARY KEY,
  batch_id       uuid NOT NULL REFERENCES batches(batch_id),
  record_id      uuid REFERENCES events_records(record_id),
  line_number    int,
  sin_pseudo     char(64),
  rule_id        text NOT NULL,
  message_id     text NOT NULL,
  level          finding_level NOT NULL,
  severity       finding_severity NOT NULL,
  visibility     finding_visibility NOT NULL DEFAULT 'PUBLIC',
  field          text,
  year_scope     text CHECK (year_scope IN ('CURRENT','PREVIOUS')),
  params         jsonb NOT NULL DEFAULT '{}',
  data_import_message text NOT NULL,
  portal_message text NOT NULL,
  override_reasons jsonb NOT NULL DEFAULT '[]',
  override_reason  text,
  override_actor   text,
  override_at      timestamptz,
  calculated     jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_findings_batch_sev ON validation_findings (batch_id, severity);
CREATE INDEX ix_findings_record ON validation_findings (record_id);
CREATE INDEX ix_findings_rule ON validation_findings (rule_id);

-- ===== Ledger (append-only, hash-chained)
CREATE TABLE ledger_entries (
  seq              bigint PRIMARY KEY,                  -- assigned by append function, gap-free
  entry_id         uuid NOT NULL UNIQUE,
  stream_id        text NOT NULL,
  stream_seq       bigint NOT NULL,
  event_type       text NOT NULL,
  batch_id         uuid,
  actor            text NOT NULL,
  occurred_at      timestamptz NOT NULL,
  payload          jsonb NOT NULL,
  payload_hash     char(64) NOT NULL,
  prev_hash_global char(64) NOT NULL,
  prev_hash_stream char(64) NOT NULL,
  entry_hash       char(64) NOT NULL UNIQUE,
  UNIQUE (stream_id, stream_seq)
);
CREATE INDEX ix_ledger_stream ON ledger_entries (stream_id, stream_seq);
CREATE INDEX ix_ledger_batch ON ledger_entries (batch_id);
CREATE INDEX ix_ledger_type_time ON ledger_entries (event_type, occurred_at);

-- Head pointers (one row per stream + one 'global' row) enable O(1) append with a row lock
CREATE TABLE ledger_heads (
  stream_id   text PRIMARY KEY,                          -- '__global__' or stream id
  last_seq    bigint NOT NULL,
  last_hash   char(64) NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ledger_heads VALUES ('__global__', 0, repeat('0',64), now());

-- Immutability: no UPDATE/DELETE ever, enforced in the DB, not just the app
CREATE OR REPLACE FUNCTION ledger_block_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'ledger_entries is append-only'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE OR DELETE OR TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_block_mutation();

-- Chain integrity on insert: prev hashes must equal current heads; seq must be head+1
CREATE OR REPLACE FUNCTION ledger_check_chain() RETURNS trigger AS $$
DECLARE g ledger_heads%ROWTYPE; s ledger_heads%ROWTYPE;
BEGIN
  SELECT * INTO g FROM ledger_heads WHERE stream_id = '__global__' FOR UPDATE;
  IF NEW.seq <> g.last_seq + 1 OR NEW.prev_hash_global <> g.last_hash THEN
    RAISE EXCEPTION 'global chain mismatch at seq %', NEW.seq;
  END IF;
  SELECT * INTO s FROM ledger_heads WHERE stream_id = NEW.stream_id FOR UPDATE;
  IF NOT FOUND THEN
    IF NEW.stream_seq <> 1 OR NEW.prev_hash_stream <> repeat('0',64) THEN
      RAISE EXCEPTION 'stream genesis mismatch for %', NEW.stream_id; END IF;
    INSERT INTO ledger_heads VALUES (NEW.stream_id, NEW.stream_seq, NEW.entry_hash, now());
  ELSE
    IF NEW.stream_seq <> s.last_seq + 1 OR NEW.prev_hash_stream <> s.last_hash THEN
      RAISE EXCEPTION 'stream chain mismatch for %', NEW.stream_id; END IF;
    UPDATE ledger_heads SET last_seq = NEW.stream_seq, last_hash = NEW.entry_hash, updated_at = now()
      WHERE stream_id = NEW.stream_id;
  END IF;
  UPDATE ledger_heads SET last_seq = NEW.seq, last_hash = NEW.entry_hash, updated_at = now() WHERE stream_id = '__global__';
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_ledger_chain BEFORE INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_check_chain();

-- The app role gets INSERT/SELECT only on ledger_entries (no UPDATE/DELETE grant) — belt and braces.

-- ===== Ariel Update Sets
CREATE TABLE ariel_update_sets (
  update_set_id uuid PRIMARY KEY,
  batch_id      uuid NOT NULL UNIQUE REFERENCES batches(batch_id),
  status        update_set_status NOT NULL DEFAULT 'BUILDING',
  item_count    int NOT NULL DEFAULT 0,
  member_count  int NOT NULL DEFAULT 0,
  content_hash  char(64),
  artifacts     jsonb NOT NULL DEFAULT '{}',
  built_at      timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ariel_update_items (
  item_id         uuid PRIMARY KEY,
  update_set_id   uuid NOT NULL REFERENCES ariel_update_sets(update_set_id),
  sin_pseudo      char(64) NOT NULL,
  member_display  text NOT NULL,
  employer_id     text NOT NULL,
  record_type     text NOT NULL,
  operation       ariel_operation NOT NULL,
  target_key      jsonb NOT NULL,
  fields          jsonb NOT NULL,
  before_values   jsonb,
  source_fields   jsonb NOT NULL DEFAULT '[]',
  derivation_rule text NOT NULL,
  explanation     text NOT NULL,
  ledger_entry_id uuid NOT NULL REFERENCES ledger_entries(entry_id),
  sort_order      int NOT NULL
);
CREATE INDEX ix_items_set_member ON ariel_update_items (update_set_id, sin_pseudo, sort_order);
CREATE INDEX ix_items_member ON ariel_update_items (sin_pseudo);

CREATE TABLE approvals (
  approval_id     uuid PRIMARY KEY,
  update_set_id   uuid NOT NULL REFERENCES ariel_update_sets(update_set_id),
  decision        text NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  actor           text NOT NULL,
  role            text NOT NULL,
  reason          text,
  content_hash_at_decision char(64) NOT NULL,
  decided_at      timestamptz NOT NULL DEFAULT now(),
  ledger_entry_id uuid NOT NULL REFERENCES ledger_entries(entry_id),
  CHECK (decision <> 'REJECTED' OR reason IS NOT NULL)
);
CREATE UNIQUE INDEX ux_approvals_one_final ON approvals (update_set_id) WHERE decision = 'APPROVED';

CREATE TABLE exports (
  export_id       uuid PRIMARY KEY,
  update_set_id   uuid NOT NULL REFERENCES ariel_update_sets(update_set_id),
  actor           text NOT NULL,
  exported_at     timestamptz NOT NULL DEFAULT now(),
  json_path       text NOT NULL, csv_path text NOT NULL,
  json_sha256     char(64) NOT NULL, csv_sha256 char(64) NOT NULL,
  ledger_entry_id uuid NOT NULL REFERENCES ledger_entries(entry_id)
);

-- ===== Projections (rebuildable)
CREATE TABLE member_projections (
  sin_pseudo        char(64) PRIMARY KEY,
  sin_masked        char(11) NOT NULL,
  last_name text, first_name text,
  employer_ids      jsonb NOT NULL DEFAULT '[]',
  latest_event      jsonb,
  ariel_status      jsonb,
  pending_items     int NOT NULL DEFAULT 0,
  exported_items    int NOT NULL DEFAULT 0,
  last_ledger_seq   bigint NOT NULL,
  stream_head_hash  char(64) NOT NULL,
  timeline          jsonb NOT NULL DEFAULT '[]',
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE projection_checkpoints (
  projection_name text PRIMARY KEY,
  last_seq        bigint NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ===== Audit log (non-ledger operational audit: logins, views of PII, config changes)
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), actor text NOT NULL, role text,
  action text NOT NULL, target text, ip inet, details jsonb
);

-- ===== Mock Ariel reference (schema ariel_mock)
CREATE SCHEMA ariel_mock;
CREATE TABLE ariel_mock.members (
  member_id uuid PRIMARY KEY, sin_enc bytea NOT NULL, sin_pseudo char(64) NOT NULL, -- NOT unique: B204 fixture needs duplicates
  last_name text, first_name text, date_of_birth date NOT NULL, date_of_death date,
  status text NOT NULL, sub_status text, status_effective_date date NOT NULL, sub_status_effective_date date,
  calculation_indicators jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX ix_mock_members_sin ON ariel_mock.members (sin_pseudo);
CREATE TABLE ariel_mock.membership_status_history (
  id bigserial PRIMARY KEY, member_id uuid REFERENCES ariel_mock.members, status text, sub_status text, effective_date date NOT NULL);
CREATE TABLE ariel_mock.employers (employer_id text PRIMARY KEY, name text NOT NULL, year_end_closed_indicator date);
CREATE TABLE ariel_mock.employments (
  employment_id uuid PRIMARY KEY, member_id uuid NOT NULL REFERENCES ariel_mock.members, employer_id text NOT NULL REFERENCES ariel_mock.employers,
  permanency_date date NOT NULL, termination_date date, termination_code text, last_annual_data_update date,
  other_information text, employment_type text NOT NULL, termination_data_update date);
CREATE TABLE ariel_mock.employment_type_history (
  id bigserial PRIMARY KEY, employment_id uuid REFERENCES ariel_mock.employments, type text NOT NULL, effective_date date NOT NULL);
CREATE TABLE ariel_mock.service_breaks (
  break_id uuid PRIMARY KEY, employment_id uuid NOT NULL REFERENCES ariel_mock.employments, type text NOT NULL, start_date date NOT NULL, end_date date);
CREATE TABLE ariel_mock.service_tx (
  tx_id uuid PRIMARY KEY, employment_id uuid NOT NULL REFERENCES ariel_mock.employments, type text NOT NULL, amount numeric(8,4) NOT NULL,
  begin_date date NOT NULL, end_date date NOT NULL, payment_date date NOT NULL, target_date date NOT NULL, declaration_date date,
  indicator text NOT NULL, summary_attribute text NOT NULL);
CREATE TABLE ariel_mock.contribution_tx (
  tx_id uuid PRIMARY KEY, employment_id uuid NOT NULL REFERENCES ariel_mock.employments, type text NOT NULL, amount numeric(12,2) NOT NULL,
  begin_date date NOT NULL, end_date date NOT NULL, payment_date date NOT NULL, target_date date NOT NULL, declaration_date date,
  indicator text NOT NULL, summary_attribute text NOT NULL);
CREATE TABLE ariel_mock.salary_rates (
  tx_id uuid PRIMARY KEY, employment_id uuid NOT NULL REFERENCES ariel_mock.employments, type text NOT NULL, rate numeric(12,2) NOT NULL,
  effective_date date NOT NULL, entry_date date, indicator text NOT NULL, summary_attribute text NOT NULL);
CREATE TABLE ariel_mock.pension_adjustments (
  pa_id uuid PRIMARY KEY, member_id uuid NOT NULL REFERENCES ariel_mock.members, employer_id text NOT NULL,
  calculation_year int NOT NULL, amount int NOT NULL, calculation_date date NOT NULL, entry_date date NOT NULL);
CREATE TABLE ariel_mock.addresses (id bigserial PRIMARY KEY, member_id uuid REFERENCES ariel_mock.members, effective_start_date date NOT NULL);
CREATE TABLE ariel_mock.rate_tables (table_name text NOT NULL, year int NOT NULL, value numeric(14,4) NOT NULL, PRIMARY KEY (table_name, year));
-- table_name ∈ 'MGA' (YMPE), 'PAMAXDB', 'REDFE' (PA offset), 'LOWRATE', 'HIGHRATE'
```

Notes:
- `file_sha256` on `batches` is the idempotency key (the subselect index shown first is illustrative only; Drizzle uses the denormalised column).
- The app's DB role is created with `GRANT SELECT, INSERT ON ledger_entries` only; migrations run as owner.
- All `numeric` money columns map to `Decimal` via a Drizzle custom type; never `number`.

---
## 7. Rules engine

### 7.1 Rule interface

```ts
// src/lib/rules/types.ts
export type RuleLevel = 'L0' | 'L1' | 'L2';
export type RuleSection = 'EVENTS';                        // v1; future: 'CORE_DATA' | 'RETRO' | ...

export interface RuleContext {
  batch: Batch;                                             // executionDate, employerId
  file: { header: string[]; rows: RawEventsRow[]; records: EventsRecord[] };
  ariel: ArielBatchSnapshot;                                // lookups by sinPseudo; null member => not found
  rates: ArielRateTables;
  config: RulesConfig;                                      // tolerances & enable flags (§7.7)
  derived: (record: EventsRecord) => FileDerived | null;    // provisional derivation (§8.1) for L2 rules
  now: () => IsoDate;                                       // injected clock (deterministic tests)
}

export interface Rule {
  id: string;                                               // "B184c"
  label: string;                                            // "B184c_Excess ServiceTerminatedMidYear"
  messageId: string | ((f: FindingDraft) => string);        // some rules carry several IDs
  level: RuleLevel;
  severity: FindingSeverity;
  visibility: FindingVisibility;
  section: RuleSection[];
  tool: 'DataImport' | 'CustomDLL' | 'StandardValidationModule';   // informational, from spec
  overrideReasons: string[];
  dataImportMessage: string;                                // template with {n} placeholders
  portalMessage: string;
  enabledByDefault: boolean;                                // e.g. B181 false (disabled since R14)
  /** L0: called once with the whole file. L1/L2: called per record. */
  appliesTo(record: EventsRecord | null, ctx: RuleContext): boolean;
  evaluate(record: EventsRecord | null, ctx: RuleContext): FindingDraft[];
}

export interface FindingDraft {
  ruleId: string; field?: EventsCsvColumn; yearScope?: 'CURRENT' | 'PREVIOUS';
  params: Record<string, string | number>; calculated?: Record<string, string | number>;
  messageIdOverride?: string;
}
```

Rules are **pure**: no I/O, no `Date.now()`, no randomness. All Ariel data comes from the pre-fetched `ArielBatchSnapshot`; all dates come from `ctx.batch.executionDate`/`ctx.now()`.

### 7.2 Registry

`src/lib/rules/registry.ts` exports `EVENTS_RULES: Rule[]` assembled from one file per rule (`src/lib/rules/events/B184c.ts`). A startup assertion verifies: unique `id`, every rule has fixtures (`tests/rules/<id>.spec.ts` exists — checked by a Vitest meta-test), and message templates have no unresolved placeholders after rendering with fixture params.

### 7.3 Execution order and short-circuit semantics

```mermaid
flowchart TD
  A[L0 file rules<br/>I50, I51] -->|any FILE_ERROR| X[Batch → FILE_REJECTED<br/>no records processed]
  A -->|clean| B[Parse all rows → EventsRecord]
  B --> C[L1 per-record rules<br/>format, mandatory, lengths, negatives, cross-field, duplicates]
  C -->|record has COMPLETE_MEMBER_ERROR| R1[Record REJECTED<br/>skip L2 for this record]
  C -->|clean or warnings| D[Provisional derivation FileDerived.*]
  D --> E[L2 per-record rules<br/>business rules with Ariel snapshot]
  E -->|COMPLETE_MEMBER_ERROR| R2[Record REJECTED]
  E -->|WARNING without override| W[Record HELD<br/>needs override before projection]
  E -->|clean / overridden / INFORMATION only| OK[Record ACCEPTED]
```

Rules within a level run in **registry order** (the catalogue order in §7.9), and **all** rules in a level are evaluated for a record even after the first error so the employer sees every problem at once (legacy behaviour: Summary of Validations lists all). Exceptions: (a) if `I2` (SIN blank) fires, SIN-keyed rules (`I10`, all L2) are skipped for that record; (b) if a field failed L1 parsing (`undefined`), L2 rules that read it report nothing for that field (the L1 finding already rejects the member).

Severity semantics:

| Severity | Effect |
|---|---|
| `FILE_ERROR` | Entire batch rejected (`FILE_REJECTED`); only the Execution Report and the file-level findings are produced |
| `COMPLETE_MEMBER_ERROR` | The member's row is rejected: no derivation, no `ArielUpdateProposed`; row goes to Rejected Individuals CSV |
| `WARNING` | Row is accepted **only once every warning has an override reason** chosen from the rule's list (Reviewer or Submitter action in UI, recorded on the ledger as `WarningOverridden`). Until then the row is `HELD` and excluded from the Update Set build; the batch cannot leave `VALIDATED` while any row is HELD (§10) |
| `INFORMATION` | Logged; never blocks. `PRIVATE` ones appear only in the private Summary of Validations (Control Report) |

Per-year duplication: rules the spec says "execute twice" (B22, B53a/b, B184*, B185, B186*, B214, B19/B19b, B40–B47, B192a) are implemented once with a `yearScope` loop over `CURRENT` then `PREVIOUS`; each produces independent findings with `yearScope` set, and previous-year evaluation is skipped when every previous-year field is null.

### 7.4 Message parameter templating

Templates use the spec's `{n}` placeholders. `renderMessage(template, params)` replaces `{n}` with `String(params[n])`; money is formatted `#,##0.00`, years as `YYYY`, dates as `MM-DD-YYYY` (spec convention in B57). Unresolved placeholders are a test failure. `portalMessage` is stored verbatim (no params). Both are persisted on the finding so reports never need to re-render.

### 7.5 Warning override reasons

Each warning rule exposes `overrideReasons: string[]` exactly as the spec lists them. An override request must quote one of them verbatim (or `"Other - please provide explanation"` + free-text `note` where the spec offers "Other"). Overrides are per finding, actor-attributed, ledgered, and included in the Summary of Validations with the chosen reason.

### 7.6 Determinism

- Input to the engine is `(bronze records, ariel-snapshot.ndjson, rules config, executionDate)` — all persisted in the lake, so a batch can be re-validated offline and must yield byte-identical `findings.ndjson` (golden test).
- Decimal arithmetic via `decimal.js` with `ROUND_HALF_UP`, 2 dp for money, 2 dp for weeks (`ROUNDUP`/`ROUNDDOWN` where the spec says so — B184 uses ROUNDUP, B185/B186 ROUNDDOWN).
- Day counts are computed on civil dates (`differenceInCalendarDays`).

### 7.7 Rules configuration (`config/rules.events.json`, validated by zod)

```json
{
  "enabled": { "B181": false, "B3": false },
  "tolerances": {
    "B37.tolerance1Weeks": 2, "B37.tolerance2Dollars": 5,
    "B38.toleranceWeeks": -1,
    "B40.pct": 0.15, "B41.pct": 0.50, "B43.amount": -2500, "B44.amount": -50000,
    "B47.min": 20000, "B47.max": 120000,
    "B53a.pa": 250, "B53b.pa": 0,
    "B184a.weeks": 0, "B184b.weeks": 0, "B184c.weeks": 3,
    "B185.weeks": -1, "B186a.weeks": -1, "B186b.weeks": -3.42, "B186c.factor": 0.65,
    "B214.weeks": 0.14,
    "B31.windowStart": "12-08"
  },
  "nhh": { "NHHSIS": "2019-01-01", "NHHSTJ": "2019-01-01", "NHHPRO": "2019-01-01", "NHHSTM": "2019-07-01", "NHHGR": "2019-06-01" },
  "nhhEmployers": ["0359", "0235", "0135"]
}
```

Changing config is an Admin action and is ledgered (`system` stream) with the config hash; findings carry no config copy but the batch records `rulesConfigHash`.

### 7.8 Unit-testing rules with fixtures

Every rule has `tests/rules/<RuleId>.spec.ts` using a `ruleHarness(rule)` helper:

```ts
const h = ruleHarness(B184c);
h.given({ record: rec({ eventType: 'TERFIN', employmentEndDate: '2026-09-30', cy: { weeks: '45.00' } }),
          ariel: member(M1, { service: [ctsrv('2026', 5)] }) })
 .expectFinding({ messageId: '7854', yearScope: 'CURRENT', params: { 2: 2026, 3: '38.86' } });
h.given({ record: rec({ ... weeks: '38.00' }), ariel: member(M1) }).expectNoFinding();
```

Fixture builders: `rec()`, `member()`, `ctsrv()`, `contrib()`, `brk()`, `salaryRate()`. Each spec must contain at least one positive and one negative case, plus one per `yearScope` for twice-executed rules, plus one per message ID for multi-ID rules. Golden files in `tests/golden/<scenario>/{input.csv, ariel-seed.json, expected-findings.ndjson}` cover whole-file behaviour.

### 7.9 Full catalogue of Events-applicable rules

Selection method: every block in the v15.1 spec whose **Section** contains `Events`, `Events (Final Data)`, `Final Data`, `All files`, `All`, `Core Data and Events`, `Core (MDC) and Events`, or `Contributions Events` was read in full. Rules marked `(Removed)` were skipped. Result: **58 spec rules apply to the Events CSV** (2 × L0, 15 × L1, 41 × L2), plus **1 rule adopted by extension** (I9) and **4 reviewed and excluded** with reasons (§7.9.6). Message texts are verbatim from the spec (DataImport message first; Portal message second). "Ariel data" lists what the adapter snapshot must supply.

Notation: `CY` = current-year block, `PY` = previous-year block, `EventDate` = `EmploymentEndDate` (TERFIN/RETFIN) or `DateOfDeath` (DECFIN), `EventYear = Year(EventDate)`, `ExecDate = Batch.executionDate`, `Emp` = Ariel employment matched on (SIN, Batch.employerId) with the most recent permanency date.

#### 7.9.1 Level 0 — file-level rules (run once per file)

| # | Rule / Message ID | Severity | Logic summary | Reads | Ariel | Messages |
|---|---|---|---|---|---|---|
| 1 | **I50_ValidateFileLayout** / 130 | FILE_ERROR | Reject the file if any data row contains more values than the header has column names (values "not associated with a column header"). Implementation: after CSV parse, any `RawEventsRow.extraValues.length > 0` ⇒ fire once with the first offending line in `calculated`. | all rows | none | DI: "The imported file contains data that is not associated with a valid column header." / Portal: same |
| 2 | **I51_ValidateFileHeaderLayout** / 4887 | FILE_ERROR (spec lists "Complete Member Error" but the logic says *reject the input file*; we treat it as file-level — §18 Q2) | Reject the file if any header label is not one of `EVENTS_CSV_COLUMNS` (case-sensitive exact match after trimming and BOM removal), or a column name is duplicated (test matrix: ID 6926 "The system was not able to properly process the input file" — we emit I51 with `calculated.reason='DUPLICATE_HEADER'`). Missing **non-mandatory** columns are allowed (test matrix row "Missing non-mandatory column → none"); missing mandatory columns are reported per row by I1. Column order is not enforced. | header | none | DI: "The imported file contains invalid column headers." / Portal: same |

#### 7.9.2 Level 1 — field/format rules (per record)

| # | Rule / Message ID | Severity | Logic summary | Reads | Messages & params |
|---|---|---|---|---|---|
| 3 | **I1_InputDataNotProvided** / 8233 | CME | For every mandatory field (matrix §4.1): null/blank ⇒ one finding per missing field. `EmploymentEndDate` is mandatory only when `EventType ∈ {TERFIN, RETFIN}`; `DateOfDeath` only when DECFIN (CSV cannot carry it — §18 Q1). | all mandatory fields | DI: "{1} is a required field." (1 = input field name) / Portal: "A mandatory field was not provided in the data file." |
| 4 | **I2_InputIdentifierNotProvided** / 2031 | CME | `SIN` blank ⇒ reject; suppresses SIN-keyed rules for the row. | SIN | DI/Portal: "SIN is a mandatory field in the data file." |
| 5 | **I3_MaximumMandatoryFieldsLength** / 9519 | CME | Length (characters, including decimal point) exceeds max: `Weeks_*` 5, `LowContributions_*` 8, `HighContributions_*` 8, `AnnualizedEarnings_*` 6, `PA_*` 5. (LastName/FirstName are only checked in Enrolments/MBI per spec note.) One finding per offending field. | the 10 numeric fields | DI/Portal: "The field {File.FieldName} exceeds the maximum acceptable length of {Max Length} characters (including decimal point, if applicable)." |
| 6 | **I5_InvalidDate** / 825 | CME | `EmploymentEndDate` (and `DateOfDeath` if present): left-pad with `0` to 8 chars (layout note), then must be numeric, `MMDDYYYY`, and a real calendar date. | EmploymentEndDate, DateOfDeath | DI: "{1} is invalid. Date must be in MMDDYYYY format." (1 = input value) / Portal: "The date value is invalid. Date must be in MMDDYYYY format." |
| 7 | **I7_InvalidDecimal** / 6503 (CY fields) · 6642 (PY fields) | CME | Decimal fields (`Weeks_*`, `LowContributions_*`, `HighContributions_*`): must be numeric with `.` decimal symbol and ≤ 2 decimal places. Spec gives two IDs; we assign 6503 to current-year and 6642 to previous-year fields (§18 Q3). | 6 decimal fields | DI: "{1} is invalid. Value cannot have more than two decimal places." / Portal: "The decimal value is invalid. Value cannot have more than two decimal places." |
| 8 | **I8_InvalidInteger** / 5131 | CME | Integer fields (`AnnualizedEarnings_*`, `PA_*`, and `SIN` after padding): numeric, whole number, no decimal/fraction/negative sign. | 4 integer fields + SIN | DI: "{1} is in an invalid number format. Please provide an integer value." / Portal: "The integer value is in an invalid number format. Please provide an integer value." |
| 9 | **I10_MultiplePersonEntries** / 910 | CME | Events does not support multiple lines per SIN: if the same (padded) SIN appears on > 1 data row, reject **every** such row. | SIN (all rows) | DI: "{1} appears multiple times in file. Please review data for each instance and only submit one instance of correct data." (1 = SIN, **masked** in our reports) / Portal: "This SIN appears multiple times in file. …" |
| 10 | **I32_Weeks_And_AnnualizedEarnings_Provided** / 4999 | CME | Reject if `Weeks_CurrentYear > 0 AND AnnualizedEarnings_CurrentYear > 0`, or the same for previous year. | CY/PY weeks, AE | DI: "Weeks and Annualized Earnings cannot both be greater than 0." / Portal: same (no period) |
| 11 | **I55_Zéro_Weeks_And_Zéro_LowContributions_Provided** / 9349 | CME | Reject if `Weeks_CurrentYear > 0 AND LowContributions_CurrentYear = 0`, or same for previous year. | CY/PY weeks, low | DI/Portal: "You have provided weeks for this member, please provide associated contributions." |
| 12 | **B187_NegativeValues_WeeksCurrentYear** / 9099 | CME | `Weeks_CurrentYear < 0`. | Weeks_CurrentYear | DI: "Negative value cannot be reported for {0}." (0 = field value) / Portal: "Negative value cannot be reported for Weeks Current Year." |
| 13 | **B187_NegativeValues_LowContributionsCurrentYear** / 4423 | CME | `LowContributions_CurrentYear < 0`. | LowContributions_CurrentYear | DI as above / Portal: "…for Low Contributions current year." |
| 14 | **B187_NegativeValues_HighContributionsCurrentYear** / 4869 | CME | `HighContributions_CurrentYear < 0`. | HighContributions_CurrentYear | Portal: "…for High Contributions current year." |
| 15 | **B187_NegativeValues_WeeksPreviousYear** / 7902 | CME | `Weeks_PreviousYear < 0`. | Weeks_PreviousYear | Portal: "…for Weeks previous year." |
| 16 | **B187_NegativeValues_LCPreviousYear** / 494 | CME | `LowContributions_PreviousYear < 0`. | LowContributions_PreviousYear | Portal: "…for Low Contributions previous year." |
| 17 | **B187_NegativeValues_LCPreviousYear (High)** / 5049 | CME | `HighContributions_PreviousYear < 0` (spec reuses the LC label; logic is High). Internal id `B187_HCPreviousYear`. | HighContributions_PreviousYear | Portal: "…for High Contributions previous year." |
| A1 | **I9_InvalidEnum** / 8034 — *adopted by extension* | CME | `EventType` not in {TERFIN, DECFIN, RETFIN}. Spec Section omits Events, but the layout declares EventType a Code field with a Table of Codes and the I50/I51 test matrix lists 8034 among format messages; without it an unknown code would silently fall through. Config-switchable; default ON (§18 Q4). | EventType | DI: "{1} is in an invalid code." / Portal: "The provided value is in an invalid code." |

Parsing note for L1: numeric parsing is attempted even when I3 fails so that a value like `12345.678` yields both 9519 and 6503 (legacy emits all applicable format messages per the test matrix).
#### 7.9.3 Level 2 — business rules (per record, require Ariel snapshot)

Shared helper functions referenced below (all in `src/lib/rules/lib/`):

- `CalculateAE(sin, employerId, year)` — spec "Function" block (B40/B41/B43/B44): if a `salaryRates` row with `type='REPORT'` and `Year(effectiveDate)=year` exists return its `rate`; else `Service = Σ service.amount (type CTSRV, indicator≠REGUL, Year(beginDate)=year)`; if 0 return 0; `Low = Σ RPPLOW (indicator≠REGUL, Year(beginDate)=year, summaryAttribute≠'RRETRO')`; `High = Σ RPPHGH+RCAHGH (same filters)`; `AE = (Low/lowRate + High/highRate) / (Service/52)`.
- `CalculateAEwithRetroPaid(...)` — B53a/B53b variant: same, but retro contributions (`summaryAttribute ∈ {RRETRO, FRETRO}`) are included by `Year(paymentDate)=year` instead of excluded.
- `CalculateAEwithRetro(...)` — B47 variant: no `RRETRO` exclusion at all.
- `carveOut(breaks, windowStart, windowEnd, types)` — the "IdentifiedBreaks" trim/merge algorithm from B184 (clip to window, de-overlap pairwise, sum `(end − start)` days). Days are exclusive of `end`.
- `expectedService(window, carveDays, rounding)` — `ROUNDUP/ROUNDDOWN((TotalDays − Carve)/TotalYear × 52, 2)`.
- `reportedService(year)` — `Σ CTSRV amounts in Ariel with Year(targetDate)=year (indicator≠REGUL where the rule says so) + FileDerived CTSRV for that year`.
- `ltdBreakIn(emp, from, to)` — any `serviceBreaks` row with `type='LTD'` overlapping `[from, to]`.
- `isPartTimeAnyDay(emp, year)` — `employmentTypeHistory` has `PT` effective at any day in the year.

| # | Rule / Message ID | Severity · Visibility | Logic summary (plain English) | File fields | Ariel data | Messages, params, overrides |
|---|---|---|---|---|---|---|
| 18 | **I42_FutureDate** / 8106 | CME · Public | Reject if (`TERFIN` and `EmploymentEndDate > ExecDate`) or (`DECFIN` and `DateOfDeath > ExecDate`). The spec omits RETFIN; by default we apply the same CME check to RETFIN's `EmploymentEndDate` (configurable — §18 Q5). | EventType, EmploymentEndDate, DateOfDeath | none (ExecDate) | DI/Portal: "Event date must be earlier than or equal to today's date." |
| 19 | **B2_RejectMemberCreation** / 1418 | CME · Public | The SIN must match a member who has an employment at the **reporting employer** (`Batch.employerId`). No member, or member with no employment at this employer ⇒ reject. (Runs first among L2; if it fires, the remaining L2 rules for that record are skipped because they all need `Emp`.) | SIN | members, employments | DI/Portal: "This SIN does not match any members at your organization. If this is a new enrolment, please complete the Enrolment for this member." |
| 20 | **B5_MemberNotEligibleForThisDataUpdate** / 5728 | CME · Public | Using the most recent employment `Emp` at the reporting employer: **RETFIN**: reject if `Emp.terminationCode ∈ {TER, DEC, AMA}`, or (`Emp.terminationCode = RET` and a CTSRV service row exists with `Year(targetDate) = Year(EmploymentEndDate)`). **TERFIN**: reject if `Emp.terminationDate ≠ null`. **DECFIN**: same as RETFIN (TER/DEC/AMA, or RET + CTSRV in event year). Concurrent members: only the reporting employer's employment is considered (spec "HOOPP Additional Info"). | EventType, EmploymentEndDate | employments (terminationDate, terminationCode), service | DI/Portal: "This member is not eligible for this type of data collection/revision." |
| 21 | **B19_Annualized_Earnings_Should_Not_Be_Reported** / 9815 | CME · Public | AE may only be reported when the member had a waived-contribution break (`WSO`). **CY**: `AE_CY > 0` and no `WSO` break with `startDate ≤ MAX(EventYear-01-01, Emp.permanencyDate)` and `endDate > EventDate` (open end counts as ∞) ⇒ reject. **PY**: `AE_PY > 0` and no `WSO` break with `startDate ≤ MAX((EventYear−1)-01-01, permanencyDate)` and `endDate > (EventYear−1)-12-31` ⇒ reject. Requires `Emp` = FileDerived.Employment (same employer). | AnnualizedEarnings_CY/PY, EventDate | employment.permanencyDate, serviceBreaks | DI/Portal: "Annualized earnings should not be reported for this member." |
| 22 | **B19b_Annualized_Earnings_Have_Not_Be_Reported** / 2955 | CME · Public | Inverse of B19. **CY**: `AE_CY` is 0/blank and a `WSO` break covers the CY window (same window as B19-CY) ⇒ reject. **PY**: `AE_PY` is 0/blank AND no Ariel salary-rate `REPORT` row with `Year(effectiveDate) = EventYear−1` AND `Year(permanencyDate) ≤ EventYear−1` AND a `WSO` break covers the PY window ⇒ reject. | AnnualizedEarnings_CY/PY | permanencyDate, serviceBreaks, salaryRates | DI: "Annualized earnings for {1} must be provided for this member." (1 = termination year, or termination year −1 for PY) / Portal: "Annualized earnings must be reported for this member." |
| 23 | **B22_MemberOnFreeAccrualEntireYearNoServiceRequired** / 5604 | CME · Public | Member on LTD (free accrual) for the whole reporting period must not report service/contributions/PA. Executed twice. **CY**: an `LTD` break with `startDate ≤ EventYear-01-01` and `endDate ≥ EventDate` (null end = open) AND (`Weeks_CY>0` or `Low_CY>0` or `High_CY>0` or `PA_CY>0`) ⇒ reject. **PY**: `LTD` break with `startDate ≤ (EventYear−1)-01-01` and `endDate ≥ EventDate − 1 year` AND (`Weeks_PY>0` or `Low_PY>0` or `High_PY>0`) ⇒ reject (PA deliberately excluded for PY per spec). | CY/PY weeks, low, high, PA_CY | serviceBreaks (LTD) | DI: "This member is on a health leave and receiving free accrual during the reporting period. If the member has returned to work and resumed contributions in {2}, please report the Leave End Date." (2 = EventYear or EventYear−1) / Portal: "…resumed contributions in reporting year, please report the Leave End Date." |
| 24 | **B31** / 7309 | CME · Public (override allowed) | Member enrolled in the last pay period: `Emp.permanencyDate ∈ [Dec 8, Dec 31] of Year(ExecDate)` AND `Weeks_CurrentYear = 0` ⇒ error unless overridden. (Spec severity is CME yet provides an override reason; we implement as **WARNING with mandatory override** — §18 Q6.) | Weeks_CurrentYear | permanencyDate | DI/Portal: "Zero weeks have been reported for this member. Please revise member data, or select a valid override reason to continue. If more information is required please contact HOOPP." Override: "The member enrolled in the last pay period of the reporting year and contributions will be reported in the next MDC reporting period." |
| 25 | **B33_Message** / 5001 | WARNING · Public | Lump-sum (contributory leave) contributions already exist for a part-time member. For each year scope: `isPartTimeAnyDay(Emp, Y)` AND (an Ariel contribution `RPPLOW` with `Year(targetDate)=Y` OR a CTSRV service row with `summaryAttribute ∈ {RCL, RPREYAD, RRETRO}` and `Year(targetDate)=Y`) ⇒ warn. `Y = EventYear` (CY) / `EventYear−1` (PY). *Spec text for CY's service clause says "termination year − 1"; treated as a typo and read as the termination year — §18 Q7.* | — | employmentTypeHistory, contributions, service | DI: "Lump Sum Contributions for {1} were previously reported for this member. Please verify that this service has been EXCLUDED. Select an override reason to continue." (1 = Y) / Portal: "Lump Sum Contributions were previously reported for this member. …" Override: "Reported service does not include service for contributory leave." |
| 26 | **B37_Message** / 3029 | CME · Public | Reported low contributions cannot exceed the maximum for the weeks reported (Final Data variant: file values only, Ariel values ignored). Per year scope with `Y`: `Calc = YMPE(Y) × lowRate × Weeks/52`; `MaxWeekly = YMPE(Y) × lowRate / 52`; `Tol = MaxWeekly × tolerance1Weeks (2)`; reject if `Low − Calc > Tol`. | Weeks_*, LowContributions_* | rate tables (MGA, LOWRATE) | DI: "Low Contributions for reporting year {1} cannot be greater than maximum amount of {2} for the weeks reported." (1 = Y, 2 = Calc + Tol) / Portal: "Low Contributions cannot be greater than maximum amount of weeks reported." |
| 27 | **B38_Message** / 480 | WARNING · Public | If high contributions are reported, low must not be below the calculated low less one week. Per year scope: `High > 0` AND `Low < Calc − MaxWeekly × 1` ⇒ warn (Calc/MaxWeekly as in B37). | Weeks_*, Low_*, High_* | rate tables | DI: "Low Contributions for reporting year {1} cannot be less than {2} based on the weeks reported. To continue, update the entry or select an override reason." (2 = Calc + Tol) / Portal: "Low Contributions cannot be less than weeks reported. To continue, update the entry or select an override reason." Overrides: 1. "Member's annualized earnings moved from less than to more than the YMPE." 2. "Member held more than one position with one rate of pay below the YMPE and one rate above the YMPE." |
| 28 | **B40_AEIncrease** / 1238 | WARNING · Public | AE jumped > 15 % year-over-year. For `V ∈ {EventYear, EventYear−1}`: `prev = CalculateAE(sin, emp, V−1)`; if `prev ≠ 0`: `cur = CalculateAE(sin, emp, V)` **computed over Ariel + FileDerived transactions**; if `cur > prev × 1.15` ⇒ warn once (ErrorYear = EventYear). | derived from CY/PY blocks | service, contributions, salaryRates, rate tables | DI: "The Annualized Earnings amount of ${0} is {1}% greater than the prior year's Annualized Earnings of ${2}. To continue, update the entry or select an override reason." (0 = cur, 1 = (cur−prev)/prev×100, 2 = prev) / Portal: "The Annualized Earnings amount for the reporting year is greater than the prior year's Annualized Earnings. …" Overrides: "The member received a promotion"; "The member was compensated for additional responsibilities"; "Job reclassification"; "Contract settlement"; "Step/range increase"; "Contract settlement and step increase"; "Other - please provide explanation" |
| 29 | **B41AEIncreaseHOOPP** / 6065 | INFORMATION · **Private** | Same as B40 with 50 % threshold; HOOPP-internal (Control Report only). | as B40 | as B40 | DI/Portal: "Verify Earnings increase greater than 50%." |
| 30 | **B43_AEDecrease** / 5613 | WARNING · Public | AE dropped by more than $2,500: same loop as B40; warn if `cur < prev − 2500`. | as B40 | as B40 | DI: "The Annualized Earnings amount of ${0} has decreased by ${1} from the prior year's Annualized Earnings of ${2}. To continue, update the entry or select an override reason." (1 = prev − cur) / Portal: "The Annualized Earnings amount has decreased from the prior year's Annualized Earnings. …" Overrides: "Job reclassification"; "Permanent reduction of full-time hours"; "Change to lower-paying position"; "The member held more than one position at different hourly rates"; "Retro paid is Laboratory Medicine Funding Framework Agreement (LMFFA) compensation or pensionable bonus"; "Other - Please provide explanation" |
| 31 | **B44_AEDecreaseHOOPP** / 1646 | INFORMATION · **Private** | Same as B43 with −$50,000. | as B40 | as B40 | DI/Portal: "Verify Earnings decrease greater than $50000" |
| 32 | **B47_AEAmount** / 2990 | WARNING · Public | Sanity-check AE magnitude when there is no earlier AE history. `CalcYear = Year(permanencyDate)`; while `CalcYear < EventYear − 1`: if `CalculateAEwithRetro(…, CalcYear) > 0` exit (no finding); `CalcYear++`. Then `AE = CalculateAEwithRetro(…, EventYear)` incl. FileDerived; warn if `AE > 120,000` or `AE < 20,000` (and AE > 0). | derived | service, contributions, salaryRates | DI: "Please verify that the Annualized Earnings amount of ${0} for {1} is correct." (0 = AE, 1 = EventYear) / Portal: "Please verify that the Annualized Earnings amount for the reporting year is correct." Override: "The reported annualized earnings are correct." |
| 33 | **B53a_ReportedPAAmendedPANotWithinAcceptableToleranceCalculatedPANonLTD** / **2160** (Events) | CME · Public | Non-LTD member's PA must be within ±250 of HOOPP's calculated PA. Per year scope `Y` (CY uses `PA_CY`; PY only when `PA_PY` provided): skip if `ltdBreakIn(Emp, Y)`; `svc = (Weeks_file + Σ Ariel CTSRV weeks for Y, indicator≠REGUL) / 52`; `AE = CalculateAEwithRetroPaid(…, Y)` (incl. file); `CalcPA = MIN(PAMAXDB(Y) × svc, (MAX(0, AE − YMPE) × 0.02 × svc + MIN(AE, YMPE) × 0.015 × svc) × 9 − Offset(Y) × svc)`; reject if `|CalcPA − PA| ≥ 250` (spec: `≤ −250 OR ≥ +250`). PA = 0 with zero weeks/contribs is not evaluated (nothing to compare). | Weeks_*, Low_*, High_*, AE_*, PA_* | serviceBreaks, service, contributions, salaryRates, rate tables (PAMAXDB, MGA, REDFE) | DI: "The {2} for {3} is incorrect based on the data provided. The HOOPP calculated value is {4}." (2 = "PA", 3 = Y, 4 = CalcPA rounded) / Portal: "Reported PA not in line." |
| 34 | **B53b_ReportedPAAmendedPANotWithinAcceptableToleranceCalculatedPALTD** / **7375** (Events) · **8795** (Events_LTD) | CME · Public | LTD (free-accrual) member's PA must equal the calculated PA exactly (tolerance 0). Applies when `ltdBreakIn(Emp, Y)`. AE depends on the LTD situation: (1) LTD starts mid-year, not Jan 1, runs past year end, no FARATE ⇒ AE from contributions; (2) LTD covers the whole year (or mid-year start with FARATE) ⇒ `FARATE` salary rate; (3) LTD ends within the year ⇒ `MAX(AE_contrib, Blended)` where `Blended = AE_contrib × cs/(cs+fa) + FARATE × fa/(cs+fa)`. `fa` (free-accrual service) = provided FASRV transaction for years < 2017, else `ACW × daysOnLTD(Y)` capped at 35 yrs total service and at `MIN(terminationDate, DOB+65y)`. `svc = cs + fa`. If AE resolves to 0, iterate prior years back to permanency. Reject if `CalcPA ≠ PA`. **ID 8795 is used when the LTD situation requires FA/ACW data (situations 2–3); 7375 otherwise** (§18 Q8). ACW factor computation per Chapter 2 §4.2C is out of scope: v1 reads a stored `ACW` service transaction and flags the finding `calculated.acwSource='stored'`. | as B53a | + salaryRates FARATE, service FASRV/ACW, DOB | DI: "The {2} for {3} with disability service is incorrect based on the data provided. The HOOPP calculated value is {4}." / Portal: "Reported PA with disability service not in line." |
| 35 | **B109_EventDate_Before_PermanencyDate** / 7476 | CME · Public | `EmploymentEndDate < Emp.permanencyDate` ⇒ reject. For DECFIN compare `DateOfDeath` when present. | EmploymentEndDate / DateOfDeath | permanencyDate | DI/Portal: "Event date must be after the member's Enrolment Date." |
| 36 | **B112_RetirementNotice_Before_TERFIN** / **1616** (TERFIN) · **8112** (DECFIN) | CME · Public | A retirement was initiated (`Emp.otherInformation` matches `/^RetNotice \d{4}-\d{2}-\d{2}$/`) but the employer submits TERFIN or DECFIN ⇒ reject. | EventType | employment.otherInformation | DI/Portal: "A retirement has been initiated for this member. To report final data for this member, please select \"Retirement\". To report a {1/2} for this member, please contact HOOPP." (1 = "Termination", 2 = "Death") |
| 37 | **B113_NoRetirementNotice_Before_RETFIN** / 9075 | CME · Public | `EventType = RETFIN` and `Emp.otherInformation` does **not** match the RetNotice pattern ⇒ reject. | EventType | employment.otherInformation | DI/Portal: "A Notice of Retirement must be completed for this member before submitting final data." |
| 38 | **B139_EmploymentEndDateSameAsInitiallyReported** / 2492 | WARNING · Public | `RETFIN` and `Emp.terminationCode = RET` and `EmploymentEndDate ≠ Emp.terminationDate` ⇒ warn. When overridden, the derivation adds a **calculation indicator** item "Change in Employment End Date for Retirement" (§8.6). | EventType, EmploymentEndDate | employment.terminationDate/terminationCode | DI: "The Employment End Date for this retirement was previously reported as {0}. If the Employment End Date has changed, please provide an override reason." (0 = Ariel terminationDate) / Portal: "The Employment End Date provided for this retirement is different than was previously reported." Override: "Yes, Employment End Date has changed from originally reported value." |
| 39 | **B181_RetroPaid** / 6700 | CME · Public — **disabled by default** (HOOPP disabled it from R14; config `enabled.B181`) | Retro contributions were paid in the event year but the employer reports a PA with zero service/contributions: any Ariel contribution with `indicator = RETRO` and `Year(paymentDate) = EventYear` AND `PA_CY ≠ 0 AND Weeks_CY = 0 AND Low_CY = 0 AND High_CY = 0` ⇒ reject. | CY block | contributions | DI: "Retro Contributions have been previously reported as paid in {0} and no service or contributions have been reported for {0}. Please report a PA of 0.00 and HOOPP will contact you with the corrected PA for {0}." (0 = EventYear) / Portal: same wording with "Reporting Year" |
| 40 | **B182_RetroPaid** / 9810 | INFORMATION · **Private** | Same condition as B181, informational for HOOPP (always enabled). | CY block | contributions | same texts as B181 |
| 41 | **B184a_ExcessServiceEnrolledFullYear** / 66 | CME · Public | Full-year member cannot report more weeks than possible. Per `Y` ∈ {EventYear, EventYear−1}: applies if `permanencyDate ≤ Y-01-01` AND (`EventDate` null or `≥ Y-12-31`) — i.e., in practice the **PY** scope for in-year events, CY when the event is Dec 31. `RS = reportedService(Y)`; carve-out types `{LTD, NCM, NCU, WSN, WSO, PTW, NCD}` over `[Y-01-01, (Y+1)-01-01)`; `ES = ROUNDUP((TotalDays − Carve)/TotalDays × 52, 2)`; reject if `RS > ES + 0`. | Weeks_* | permanencyDate, service, serviceBreaks | DI: "Active full year: Total Weeks reported for {2} plus weeks previously reported exceed the {3} maximum possible weeks." (2 = Y, 3 = ES) / Portal: "Active full year: Total Weeks reported for the reporting year plus weeks previously reported exceed the maximum possible weeks." Auto-correct hint: `{3} − Ariel CTSRV(Y)` stored in `calculated.suggestedWeeks` |
| 42 | **B184b_ExcessServiceEnrolledMidYear** / 3002 | CME · Public | Mid-year enrolment: applies if `permanencyDate > Y-01-01`. `YearStart = MAX(Y-01-01, permanencyDate)`, `YearEnd = MIN(Y-12-31, Emp.terminationDate ?? EventDate)`; breaks clipped to `[permanencyDate, MIN(terminationDate, (Y+1)-01-01))`; `TotalYear = days in Y`; `TotalDays = (YearEnd − YearStart + 1) − Carve`; `ES = ROUNDUP(TotalDays/TotalYear × 52, 2)`; reject if `RS > ES`. | Weeks_* | as B184a | DI: "In-year enrolment: Total Weeks reported for {2} plus weeks previously reported exceed the {3} maximum possible weeks." / Portal: "In-year enrolment: …exceed the maximum possible weeks." |
| 43 | **B184c_Excess ServiceTerminatedMidYear** / 7854 | CME · Public | Mid-year termination (Events only): applies if `permanencyDate ≤ Y-01-01` AND `Y-01-01 < EventDate < Y-12-31`. Window `[Y-01-01, EventDate]`; `TotalDays = (EventDate − Y-01-01 + 1) − Carve`; `ES = ROUNDUP(TotalDays/TotalYear × 52, 2)`; reject if `RS > ES + 3`. | Weeks_* | as B184a | DI: "In-year termination: Total Weeks reported for {2} plus weeks previously reported exceed the {3} maximum possible weeks." / Portal: "In-year termination: …" |
| 44 | **B185_Message** / 3506 | CME · Public | Service shortfall within 1 week of the full-year expectation must be rolled up. Applies if `permanencyDate < Y-01-01` AND (`EventDate` null or `≥ Y-12-31`). Carve-out types `{PAR, LTD, NCH, NCF, NCP, NCS, NCR, NCE, NCO, NCU, NCM, WSN, WSO, PTW, NCD}`; `ES = ROUNDDOWN(…, 2)`; `RS` includes REGUL; reject if `ES − 1 ≤ RS < ES`. | Weeks_* | as B184a | DI: "The Weeks reported for {2} should be adjusted to {3}. Contributions may not need to be adjusted if reported correctly." / Portal: "The Weeks reported for Reporting Year should be adjusted to Minimum Possible Service. …" Auto-correct hint as B184a |
| 45 | **B186a_Message** / 573 | CME · Public | Full-year shortfall beyond tolerance. Spec sets `ValidationYear = Year(ExecDate)`; for Events we evaluate `Y ∈ {EventYear, EventYear−1}` where the full-year condition holds (`permanencyDate ≤ Y-01-01` and event not before Y-12-31) — §18 Q10. `ES = ROUNDDOWN(…)` with the B185 break list; Events minimum = `ES − 1`; reject if `RS < ES − 1`. | Weeks_* | as B184a | DI: "Total weeks reported for {2} plus weeks previously reported are less than minimum weeks that should be reported. Please review the member's record for unreported leaves or status changes." (2 = Y) / Portal: same with "Reporting Year" |
| 46 | **B186b_Message** / 3466 | CME · Public | Mid-year-enrolment shortfall: `permanencyDate > Y-01-01` and event not before Y-12-31; window as B184b; `ES = ROUNDDOWN`; Events minimum = `ES − 3.42`; reject if `RS < ES − 3.42`. | Weeks_* | as B184a | same texts as B186a |
| 47 | **B186c_Shortfall** / 9829 | CME · Public | Mid-year-termination shortfall (Events only): `permanencyDate ≤ Y-01-01` and `Y-01-01 < EventDate < Y-12-31`; window `[Y-01-01, EventDate]`; `ES = ROUNDDOWN`; reject if `RS < 0.65 × ES`. | Weeks_* | as B184a | same texts as B186a |
| 48 | **B192a_DuplicateMDCdataReceivedinEventsFile** / 405 | CME · Public | MDC data for a year already loaded must not be re-reported. **PY**: any of `Weeks_PY, Low_PY, High_PY, PA_PY, AE_PY > 0` AND an Ariel CTSRV service row with `summaryAttribute = 'MDC – Core Data'` and `Year(targetDate) = EventYear−1` ⇒ reject. **CY**: same with CY fields and `Year(targetDate) = EventYear`. | both blocks | service (summaryAttribute) | DI: "Data for {0} has already been reported. Please remove this data to continue. If you need to adjust what was previously reported please contact HOOPP." (0 = the year) / Portal: "Data has already been reported. …" |
| 49 | **B192b_ReportingNoDataForPreviousYearEventsAndMDC-1WasNeverReceived** / 7166 | CME · Public | Previous-year data is required when last year's MDC was never received: `Year(permanencyDate) < EventYear` AND (`Weeks_PY` blank OR `Low_PY` blank OR `PA_PY` blank) AND no Ariel CTSRV with `summaryAttribute='MDC – Core Data'` and `Year(targetDate) = EventYear−1` ⇒ reject. (Blank ≠ 0: reporting zeros satisfies the rule.) | PY block | permanencyDate, service | DI: "Previous Year data for {0} is required. If no contributions were made for {0}, please report zero weeks and contributions." (0 = EventYear−1) / Portal: "Previous Year data is required." |
| 50 | **B202_PersonValidateUnicityOfAddress** / 6908 | CME · Public | Standard module rule: fires if the import would create an Address with the same effective start date as an existing one. **Events never creates addresses** (Death Contact fields are GUI/CRM only), so this rule can only fire if the Ariel snapshot already has ≥ 2 addresses with identical `effectiveStartDate` (data-quality guard). | — | addresses | DI/Portal: "An address update has already been made for this member today. Please contact HOOPP for more information." |
| 51 | **B203_StatusDateAndStatusCode** / 619 | CME · Public | Membership status integrity: (status not null and effective date null) or (status null and date not null) in the current Ariel membership **or in the FileDerived MembershipStatus item** ⇒ reject. | — (derived D-NCT item) | membership | DI/Portal: "There is an issue regarding the membership status for this member. Please contact HOOPP for more information." |
| 52 | **B204_PersonMatchingEntityInstance** / 6279 | CME · Public | `findMembersBySin(sin).length ≥ 2` ⇒ reject (duplicate SIN in Ariel). | SIN | members | DI/Portal: "Duplicate SIN. Please contact HOOPP for more information." |
| 53 | **B205_SubStatusDateAndSubStatusCode** / 1070 | CME · Public | Same as B203 for sub-status/sub-status date. | — | membership | DI/Portal: "There is an issue regarding the membership sub-status for this member. Please contact HOOPP for more information." |
| 54 | **B206_UnicityStatusDeleteEffectiveDate** / 619 (same ID as B203 in spec) | CME · Public | The derived membership status `D/NCT` (TERFIN/DECFIN closing the last open employment) would have `effectiveDate = EventDate`; if `membership.statusHistory` already contains an entry with that effective date ⇒ reject. | EventType, EventDate | membership.statusHistory | DI/Portal: "There is an issue regarding the membership status effective date for this member. Please contact HOOPP for more information." |
| 55 | **B207_DuplicatePensionAdjustment** / 2153 | CME · Public | A PA for the same employer, same `calculationYear` and same `entryDate = ExecDate` already exists in Ariel ⇒ reject (per year scope where `PA_*` is non-null). | PA_CY, PA_PY | pensionAdjustments | DI/Portal: "A pension adjustment update has already been made for this member today. Please contact HOOPP for more information." |
| 56 | **B214** / 6012 | WARNING · Public | Part-time member with a non-contributory leave; reported weeks spill into the leave. Per `Y`: `isPartTimeAnyDay(Emp, Y)` AND a non-contributory leave (`NCE, NCF, NCP, NCS, NCR, NCO, NCH`) of ≥ 5 days within Y AND `Weeks_Y > WCP + 0.14` where `WCP = ROUNDDOWN((days(Begin,End) − carve)/days(Begin,End) × 52, 2)`, `Begin = MAX(Y-01-01, permanencyDate)`, `End = EmploymentEndDate+1` (TERFIN/RETFIN, CY) / `DateOfDeath` (DECFIN, CY) / `(Y+1)-01-01` (PY); carve types `{NCE, NCF, NCP, NCS, NCM, NCD, NCO, NCU, NCR, NCH, WSN, WSO, LTD, PTW}` plus `{CRH, CRE, CRF, CRP, CRS, CRM, CRO, CRR}` not reported in this collect (always true for Events v1). | Weeks_*, EventDate | employmentTypeHistory, serviceBreaks, permanencyDate | DI: "This member is part-time with a leave on file for which a contributory leave applies. Please complete the contributory leave information for {1} or select an override reason." (1 = Y) / Portal: "…for this member or select an override reason." Overrides: "Contributory leave data reported."; "Member did not contribute for this leave within the reporting period." |
| 57 | **B223_NHH_MEMBER** / 2953 | CME · Public | Non-HOOPP-Hospital merger guard: `Batch.employerId ∈ nhhEmployers` AND `membership.calculationIndicators ∩ {NHHSIS, NHHSTJ, NHHPRO, NHHSTM, NHHGR} ≠ ∅` AND any **FileDerived** service or contribution item (CY or PY) has `targetDate < MergerEffectiveDate(indicator)` ⇒ reject. Merger dates from config (§7.7). | derived targets | membership.calculationIndicators | DI/Portal: "This event cannot be submitted via HOOPP Insight. Please contact HOOPP for assistance." |
| 58 | **B224_** / 3001 | CME · Public | Member has two concurrent **active** (`terminationDate = null`) employments at the same employer overlapping in time ⇒ reject (data-quality guard; Events cannot resolve which to terminate). | — | employments | DI/Portal: "Member is already enrolled with HOOPP at your organization." |

#### 7.9.4 Registry order (deterministic)

L0: I50, I51. L1: I2, I1, I9*, I5, I8, I7, I3, B187×6, I10, I32, I55. L2: B2, B204, B224, B5, B223, B109, I42, B112, B113, B139, B192a, B192b, B22, B19, B19b, B31, B33, B37, B38, B184a, B184b, B184c, B185, B186a, B186b, B186c, B53a, B53b, B181, B182, B40, B41, B43, B44, B47, B214, B207, B203, B205, B206, B202.

#### 7.9.5 Rules summary counts

| Level | Count | Of which CME | WARNING | INFORMATION | FILE_ERROR |
|---|---|---|---|---|---|
| L0 | 2 | 0 | 0 | 0 | 2 |
| L1 | 15 (+1 adopted) | 15 (+1) | 0 | 0 | 0 |
| L2 | 41 | 31 | 7 (B31†, B33, B38, B40, B43, B47, B139, B214 → 8 with B31) | 3 (B41, B44, B182) | 0 |
| **Total** | **58 (+1)** | | | | |

† B31 is CME in the spec with an override reason; implemented as WARNING-with-mandatory-override (§18 Q6). Counting it as a warning gives 8 warnings and 30 CMEs at L2.

#### 7.9.6 Reviewed and excluded (Section text mentions Events/Final Data, but not applicable to the Events CSV)

| Rule / ID | Section text | Why excluded |
|---|---|---|
| B153_Message / 1913 | "Contributions Events" | Logic uses `RetroYear` and "Annualized Retro Amount" — Retro-file fields that do not exist in the Events layout. Flagged in §18 Q11. |
| B196_EventsFileShouldBeProvidedInFinalDataCollect / 5194 | NCL, CL, Retro, Close Leaves | Validates *other* files in a Final Data collect against the Events file; the Events file is the reference, not the subject. |
| B57 / 8353·1758, B125 / 2838, B176 / 7777, I45 / 9092 | "Contributory Leaves (… Final Data)" | Apply to leave fields in leave files submitted during the Final Data collect; Events layout v3.0+ carries no leave fields. |
| B161, B163, B164 (Event-Death) | Enrolment, Event-Death | Marked `(Removed)` in v15.1. |
| B3_SocialNumberNotValid / 5628 | Enrolments, MBI | Not scoped to Events; available behind `enabled.B3` (default off) as an optional extension — §18 Q4. |

---
## 8. Ariel derivation logic

Module `src/lib/derivation/` turns one **accepted** `EventsRecord` + its Ariel snapshot into an ordered list of `ArielUpdateItem`s. The same module runs in **provisional** mode before L2 (producing `FileDerived` — the would-be service/contribution/status items that rules such as B19, B184, B223, B203/B206 inspect) and in **final** mode after validation. Both modes are pure functions of `(record, snapshot, executionDate, rates)`.

### 8.1 Common inputs and derived dates

```
Emp            = most recent employment at Batch.employerId (by permanencyDate)
EventDate      = TERFIN/RETFIN: EmploymentEndDate ; DECFIN: DateOfDeath (CSV fallback: EmploymentEndDate, §18 Q1)
EventYear      = Year(EventDate)
ExecDate       = Batch.executionDate
CY.Begin       = MAX(EventYear-01-01, Emp.permanencyDate)
CY.End         = EventDate
PY.Begin       = MAX((EventYear-1)-01-01, Emp.permanencyDate)
PY.End         = (EventYear-1)-12-31
PaymentDate/TargetDate (CY) = EventDate ; (PY) = (EventYear-1)-12-31
DeclarationDate (CY) = EventDate ; (PY) = (EventYear-1)-12-31        -- "Ariel.ContributionPeriodEndDate"
NumberOfPays   = Year(collect start date) = EventYear (CY) / EventYear-1 (PY)  -- informational only; Ariel stopped populating as of R14, we still emit it in `fields` for traceability
SummaryAttr    = "Final Data - Events"
isLastOpenEmployment = every other employment of the member (any employer) has terminationDate ≠ null
```

PY items are produced only when the corresponding PY field is non-null. A field value of `0` **is** loaded (layout: "We load a 0 value if this is what is reported"; PA "values of 0 will be recorded as of R13") — except `Weeks = 0` which creates no CTSRV item (Default Values: "For File.Weeks non null nor zero").

### 8.2 Employment record (all event types)

| derivationRule | Operation | Fields | Notes |
|---|---|---|---|
| `D-EMP-TERMDATE` | UPDATE Employment(Emp) | `terminationDate = EventDate` | TERFIN/RETFIN: EmploymentEndDate. DECFIN: DateOfDeath (layout maps Date Of Death → Member.DateOfDeath **and** Employment.TerminationDate) |
| `D-EMP-TERMCODE` | UPDATE Employment(Emp) | `terminationCode = "TER"` (TERFIN) / `"DEC"` (DECFIN) | RETFIN: unchanged (already `RET` from Retirement Notice); if B139 overridden, `terminationDate` is still updated |
| `D-EMP-OTHERINFO` | UPDATE Employment(Emp) | `otherInformation = "Events " + EmploymentEndDate(MMDDYYYY)` | Layout: "Value of Other Information field should be set to 'Events' + Employment End Date". Applies to TERFIN/RETFIN (field used for those types); for DECFIN we emit it with DateOfDeath — §18 Q12 |
| `D-EMP-TERMDATAUPDATE` | UPDATE Employment(Emp) | `terminationDataUpdate = ExecDate` | Default Values: set with every Events load |
| `D-MBR-DOD` | UPDATE Member | `dateOfDeath = DateOfDeath` | DECFIN only |

### 8.3 Membership status D-NCT (TERFIN, DECFIN)

If `EventType ∈ {TERFIN, DECFIN}` **and** `isLastOpenEmployment`:

| derivationRule | Operation | Fields |
|---|---|---|
| `D-MSTAT-DNCT` | CREATE MembershipStatus | `statusCode = "D"` (Deferred Pensioner), `statusEffectiveDate = EventDate`, `subStatusCode = "NCT"` (Not Completed Termination), `subStatusEffectiveDate = EventDate` |

`EventDate` here is "the Termination Date of the employment with the most recent termination date" — after applying this file that is `EventDate` unless another employment of the member has a later termination date, in which case that later date is used. Not emitted for RETFIN (status is handled by the retirement process). Concurrent member with another open employment ⇒ no status item (member stays `A`).

### 8.4 Calculations/Benefit record (TERFIN, DECFIN)

If `EventType ∈ {TERFIN, DECFIN}` **and** `isLastOpenEmployment` (layout: "a preliminary calculation request will be generated when the last open employment is being terminated"):

| derivationRule | Operation | Fields |
|---|---|---|
| `D-CALC-REQUEST` | CREATE CalculationsBenefit | `eventCategory = "Termination"` (TERFIN) / `"Death Before Retirement"` (DECFIN); `eventDate = EventDate` (most recent termination date, as §8.3); `finalCalculation = false`; `clientRequestDate = ExecDate`; `estimate = false` |

RETFIN never creates a calculation request.

### 8.5 RETFIN benefit re-evaluation flag

| derivationRule | Condition | Operation / Fields |
|---|---|---|
| `D-RET-REEVAL-ON` | `RETFIN` and `membership.status = "P"` (Pensioner) | SET_FLAG BenefitReevaluationFlag `{ active: true, reason: "RETFIN financial data loaded" }` |
| `D-RET-REEVAL-NONE` | `RETFIN` and `status = "D"` and `subStatus = "NCT"` | **no item**; an INFORMATION finding (`rule: INFO-RET-DNCT`, message "Benefit re-evaluation flag not activated: member is D-NCT") is written for traceability |
| otherwise (`A`, retirement pending) | `RETFIN` and status `A` | no flag; financial data loads normally |

### 8.6 B139 change-of-retirement-date indicator

If B139 fired and was overridden: `D-CALC-INDICATOR` CREATE CalculationIndicator `{ code: "CHG_RET_EED", description: "Change in Employment End Date for Retirement scenario", previousDate: Emp.terminationDate, newDate: EmploymentEndDate }` (spec: "a Calculation Indicator should be created"; code value is ours — §18 Q13).

### 8.7 Transactions/Service — CTSRV

For each scope `S ∈ {CY, PY}` where `Weeks_S` is non-null **and ≠ 0**:

| derivationRule | Operation | Fields |
|---|---|---|
| `D-SRV-CTSRV-<S>` | UPSERT_ADD TransactionsService | `type = "CTSRV"`, `amount = Weeks_S`, `beginDate = S.Begin`, `endDate = S.End`, `paymentDate = S.Payment`, `targetDate = S.Target`, `declarationDate = S.Declaration`, `transactionIndicator = "PRV"`, `numberOfPays = S.Year`, `summaryAttributes = "Final Data - Events"` |

`targetKey = {type, indicator, summaryAttributes, beginDate, endDate, paymentDate, targetDate}`. If an Ariel row with the same key exists, `operation = UPSERT_ADD` with `before.amount` and `fields.amount = before + file` ("Value added to the values already stored … otherwise it will create an additional transaction").

### 8.8 Transactions/Contributions

Rates and sums below are per scope `S` with `Y = S.Year`; "Ariel Σ… (Y)" means Ariel contribution rows of the matched employment where `Year(paymentDate) = Y` (R16 change: year of **payment date**, not target year). `PA_S` fallback (full layout "Attention" note, resolved — §18 Q14): when `File.PA_S = 0.00`, use Ariel PA for year Y; **if there is no PA in Ariel for that year either, no RPPHGH/RCAHGH CLC items are produced at all** (the CLC split is only loaded/calculated when a High RPP and a PA are both present for the year being calculated). A 0 value is loaded if that is what is reported and/or calculated.

**Provided (PRV) items** — always created when the file field is non-null:

| derivationRule | Fields |
|---|---|
| `D-CONTRIB-RPPLOW-PRV-<S>` | `type="RPPLOW"`, `indicator="PRV"`, `amount = LowContributions_S` (UPSERT_ADD onto Ariel RPPLOW/PRV with same key ⇒ `before + file`) |
| `D-CONTRIB-RPPHGH-PRV-<S>` | `type="RPPHGH"`, `indicator="PRV"`, `amount = HighContributions_S` (only when non-null; UPSERT_ADD) |

Common fields: `beginDate = S.Begin`, `endDate = S.End`, `paymentDate = S.Payment`, `targetDate = S.Target`, `declarationDate = S.Declaration`, `numberOfPays = Y`, `summaryAttributes = "Final Data - Events"`.

**Calculated (CLC) RPP/RCA split** — created only when `HighContributions_S` is non-null **and** an effective PA exists for year Y (file PA, else Ariel PA); otherwise skipped entirely:

```
Pool(Y)   = Σ Ariel.RPPLOW[PRV](Y) + Σ Ariel.RPPHGH[PRV](Y)
          + Σ Ariel.LowRetro(Y) + Σ Ariel.HighRetro(Y)        -- indicator RETRO rows, by Year(paymentDate)
          + File.LowContributions_S + File.HighContributions_S
Limit(Y)  = 1000 + 0.7 × PA_eff                                -- PA_eff = File.PA_S if ≠ 0, else Ariel.PA(Y); if neither exists → skip CLC
Excess(Y) = MAX(0, Pool(Y) − Limit(Y))
PriorCLC  = Σ Ariel.RPPHGH[CLC](Y)                             -- already-posted calculated split (signed; stored negative)

RPPHGH_CLC_amount = −Excess(Y) − PriorCLC        -- i.e. −[MAX(0, …)] − Σ RPPHighCLC(Y)
RCAHGH_CLC_amount = +Excess(Y) − PriorCLC        -- mirror into RCA
```

| derivationRule | Fields |
|---|---|
| `D-CONTRIB-RPPHGH-CLC-<S>` | `type="RPPHGH"`, `indicator="CLC"`, `amount = RPPHGH_CLC_amount` (dates as PRV items) — omitted when amount = 0 and no prior CLC exists |
| `D-CONTRIB-RCAHGH-CLC-<S>` | `type="RCAHGH"`, `indicator="CLC"`, `amount = RCAHGH_CLC_amount` — same omission rule |

Reading of the spec formula: the RPP calculated transaction is the **negative** of the excess over the RPP limit (so RPP high nets down) and the RCA transaction is the positive excess; subtracting the already-posted `Σ RPPHighCLC` makes the operation idempotent across re-loads. The `explanation` string on each item shows every term with numbers (e.g. `-(MAX(0, 1 200.00 + 800.00 + 0 + 0 + 523.64 + 321.23 − (1000 + 0.7×12594)) ) − (−150.00)`). Worked examples are mandatory golden tests (§15.4). Whether the spec intends the posted sign convention literally (`−[…]` for RPP) is **§18 Q15** — the derivation is isolated in `contributionSplit.ts` so a sign flip is a one-line change.

### 8.9 Transactions/Salary Rates (Annualized Earnings)

For each `S` where `AnnualizedEarnings_S` is non-null and > 0:

| derivationRule | Operation | Fields |
|---|---|---|
| `D-SALRATE-<S>` | CREATE TransactionsSalaryRates | `salaryRateType = "REPORT"`, `rate = AnnualizedEarnings_S`, `effectiveDate = S.Begin` (MAX(Jan 1 of year, permanencyDate)), `entryDate = ExecDate`, `transactionIndicator = "Provided"`, `numberOfPays = Y`, `summaryAttributes = "Final Data - Events"` |

### 8.10 Plans/Tax Info/PA

For each `S` where `PA_S` is non-null (0 is recorded):

| derivationRule | Operation | Fields |
|---|---|---|
| `D-PA-<S>` | CREATE PlansTaxInfoPA | `pensionAdjustment = PA_S`, `calculationYear = Y` (Default Values says "31st December of the prior year" for PY — i.e. year `EventYear−1`), `inputDate = ExecDate`, `employerId = Batch.employerId` |

B207 guards duplicate `(employer, calculationYear, entryDate)`.

### 8.11 Service-break closure and deletion

For every `serviceBreak` of `Emp`:

```
closeDate = EventDate + 1 day            -- EmploymentEndDate+1 (TERFIN/RETFIN) or DateOfDeath+1 (DECFIN)
if EventType == TERFIN and break.type ∈ {DTO, DTP, DPR, DMA, DMB, DMS}: leave untouched (Special Cases sheet)
else if break.startDate > EventDate:      DELETE   (derivationRule D-BRK-DELETE)   -- "Breaks with a start date after the EmploymentEndDate will be deleted"
else if break.endDate is null or break.endDate > closeDate:  CLOSE  (D-BRK-CLOSE) fields { endDate: closeDate }, before { endDate }
else: no item (already closed on/before closeDate)
```

The disability-break exemption is stated only for `TERMFIN` (= TERFIN) in the spec; for DECFIN/RETFIN disability breaks are closed like any other (§18 Q16).

### 8.12 Beneficiaries / Death Contact

The Default Values sheet lists `Plans/Designations/Beneficiaries` (Type = "Primary", Other Name = "Death Contact info from Event"), but revision 8.0 removed the mapping of Death Contact fields to Ariel and the CSV layout excludes those fields. **No beneficiary items in v1.** Documented so the UX team does not expect them.

### 8.13 Item ordering and `targetKey` conventions

Items per member are emitted in this order (stable `sort_order`): Employment → Member DOD → ServiceBreak CLOSE/DELETE → Service → Contributions (RPPLOW PRV, RPPHGH PRV, RPPHGH CLC, RCAHGH CLC; CY before PY) → SalaryRates → PA → MembershipStatus → CalculationsBenefit → CalculationIndicator → BenefitReevaluationFlag. `targetKey` always contains `employmentId` (Ariel id from the snapshot) plus the record-type natural key; `before` is `null` for CREATE and the snapshot values for UPDATE/UPSERT_ADD/CLOSE/DELETE.

---

## 9. Ledger design

### 9.1 Streams

- `member:<sinPseudo>` — one per member; carries validation outcomes, overrides, proposed updates, exports and corrections for that member.
- `batch:<batchId>` — batch lifecycle (received, parsed, file rejected, update set built/approved/rejected/exported).
- `system` — config changes, chain anchors, adapter swaps.

Every entry is in exactly one stream **and** in the global chain.

### 9.2 Hashing recipe (byte-exact)

```
payloadBytes   = UTF-8( JCS(payload) )                       // RFC 8785 canonical JSON; payload MUST NOT contain raw SIN
payloadHash    = SHA256(payloadBytes)                          // hex lowercase
headerString   = JCS({
                   v: 1,
                   seq, entryId, streamId, streamSeq, eventType,
                   batchId,                 // null allowed
                   actor, occurredAt,       // occurredAt: RFC 3339 UTC with millisecond precision, "Z" suffix
                   payloadHash, prevHashGlobal, prevHashStream
                 })
entryHash      = SHA256( UTF-8(headerString) )
genesis        prevHashGlobal = prevHashStream = "0" × 64
```

Rules: numbers in payloads are JSON numbers only when they are integers that fit in 2^53; **all money/weeks are strings** (`"523.64"`); dates are `YYYY-MM-DD` strings; no `undefined` (omit the key); arrays keep insertion order and are sorted by the producer where order is not semantic (e.g., findings sorted by `(ruleId, field, yearScope)`).

### 9.3 Append procedure (single transaction)

```ts
async function append(tx, draft: { streamId; eventType; batchId; actor; payload }): Promise<LedgerEntry> {
  const g = await tx.select().from(ledgerHeads).where(eq(streamId,'__global__')).for('update');
  const s = await tx.select().from(ledgerHeads).where(eq(streamId, draft.streamId)).for('update'); // may be absent
  const seq = g.lastSeq + 1, streamSeq = (s?.lastSeq ?? 0) + 1;
  const payloadHash = sha256(jcs(draft.payload));
  const entry = { seq, entryId: uuidv7(), streamSeq, occurredAt: clock.nowIso(), payloadHash,
                  prevHashGlobal: g.lastHash, prevHashStream: s?.lastHash ?? ZERO64, ...draft };
  entry.entryHash = sha256(jcs(header(entry)));
  await tx.insert(ledgerEntries).values(entry);        // DB trigger re-verifies heads and advances them
  return entry;
}
```

Concurrency: the `FOR UPDATE` on `__global__` serialises appends (throughput target ≥ 500 entries/s locally, sufficient: a 5,000-row batch produces ≈ 10,000 entries). Appends for a batch are grouped in chunks of 500 per transaction to amortise round-trips while keeping the global lock short.

### 9.4 Verification algorithm

`verifyLedger({ from?: seq, to?: seq, streamId? })`:

1. Stream entries ordered by `seq` (or `stream_seq`); keep `expectedPrevGlobal` (start: hash of entry `from−1`, or ZERO64) and a map `expectedPrevStream[streamId]` (seeded from the last entry before `from` in each stream).
2. For each entry: recompute `payloadHash` from `payload`, recompute `entryHash` from the header; check `prevHashGlobal == expectedPrevGlobal`, `prevHashStream == expectedPrevStream[streamId]`, `seq` contiguous, `streamSeq` contiguous, stored hashes equal recomputed ones.
3. Finally check `ledger_heads` matches the last computed hashes and that `COUNT(*) == max(seq)`.
4. Output: `{ ok, checked, firstBadSeq?, reason?, headHash, headSeq, durationMs }`. Exposed via `POST /api/ledger/verify` and the CLI `npm run ledger:verify`. Scheduled nightly (Phase 4) and the result appended to `system` as `ChainAnchorPublished` with the head hash, so even verification runs are on the chain.

### 9.5 Anchoring (optional, Phase 4)

`anchors/chain-head-<ts>.json = { headSeq, headHash, verifiedAt, signer }` signed with an operator key (Key Vault in Azure). Later: write the same payload to Azure Confidential Ledger (§16).

### 9.6 Reprocessing and corrections — never mutate

- Re-uploading **the same bytes** ⇒ idempotent (§10.3): no new ledger entries except `BatchReceived { duplicateOf }`.
- Re-uploading a **corrected file** (e.g., from the Rejected Individuals CSV) ⇒ a new batch; member streams simply gain new entries. The Update Set builder detects an earlier **unexported** `ArielUpdateProposed` for the same `(member, employer, eventType)` and appends `CorrectionAppended { supersedesEntryId }` so the older proposal is excluded from the new Update Set.
- An **exported** Update Set that turns out wrong is never deleted: Admin creates a compensating batch (`source: 'MANUAL_CORRECTION'`) whose items reverse (`UPSERT_ADD` with negated amounts, `UPDATE` back to `before`) — all ledgered as `CorrectionAppended` with the reason.
- Rejected Update Sets stay on the chain as `UpdateSetRejected`; the batch returns to `VALIDATED` for override/fix and rebuild (new `UpdateSetBuilt` with a new `contentHash`).

### 9.7 PII handling in the ledger

| Element | Treatment |
|---|---|
| Stream id | `member:` + `HMAC-SHA256(SIN_PEPPER, sin)` hex — deterministic for joins, non-reversible without the pepper (Key Vault secret; rotation = new pepper version + rebuilt projections; old entries keep old id, mapping table `sin_pseudo_versions` encrypted) |
| Payload | Never contains raw SIN, DOB, or names. Member display is `sinMasked` + initials. Amounts and dates are business data and are included (they are what we are proving provenance of) |
| Hash inputs | Only pseudonymised identifiers ⇒ publishing a chain head or an entry hash leaks nothing |
| Raw SIN at rest | `events_records.sin_enc` and `ariel_mock.members.sin_enc`: AES-256-GCM with a per-member data key wrapped by a master key (`SIN_KEK`); needed only to render Rejected Individuals CSV and the export file for Ariel |
| Logs | pino redaction on `*.sin`, `*.SIN`, `values.SIN`; URLs use `sinPseudo` only |

---

## 10. Batch processing pipeline

### 10.1 State machine

```mermaid
stateDiagram-v2
  [*] --> RECEIVED: upload stored in raw/ + manifest
  RECEIVED --> FILE_REJECTED: L0 FILE_ERROR (I50/I51) or undecodable
  RECEIVED --> PARSED: bronze written
  PARSED --> VALIDATED: L1+L2 complete, silver written
  VALIDATED --> VALIDATED: warning override (HELD → ACCEPTED)
  VALIDATED --> LEDGERED: no HELD rows; member outcomes appended
  LEDGERED --> PROJECTION_BUILT: UpdateSet + reports in gold/
  PROJECTION_BUILT --> PENDING_APPROVAL: UpdateSetBuilt ledgered
  PENDING_APPROVAL --> APPROVED: Reviewer approve (contentHash match)
  PENDING_APPROVAL --> REJECTED: Reviewer reject (reason)
  REJECTED --> VALIDATED: Admin "reopen" (fix overrides / config) → rebuild
  APPROVED --> EXPORTED: export files written + UpdateSetExported
  RECEIVED --> FAILED: infrastructure error
  PARSED --> FAILED
  VALIDATED --> FAILED
  LEDGERED --> FAILED
  FAILED --> RECEIVED: Admin retry (same batchId)
  EXPORTED --> [*]
  FILE_REJECTED --> [*]
```

Transitions are guarded in `BatchStateMachine.transition(batch, to, actor)` and recorded in `batch_status_history`. `VALIDATED → LEDGERED → PROJECTION_BUILT → PENDING_APPROVAL` run automatically when no rows are HELD; otherwise the batch waits in `VALIDATED` and the UI shows "N warnings need an override".

### 10.2 Steps (JobRunner tasks, each idempotent & resumable)

| Step | Input → Output | Notes |
|---|---|---|
| `ingest` | multipart upload → `raw/original.csv`, `manifest.json`, `raw_files`, `batches(RECEIVED)`, ledger `BatchReceived` | Size/type checks (§13); SHA-256 computed while streaming |
| `parse` | raw → `bronze/records.ndjson`, `header.json`, `events_records` rows | Decode `windows-1252` (fallback UTF-8/BOM), `csv-parse` with `relax_column_count: true` so I50 can see extra cells; L0 rules; status `PARSED` or `FILE_REJECTED` |
| `validate` | bronze + Ariel snapshot → `silver/*`, `validation_findings`, `events_records.accepted` | Snapshot fetched once per batch (`snapshotForBatch`) and persisted to `silver/ariel-snapshot.ndjson`; L1 then provisional derivation then L2; status `VALIDATED` |
| `ledger` | outcomes → `MemberRecordValidated` / `MemberRecordRejected` entries (payload: ruleIds, messageIds, params, yearScopes, calculated) | one entry per record; chunked transactions |
| `project` | accepted records → final derivation → `ArielUpdateProposed` per member (payload = items) → `ariel_update_sets/items` → gold JSON/CSV/diff + reports → `UpdateSetBuilt` | `contentHash` computed over sorted items |
| `approve` / `reject` | Reviewer action → `approvals` + ledger | `contentHashAtDecision` must equal current hash, else `409` |
| `export` | approved set → `gold/export/<exportId>/…` + `exports` + `UpdateSetExported` | Export JSON includes raw SIN (decrypted) because Ariel needs it; file permissions restricted; export directory configurable per environment |
| `projections` | ledger tail → `member_projections` | runs after `ledger`, `project`, `approve`, `export`; checkpoint in `projection_checkpoints`; `npm run projections:rebuild` replays from seq 1 |

### 10.3 Idempotency

- `(employer_id, file_sha256)` unique ⇒ a second upload of identical bytes returns `200 { batchId: existing, duplicate: true }` and appends `BatchReceived { duplicateOf }` to the *existing* batch stream; no reprocessing. Admin may force (`?force=true`) which creates a new batch with `supersedes` link.
- Every step checks its own output marker (lake file exists + DB status) and skips if present, so a crashed job can be re-run from `RECEIVED`.
- Ledger appends inside a step are wrapped with the step's DB writes in one transaction per chunk; a crash mid-step leaves a consistent prefix and the step resumes from the last ledgered record (`stream_seq` lookup).

### 10.4 Concurrency

- JobRunner: `p-queue` with `concurrency = BATCH_CONCURRENCY (default 2)`; per-batch steps are strictly sequential.
- Two batches for the **same employer** are processed sequentially (queue key = employerId) so B207/B192 style checks against the mock Ariel are not racing. Different employers run in parallel.
- Ledger global lock serialises appends regardless.
- Approval endpoints use optimistic concurrency via `contentHash`.

### 10.5 Failure handling

- Deterministic rule exceptions (bugs) are caught per record ⇒ finding `SYS-RULE-ERROR` (severity CME, visibility PRIVATE, params `{rule, error}`) so one bad rule doesn't sink the batch; the batch gets a red "rule failures" banner and an alert log.
- Infrastructure errors ⇒ `FAILED` with `failureReason`; retry from UI.
- Partial lake writes are written to `*.tmp` then renamed.

### 10.6 Generated reports (legacy mapping)

| Legacy report | Our artifact (gold/reports) | Content |
|---|---|---|
| Execution Report `D0000dti.html` | `execution-report.html` + `.json` | start/end, duration, parameters (employerId, executionDate, rulesConfigHash, adapter), input file name + sha256, output paths, counts (lines read, accepted, rejected, warnings, infos, items), rule timing |
| Summary of Validations (Filtered) `D0000Val.xls` | `summary-of-validations.csv` (tab 1: by message id with counts & severity; tab 2: file-format findings) | PUBLIC findings only |
| Summary of Validations (Non-Filtered) `D0000typ.xlsx` | `summary-of-validations.private.csv` | includes PRIVATE (B41, B44, B182, SYS-*) |
| Control Report `D0000ctl.xslx` | folded into the private summary (`visibility=PRIVATE` column) | |
| Rejected Individuals `Rejected_FileName.csv` | `silver/rejected.csv` | same 15-column layout, original values, raw SIN, plus trailing `__messages` column is **not** added (must stay reloadable) |
| Modified Fields Report `D0000upd.xlsx` | `modified-fields-report.csv` | one row per `ArielUpdateItem` field: member (masked), record type, field, file value, previous Ariel value, resulting value, derivation rule |
| Transactions Report `D0000tra.xlsx` | `transactions-report.csv` | per member: all Service/Contribution/SalaryRate/PA items with dates and amounts |
| Summary Transactions Report `D0000sta.xlsx` | `transactions-summary.csv` | totals by record type/transaction type and by severity outcome |
| Membership Reconciliation `D0000mov.xls` | `membership-reconciliation.csv` | members whose status changes (D-NCT items), with before/after |
| Interface File | `raw/original.csv` | |
| Person Data Change Information `D0000dci.xls` | `person-data-change.csv` | last values passed per member (file columns), for portal display |

XLSX variants are produced in Phase 4 via `exceljs` using the same row data.

---
## 11. API surface

All routes under `src/app/api/**/route.ts`. JSON bodies validated with zod; errors follow `{ error: { code, message, details? } }` with RFC 7807-ish codes. Auth: `x-role` / session (§13.1). Pagination: `?cursor=&limit=` (max 200). All ids are UUID v7. SIN never appears in a URL or response except the export file download.

| Method & path | Role | Request | Response |
|---|---|---|---|
| `GET /api/health` | any | — | `{ status:'ok', db:'ok', lake:'ok', ledgerHead:{seq,hash}, version }` |
| `POST /api/batches` | EmployerSubmitter, Admin | `multipart/form-data`: `file` (CSV ≤ 20 MB), `employerId`, `executionDate?` (ISO), `sourceSystem?` | `202 { batchId, status:'RECEIVED' }` or `200 { batchId, duplicate:true }` |
| `GET /api/batches` | any | `?status=&employerId=&cursor=&limit=` | `{ items: BatchSummary[], nextCursor }` |
| `GET /api/batches/{batchId}` | any | — | `Batch & { statusHistory, updateSetId?, reports: {name,path}[] }` |
| `POST /api/batches/{batchId}/retry` | Admin | — | `202` (FAILED → RECEIVED) |
| `POST /api/batches/{batchId}/reopen` | Admin | `{ reason }` | `200` (REJECTED → VALIDATED) |
| `GET /api/batches/{batchId}/records` | any | `?accepted=true|false|held&cursor` | `{ items: RecordSummary[] (sinMasked, line, eventType, eventDate, outcome, findingCounts) }` |
| `GET /api/batches/{batchId}/findings` | any | `?severity=&ruleId=&lineNumber=&visibility=` (PRIVATE only for Reviewer/Admin) | `{ items: ValidationFinding[] }` |
| `POST /api/findings/{findingId}/override` | Reviewer, Admin (EmployerSubmitter if `ALLOW_SUBMITTER_OVERRIDE`) | `{ reason: string, note?: string }` — reason must be in `overrideReasons` | `200 ValidationFinding` + ledger `WarningOverridden` |
| `GET /api/batches/{batchId}/rejected.csv` | EmployerSubmitter(own employer), Reviewer, Admin | — | `text/csv` Rejected Individuals (audit-logged: contains raw SIN) |
| `GET /api/batches/{batchId}/reports/{name}` | any | name ∈ report list §10.6 | file stream |
| `GET /api/batches/{batchId}/update-set` | Reviewer, Admin | — | `ArielUpdateSet & { items: ArielUpdateItem[] grouped by member }` |
| `GET /api/update-sets/{updateSetId}` | Reviewer, Admin | `?memberSinPseudo=&recordType=` | as above |
| `GET /api/update-sets/{updateSetId}/diff` | Reviewer, Admin | — | `text/markdown` human-readable diff |
| `POST /api/update-sets/{updateSetId}/approve` | Reviewer, Admin | `{ contentHash, note? }` | `200 Approval` / `409` hash mismatch / `422` HELD rows |
| `POST /api/update-sets/{updateSetId}/reject` | Reviewer, Admin | `{ contentHash, reason }` | `200 Approval` |
| `POST /api/update-sets/{updateSetId}/export` | Reviewer, Admin | `{ format?: 'json'|'csv'|'both' }` | `200 { exportId, files:[{path,sha256}] }` |
| `GET /api/exports/{exportId}/{file}` | Admin | — | download (audit-logged) |
| `GET /api/ledger/entries` | Reviewer, Admin | `?streamId=&batchId=&eventType=&fromSeq=&toSeq=&cursor` | `{ items: LedgerEntry[] (payload included) }` |
| `GET /api/ledger/entries/{seq}` | Reviewer, Admin | — | `LedgerEntry & { recomputed: { payloadHash, entryHash, matches } }` |
| `GET /api/ledger/head` | any | — | `{ seq, hash, streams: count }` |
| `POST /api/ledger/verify` | Admin | `{ fromSeq?, toSeq?, streamId? }` | `VerificationResult` (also ledgered) |
| `GET /api/members/{sinPseudo}` | Reviewer, Admin | — | `MemberProjection` |
| `POST /api/members/lookup` | Reviewer, Admin | `{ sin }` (body only, never query) | `{ sinPseudo }` (audit-logged) |
| `GET /api/ariel/members/{sinPseudo}` | Reviewer, Admin | — | `ArielMemberSnapshot` with SIN masked (mock browser) |
| `GET /api/ariel/members` | Reviewer, Admin | `?employerId=&q=` (name) | list |
| `GET /api/ariel/rates` | any | — | rate tables |
| `GET /api/rules` | any | — | rule catalogue (id, label, messageId, level, severity, visibility, overrideReasons, enabled) |
| `GET /api/config/rules` · `PUT` | Admin | `RulesConfig` | current config (+ ledger `system` entry on change) |
| `GET /api/audit` | Admin | `?actor=&action=&from=&to=` | audit log |

Response shapes for `BatchSummary`, `RecordSummary`, `VerificationResult` are zod schemas exported from `src/lib/schemas/api.ts` and shared with the UI.

---

## 12. UI pages

(UX designer to detail; routes under `src/app/(app)/…`; Tailwind; server components for reads, route handlers for mutations.)

| Route | Page | Key elements |
|---|---|---|
| `/upload` | Upload | employer selector (Admin) / fixed (Submitter); drag-drop CSV; execution date override (Admin); shows manifest (sha256, size, encoding) after upload; link to batch |
| `/batches` | Batches list | table: received, employer, filename, status chip, rows/accepted/rejected/warnings, actions; filters by status/employer; live status via polling |
| `/batches/[id]` | Batch detail | status timeline; counters; tabs: **Findings** (filter by severity/rule, PRIVATE toggle for Reviewer), **Rejected rows** (download Rejected Individuals), **Held rows** (override drawer with reason picker), **Reports** (downloads), **Update Set** (link) |
| `/update-sets/[id]` | Update Set review | summary (members, items by record type); member accordion → item table (record type, operation, field, before → after, source field, derivation rule, explanation); diff view; Approve / Reject with confirmation and reason; shows `contentHash`; export button after approval |
| `/ledger` | Ledger explorer + integrity | search by stream/batch/type/seq; entry drawer with payload JSON, hashes, recomputed-hash check; "Verify chain" button (Admin) with progress and result; head hash display and anchors list |
| `/members/[sinPseudo]` | Member view | masked SIN, names, employers, latest event, Ariel status (before/after), timeline from ledger, pending/exported items; SIN lookup form posts to `/api/members/lookup` |
| `/ariel` | Mock Ariel data browser | employer filter; member list; member drawer with employments, breaks, service, contributions, salary rates, PA; rate tables; read-only; "reset seed" (Admin, dev only) |
| `/admin/rules` | Rules & config | catalogue table (enable toggle, tolerances), config hash, change history |

---

## 13. Security

### 13.1 Auth placeholder and roles

- v1 ships `AuthProvider` interface with `HeaderAuthProvider` (dev): reads `x-user-id`, `x-role`, `x-employer-id` headers set by a dev login page (cookie-backed session, `httpOnly`, `SameSite=Lax`). Production implementation: `EntraIdAuthProvider` (OIDC via `next-auth`/MSAL) — §16.
- Roles: `EmployerSubmitter` (upload for own employer, view own batches/findings, download own Rejected Individuals, override warnings only if enabled), `Reviewer` (all read, override, approve/reject, export), `Admin` (everything + config, retry/reopen, verify, audit, mock reset).
- Authorization is enforced in route handlers via `requireRole()` and in data access via an employer scope filter for Submitters. Never in the UI only.

### 13.2 Input validation at boundaries

- Multipart upload: `Content-Type` must be `text/csv`, `application/vnd.ms-excel` or `application/octet-stream` with `.csv` extension; size ≤ `MAX_UPLOAD_BYTES` (20 MB); magic-byte sniff rejects ZIP/PDF/EXE signatures; row count ≤ 50,000; line length ≤ 4,096; stream to disk, never buffer whole file in memory twice.
- CSV cells are treated as untrusted strings; output to CSV reports is escaped and **formula-injection hardened** (prefix `'` for cells starting with `= + - @`).
- All JSON bodies/query params through zod; unknown keys stripped; ids validated as UUID.
- Path traversal: lake paths are built from validated ids only; report `name` is an enum.
- Postgres via parameterised queries only (Drizzle); no string-built SQL except migrations.

### 13.3 SIN protection

- Pseudonym: `HMAC-SHA256(SIN_PEPPER_v1, sin)`; pepper from env/Key Vault; version suffix stored.
- Encryption at rest: AES-256-GCM, per-member DEK (random 32 B) wrapped with `SIN_KEK` (env/Key Vault); `sin_enc = version || iv || ciphertext || tag || wrappedDek`. Decrypt only in `RejectedIndividualsWriter`, `ExportWriter`, `MockArielAdapter.findMemberBySin` (which compares pseudonyms, not plaintext).
- Masking everywhere else: `***-***-563` (last three digits). Logs: pino `redact` on all `sin` paths; error messages never echo cell values for the SIN column (I8 on SIN uses `{1} = "SIN"` instead of the value — deliberate deviation noted in finding `calculated.masked=true`).
- Downloads containing raw SIN (Rejected Individuals, export) are audit-logged with actor, batch, IP.

### 13.4 Audit log

`audit_log` records: login, role assumption, upload, override, approve/reject, export, download of PII artifacts, config change, mock reset, verify. Business facts go to the ledger; access facts go to `audit_log` (append-only by grant).

### 13.5 OWASP Top-10 checklist (v1 posture)

| Risk | Control |
|---|---|
| A01 Broken access control | `requireRole` + employer scoping tests; deny-by-default middleware on `/api/*` and `/(app)/*` |
| A02 Cryptographic failures | SHA-256/HMAC/AES-GCM via `node:crypto`; keys only from env; TLS terminated by platform; no custom crypto |
| A03 Injection | Drizzle params; zod; CSV formula hardening; no `dangerouslySetInnerHTML`; Content-Security-Policy `default-src 'self'` |
| A04 Insecure design | Approval before export; immutable ledger; idempotent upload |
| A05 Misconfiguration | `.env.example` with every variable documented; secure headers via `next.config` (HSTS, nosniff, frame-deny, referrer-policy); `NODE_ENV=production` disables dev auth & mock reset |
| A06 Vulnerable components | `npm audit` in CI; Dependabot; lockfile committed |
| A07 Auth failures | Session cookie flags; CSRF: mutations require `Origin` check + same-site cookie; rate limit uploads/lookups per user |
| A08 Integrity failures | Ledger chain; export manifest hashes; signed anchors (Phase 4) |
| A09 Logging failures | Structured logs with correlation id; audit log; no PII in logs |
| A10 SSRF | No outbound fetches from user input in v1 |

### 13.6 Secrets

No secrets in repo. `.env.example`:

```
DATABASE_URL=postgres://app:app@localhost:5432/hoopp_ledger
LAKE_ROOT=./.lake
SIN_PEPPER_v1=change-me-32-bytes-hex
SIN_KEK=change-me-32-bytes-hex
AUTH_PROVIDER=header            # header | entra
MAX_UPLOAD_BYTES=20971520
BATCH_CONCURRENCY=2
ALLOW_SUBMITTER_OVERRIDE=false
ARIEL_ADAPTER=mock              # mock | (future) odbc
LOG_LEVEL=info
```

---

## 14. Observability

- **Logging:** pino JSON to stdout; fields `ts, level, msg, correlationId (per request/job), batchId, step, ruleId?, durationMs`. Redaction list in `src/lib/log.ts`. Pretty-print in dev.
- **Metrics (in-process, exposed at `GET /api/metrics` in Prometheus text format):** `batches_total{status}`, `records_total{outcome}`, `findings_total{ruleId,severity}`, `step_duration_seconds{step}` histogram, `ledger_entries_total`, `ledger_append_seconds`, `ledger_verify_last_ok` gauge, `queue_depth`.
- **Execution Report** (§10.6) is the business-facing observability artifact; it embeds the per-rule evaluation time and counts so slow rules (B53b, B184*) are visible.
- **Health:** `GET /api/health` checks DB, lake write, and `ledger_heads` consistency (`count == head.seq`).
- **Tracing hook:** `withSpan(name, fn)` wrapper (no-op in v1) to attach OpenTelemetry later.

---

## 15. Testing strategy

| Layer | Tooling | What |
|---|---|---|
| Unit — rules | Vitest, `ruleHarness` | Every rule in §7.9: ≥1 positive, ≥1 negative, per-`yearScope`, per-message-ID; boundary values at tolerances (e.g., B53a at exactly ±250, B184c at ES+3 vs ES+3.01); meta-test asserts a spec file exists for every registered rule |
| Unit — derivation | Vitest | Each `D-*` rule with the seed members; **contribution split worked examples** (zero excess, positive excess, prior CLC present, PA=0 fallback to Ariel PA, PA missing ⇒ 0); service-break closure matrix (TERFIN disability exempt, DECFIN not, start-after-end delete, already-closed no-op); D-NCT only when last open employment; RETFIN flag P vs D-NCT vs A |
| Unit — parsing | Vitest | windows-1252 decode, BOM, quoted commas, extra cells (I50), header variants (I51), left-padding SIN/dates, decimal/integer edge strings |
| Unit — ledger | Vitest | hashing recipe test vectors (fixed payload → fixed hash, checked in as JSON); append/verify; tamper detection (mutate payload via raw SQL as superuser ⇒ verify fails at that seq; trigger blocks UPDATE/DELETE as app role) |
| Integration | Vitest + Docker Compose Postgres (`testcontainers` optional) | full pipeline per golden scenario: upload → PENDING_APPROVAL; assert DB rows, lake files, ledger entry count/types, projections |
| Golden files | Vitest snapshot of artifacts | `tests/golden/<scenario>/expected/{findings.ndjson, ariel-update-set.json, diff.md, reports/*.csv}`; byte-identical comparison (timestamps/ids normalised via deterministic clock + id seeds). Scenarios: `happy-terfin`, `happy-decfin`, `happy-retfin`, `mixed-100-rows` (every rule fires at least once), `duplicate-file`, `file-rejected-header` |
| E2E | Playwright (Chromium) against `next start` + Compose | upload → see findings → override a B40 warning → batch auto-advances → review Update Set → approve → export → download → ledger explorer shows entries → verify OK |
| Property tests | `fast-check` (small) | carve-out algorithm: total carve ≤ window, idempotent under re-ordering; JCS canonicalisation stability |
| Performance smoke | Vitest, skipped in CI by default | 5,000-row file completes `validate` < 60 s and `ledger`+`project` < 60 s on dev laptop |
| Security tests | Vitest + Playwright | role matrix per endpoint (403s); SIN never in logs (log capture assertion); CSV formula hardening |

CI (GitHub Actions): `lint`, `typecheck`, `test:unit`, `test:integration` (service container Postgres), `build`, `test:e2e` (on main and nightly). Coverage gate: rules and derivation ≥ 95 % lines.

---

## 16. Azure target architecture mapping

| Local component | Azure target | Notes |
|---|---|---|
| Filesystem lake (`FsLakeStore`) | **ADLS Gen2** (`AdlsLakeStore` via `@azure/storage-file-datalake`), hierarchical namespace, containers `raw/bronze/silver/gold/anchors`, immutability policy (WORM) on `raw` & `export`, lifecycle rules per §5.2 | Same path conventions |
| Docker Postgres 16 | **Azure Database for PostgreSQL Flexible Server** (zone-redundant HA, PITR 35 days), same schema and triggers; app connects with Entra managed identity | `pgcrypto` available |
| Next.js server + in-process JobRunner | **Azure Container Apps** (one app for web, one for worker using the same image with `ROLE=worker`), KEDA scale on queue depth; alternative App Service (Linux, Node 22) for simplicity | JobRunner backend → **Azure Service Bus** queue (`ServiceBusJobRunner`) |
| `.env` secrets | **Azure Key Vault** (SIN pepper, KEK, DB creds) via managed identity; Key Vault keys for anchor signing | Key rotation procedure documented in runbook |
| Header auth | **Microsoft Entra ID** (OIDC; app roles `EmployerSubmitter`, `Reviewer`, `Admin`; employer id as a claim or lookup table); B2B guests for employers | `EntraIdAuthProvider` |
| Anchors folder | **Azure Confidential Ledger** (append `{headSeq, headHash}` daily) — optional, gives hardware-backed external attestation | Interface `AnchorPublisher` |
| pino stdout | **Azure Monitor / Log Analytics** via Container Apps logging; Application Insights OpenTelemetry exporter for traces/metrics | `withSpan` becomes real |
| Mock Ariel | Real `ArielReferenceAdapter` implementation reading a replicated Ariel view (read-only) through Private Endpoint; or nightly extract into the lake | Interface unchanged |
| Export directory | ADLS `gold/export` + Event Grid notification to the Ariel loader | |

Network: VNet-integrated Container Apps, Private Endpoints for Postgres/Storage/Key Vault, WAF-fronted Front Door for the UI. IaC: Bicep in `infra/` (Phase 4+).

---

## 17. Implementation phases

Each phase ends with a demo and the listed acceptance criteria (AC) green in CI. The developer agent owns code; QA agent owns the test suites listed.

### Phase 1 — Foundation (DB, lake, upload, parse, L0/L1 rules, batch list)

Scope: Drizzle schema + migrations (all tables incl. ledger triggers, mock tables empty), `FsLakeStore`, upload API/UI, `parse` step, L0 + L1 rules (§7.9.1–7.9.2 incl. I9), findings persistence, batches list/detail (findings tab), Rejected Individuals CSV, Execution Report (json/html), ledger service with `BatchReceived`/`BatchParsed`/`BatchFileRejected` + `MemberRecordRejected` for L1 rejects, `GET /api/ledger/*`, header auth, pino logging, Docker Compose, `.env.example`, CI skeleton.

AC:
1. `docker compose up` + `npm run db:migrate` + `npm run dev` works from a clean clone with only `.env.example` copied.
2. Uploading `tests/golden/file-rejected-header/input.csv` → batch `FILE_REJECTED` with I51 finding; `happy-terfin/input.csv` → `PARSED` then `VALIDATED` (L2 not yet implemented ⇒ every non-rejected row accepted) with `bronze/`, `silver/`, `manifest.json` present and sha256 matching the file.
3. Every L0/L1 rule has passing positive/negative unit tests; `mixed-100-rows` triggers each L1 message ID at least once (asserted).
4. Re-uploading the same file returns `duplicate: true` and creates no second batch.
5. `POST /api/ledger/verify` returns `ok: true`; tampering test (raw SQL update as superuser) makes it return the correct `firstBadSeq`; UPDATE as app role is rejected by trigger.
6. No raw SIN in `events_records` (only `sin_pseudo`, `sin_masked`, `sin_enc`), none in logs (test).
7. Batches list and detail pages render; findings filterable by severity.

### Phase 2 — L2 rules + mock Ariel

Scope: `ariel_mock` schema + seed loader (18 members §4.6), `MockArielAdapter` with `snapshotForBatch`, rate tables, provisional derivation (`FileDerived`), all 41 L2 rules, warning override API/UI (HELD rows), rules config file + `/api/rules`, `silver/ariel-snapshot.ndjson`, Summary of Validations (public/private) CSV, `MemberRecordValidated` + `WarningOverridden` ledger entries, Mock Ariel browser page.

AC:
1. All 41 L2 rules unit-tested per §15 (incl. yearScope and multi-ID cases); coverage ≥ 95 % on `src/lib/rules`.
2. Golden `mixed-100-rows` produces byte-identical `findings.ndjson` on two consecutive runs and matches the checked-in expectation; every L2 message ID appears at least once.
3. Seed members M4/M5/M6 are rejected by B5 with the right event types; M1/M2/M3 pass with zero CME findings.
4. A B40 warning on a row holds the batch in `VALIDATED`; overriding with a listed reason moves the row to ACCEPTED and ledgers `WarningOverridden`; an unlisted reason is rejected with 422.
5. Re-validating a batch with the persisted snapshot (offline mode) reproduces identical findings.

### Phase 3 — Ledger events for updates, projection, Update Set, approval, export

Scope: final derivation (§8 complete, incl. contribution split, break closure, D-NCT, calc request, RETFIN flag), `ArielUpdateProposed`/`UpdateSetBuilt` entries, `ariel_update_sets/items`, gold JSON/CSV/diff writers, Update Set review page, approve/reject/export APIs + UI, `exports` table, `MemberProjection` projector + member page, `CorrectionAppended` on resubmission, Modified Fields & Transactions reports.

AC:
1. Golden `happy-terfin` / `happy-decfin` / `happy-retfin` produce the checked-in `ariel-update-set.json` byte-for-byte; contribution split worked examples (5 cases) pass.
2. Approve with stale `contentHash` → 409; approve while HELD rows exist → 422; approve then export writes files whose sha256 match `exports` rows and the `UpdateSetExported` payload.
3. Rejected Update Set can be reopened by Admin, a warning overridden, and a new Update Set built with a different `contentHash`; both `UpdateSetBuilt` entries remain on the chain.
4. Member page shows timeline consistent with `GET /api/ledger/entries?streamId=member:…`; `projections:rebuild` from seq 1 yields identical `member_projections` rows.
5. Playwright E2E upload → override → approve → export passes.
6. Export JSON contains raw SIN only inside the export directory; download is audit-logged.

### Phase 4 — Reports, hardening, operations

Scope: XLSX report variants, Membership Reconciliation & Person Data Change reports, nightly verify + anchors, metrics endpoint, rate limiting, CSP/headers, `ServiceBusJobRunner` + `AdlsLakeStore` skeletons behind flags, HRIS adapter config format (`config/adapters/<system>.json` column mapping → canonical) with one sample mapping and tests, performance smoke, runbook (`docs/runbook.md`: key rotation, reprocess, restore), Bicep skeleton.

AC:
1. All §10.6 reports generated for golden scenarios and snapshot-tested.
2. Nightly verify job appends `ChainAnchorPublished`; `/ledger` page shows last anchor.
3. 5,000-row performance smoke within budget; `npm audit` clean (no high/critical).
4. Security tests: role matrix 100 % covered; CSP present; upload limits enforced.
5. Sample Workday mapping converts a fixture export into canonical CSV that passes Phase-1 parsing.

---

## 18. Open questions and assumptions

Each item states the ambiguity, the **default we build**, and who should confirm.

| # | Question | Default adopted | Owner |
|---|---|---|---|
| Q1 | **DateOfDeath is GUI-only** ("NOT available on .CSV"), yet DECFIN rows can arrive in a CSV and several rules/derivations key on DateOfDeath. | For CSV DECFIN rows, `EventDate = EmploymentEndDate` and `DateOfDeath = EmploymentEndDate` (Member.DateOfDeath is set to it). I1 does not demand a DateOfDeath column. If the employer's canonical adapter can supply `DateOfDeath` as an optional 16th column, we accept it (header optional, I51 tolerant). | HOOPP business analyst |
| Q2 | I51 severity is "Complete Member Error" but logic says reject the input file. | Treat as FILE_ERROR (whole batch). | HOOPP |
| Q3 | I7 lists two message IDs (6503 / 6642) with no mapping. | 6503 for current-year decimal fields, 6642 for previous-year. | HOOPP |
| Q4 | I9 (invalid code) and B3 (SIN mod-10) are not sectioned for Events. | I9 enabled by default (EventType is a coded field); B3 available but disabled. | HOOPP |
| Q5 | I42 future-date check omits RETFIN. | Apply to RETFIN as CME too (a future retirement final date is implausible); configurable. | HOOPP |
| Q6 | B31 is CME but has an override reason and message says "select a valid override reason". | Implement as WARNING requiring override. | HOOPP |
| Q7 | B33 CY service clause says "termination year − 1" (likely copy-paste from PY). | Use termination year for CY. | HOOPP |
| Q8 | B53b has IDs 7375 (Events) and 8795 (Events_LTD) with no selection rule. | 8795 when FA/ACW inputs were used (situations 2–3), else 7375. | HOOPP |
| Q9 | Rate tables (YMPE/MGA, PAMAXDB, REDFE, contribution rates per year) are not in the provided documents. | Seed with placeholder 2024–2026 values flagged `placeholder: true`; rules read only from the adapter's rate tables. | HOOPP actuarial/data team |
| Q10 | B186a/b/c define `ValidationYear = Year(ExecutionParameters.StartDate)` while sibling rules use EventYear / EventYear−1 for Events. | Use EventYear and EventYear−1 (consistent with B184/B185 and the message params). | HOOPP |
| Q11 | B153 sectioned "Contributions Events" but is a Retro rule. | Excluded from Events; listed for confirmation. | HOOPP |
| Q12 | `Other Information = "Events" + EmploymentEndDate` — apply to DECFIN (which has no EmploymentEndDate on GUI)? | Emit with the event date for all types. | HOOPP |
| Q13 | B139's "Calculation Indicator" code value is unspecified. | `CHG_RET_EED`. | HOOPP/Ariel team |
| Q14 | High-contribution "Attention" note (PA = 0 fallback, points 3–5). | **Resolved** from full XLSX cell: (3) when `File.PA = 0.00` use Ariel PA; if no Ariel PA for the year of EmploymentEndDate/DeathDate, no High RPP or High RCA CLC is calculated; (4) see Default Values, Contributions record; (5) load 0 if reported/calculated — CLC only loaded when High RPP and PA are both present for the year. | Closed |
| Q15 | Sign convention of RPPHGH CLC (`−[MAX(0,…)] − ΣRPPHighCLC`) vs RCAHGH CLC (`+[…] − ΣRPPHighCLC`). | Implemented literally (RPP negative, RCA positive, both net of prior RPP CLC); isolated in `contributionSplit.ts`. | HOOPP finance |
| Q16 | Disability-break exemption stated only for TERFIN. | DECFIN/RETFIN close disability breaks like others. | HOOPP |
| Q17 | "Most recent termination date" for status/calc Event Date with concurrent employments. | MAX(EventDate, other employments' terminationDate). | HOOPP |
| Q18 | Employer identity: the CSV has no employer column; the Portal supplies it. | `employerId` is an upload parameter bound to the submitter's identity. | Product |
| Q19 | Execution date: legacy "ExecutionParameters.StartDate / ExecutionDate". | Defaults to receipt date; Admin may override at upload (needed for reproducing historical batches and B31 tests). | Product |
| Q20 | Who may override warnings — employer (Portal behaviour) or Reviewer? | Reviewer/Admin by default; `ALLOW_SUBMITTER_OVERRIDE` flag to mirror Portal. | Product |
| Q21 | B181 disabled since R14. | Shipped disabled; toggle in config. | HOOPP |
| Q22 | B53b ACW factor calculation (Chapter 2 §4.2C) not available. | Use stored ACW service transaction; finding carries `acwSource`. | HOOPP |
| Q23 | NHH employer codes table in spec is partially inconsistent (0235 listed for three names). | Config-driven list; confirm codes. | HOOPP |
| Q24 | Retention periods. | 7 years (regulatory) as placeholder. | HOOPP compliance |

Assumptions not needing confirmation: single tenant; English only; civil dates in America/Toronto are stored as dates without TZ; Node 22 LTS; Postgres 16; no concurrent edits of the same batch by two reviewers (optimistic `contentHash` suffices).

---

*End of document.*

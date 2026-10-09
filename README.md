# HOOPP Events Validation Ledger

Ingests employer **Events** CSV files (TERFIN / DECFIN / RETFIN), validates them against the Chapter 7
rule set, and records every fact on an **append-only, SHA-256 hash-chained ledger**. The design baseline is
[docs/architecture.md](docs/architecture.md); the UI specification is [docs/ux-design.md](docs/ux-design.md).

## Status

Phase 1A (backend foundation) is implemented: DB schema + migrations, filesystem data lake, upload/ingest,
strict CSV parser, L0 + L1 rules (+ I42), findings, Rejected Individuals CSV, Execution Report, ledger
service with verification, header auth, and the Phase 1 REST API. The UI pass (Phase 1B) is next.

## Tech stack

| Layer | Technology |
| --- | --- |
| App / API | Next.js 15 (App Router, route handlers), React 19, TypeScript strict, Node 22 |
| Database | Postgres 16 schema via Drizzle ORM. Two drivers: **PGlite** (embedded, default) or **postgres.js** |
| Lake | Filesystem `LakeStore` (raw / bronze / silver / gold zones, write-once, sha256 manifest) |
| Crypto | `node:crypto`: SHA-256 chain, HMAC-SHA256 SIN pseudonyms, AES-256-GCM SIN encryption |
| Tests | Vitest (unit, rule fixtures, pipeline + API integration on in-memory PGlite) |

## Getting started

Prerequisites: Node 22 and npm. **No Docker or Postgres install is required** - the default `DB_DRIVER=pglite`
runs an embedded Postgres (WASM) under `.data/pglite`.

```powershell
npm install
Copy-Item .env.example .env        # safe local defaults, see comments inside
npm run db:migrate                 # applies drizzle/ migrations (schema, enums, ledger triggers)
npm run demo:phase1                # upload golden files -> VALIDATED / FILE_REJECTED / duplicate / verify ok
npm run dev                        # http://localhost:3000/api/health
```

### Using real Postgres instead (optional)

```powershell
docker compose up -d               # postgres:16-alpine on localhost:5432 (app/app, db hoopp_ledger)
# in .env:  DB_DRIVER=postgres  and  DATABASE_URL=postgres://app:app@localhost:5432/hoopp_ledger
npm run db:migrate
```

The same Drizzle schema and the same SQL migrations run on both drivers. The ledger tamper-prevention
triggers work on both; the extra `GRANT`-based protection for a restricted `hoopp_app` role is
Postgres-only (PGlite runs as a single superuser).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | `tsc --noEmit` / ESLint |
| `npm test` / `test:watch` / `test:coverage` | Vitest (in-memory PGlite per test file) |
| `npm run db:generate` | `drizzle-kit generate` - new SQL migration from `src/lib/db/schema` |
| `npm run db:migrate` | apply `drizzle/*.sql` through the active driver |
| `npm run db:seed` | stub (Phase 2 seeds the mock Ariel data set) |
| `npm run ledger:verify` | recompute and verify the whole hash chain |
| `npm run demo:phase1` | Phase 1 acceptance walk-through |

## Dev authentication

`AUTH_MODE=header`: send `x-user-id`, `x-user-role` (`EmployerSubmitter` | `Reviewer` | `Admin`) and, for
submitters, `x-employer-id`. Example upload:

```powershell
curl.exe -X POST "http://localhost:3000/api/batches?wait=true" `
  -H "x-user-id: jsmith" -H "x-user-role: EmployerSubmitter" -H "x-employer-id: 0235" `
  -F "file=@tests/golden/happy-terfin/input.csv;type=text/csv" -F "employerId=0235"
```

## API (Phase 1)

`GET /api/health`, `POST /api/batches` (multipart; `?wait=true` runs the pipeline inline), `GET /api/batches`,
`GET /api/batches/{id}`, `GET /api/batches/{id}/findings`, `GET /api/batches/{id}/records`,
`GET /api/batches/{id}/reports/{name}`, `GET /api/batches/{id}/rejected.csv`, `GET /api/ledger/head`,
`GET /api/ledger/entries`, `GET /api/ledger/entries/{seq}`, `POST /api/ledger/verify`, `GET /api/rules`.
Errors use `{ error: { code, message, details?, correlationId } }`; every response carries `x-correlation-id`.

## Project structure

```text
drizzle/                 SQL migrations + meta journal (committed)
scripts/                 migrate, seed, ledger-verify, demo-phase1
src/app/api/**           route handlers (architecture section 11)
src/lib/
  api/                   handler wrapper, error envelope, pagination
  auth/                  HeaderAuthProvider, role matrix, employer scoping
  config.ts              zod-validated environment
  crypto/, pii/          canonical JSON, hashing, AES-GCM, SIN helpers
  db/                    Drizzle schema (all section 6 tables), driver factory, getDb()
  events/                decode, strict CSV parse, field parsers, record builder
  lake/                  LakeStore interface, FsLakeStore, path layout, ADLS stub
  ledger/                LedgerService: append / head / list / verify, hash recipe
  pipeline/              ingest, run (parse -> validate -> reports), state machine, job runner
  queries/               server-side data access shared by API routes and (later) pages
  rules/                 Rule interface, registry, engine, events/l0 l1 l2 rules
src/types/               domain types (architecture section 4)
tests/                   unit, rules (one spec per rule), integration, golden fixtures
```

## Development

AI agents under `.claude/agents/` (Architect, UX Designer, Web Developer, QA Engineer) build the
application following `.github/instructions/`.

## License

Proprietary - All Rights Reserved. See [LICENSE](LICENSE).

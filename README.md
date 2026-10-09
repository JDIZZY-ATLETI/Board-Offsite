# HOOPP Events Validation Ledger

Ingests employer **Events** CSV files (TERFIN / DECFIN / RETFIN), validates them against the Chapter 7
rule set, and records every fact on an **append-only, SHA-256 hash-chained ledger**. The design baseline is
[docs/architecture.md](docs/architecture.md); the UI specification is [docs/ux-design.md](docs/ux-design.md).

## Status

Phase 1A (backend foundation) is implemented: DB schema + migrations, filesystem data lake, upload/ingest,
strict CSV parser, L0 + L1 rules (+ I42), findings, Rejected Individuals CSV, Execution Report, ledger
service with verification, header auth, and the Phase 1 REST API.

Phase 1B (UI foundation, `docs/ux-design.md` section 9.6 items 1-10) is implemented: design tokens and
shadcn-style primitives, app shell with role-filtered navigation, dev login, Dashboard, Upload (with header
pre-flight), Batches list with live polling, Batch detail (Overview / Findings / Records / Reports), Ledger
Explorer with integrity verification, and the global IntegrityBanner. See "Using the app" below.

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
| `npm run lint:pii` | CI guard: no 9-digit (SIN-shaped) literals under `src/app` / `src/components` |
| `npm run e2e:phase1` | browser E2E of the Phase 1 UI against `npm run dev` (screenshots to `docs/screenshots/phase1/`) |

## Using the app

```powershell
npm run db:migrate
npm run dev                        # http://localhost:3000 -> redirects to /login
```

### Dev login personas

`/login` (non-production only) offers seeded personas; picking one sets an `httpOnly` cookie that
`src/middleware.ts` maps onto the `x-user-id` / `x-user-role` / `x-employer-id` headers the
`HeaderAuthProvider` already reads, so pages and API routes share one auth path. Client-supplied
`x-user-*` / `x-role` headers are **stripped** by the middleware on every request (the cookie is the only
identity source over HTTP; in production the header provider refuses everything until the Entra ID provider
ships). Cookie-authenticated non-GET requests must come from the same origin.

| Persona | User id | Role | Scope | Can |
| --- | --- | --- | --- | --- |
| J. Smith | `jsmith` | EmployerSubmitter | employer 0235 | upload, view own batches/findings/records/reports, download rejected rows |
| M. Lee | `mlee` | EmployerSubmitter | employer 0359 | same, scoped to 0359 |
| R. Patel | `rpatel` | Reviewer | all employers | everything read-only incl. Ledger explorer (Verify disabled) |
| Admin | `admin` | Admin | all | everything incl. upload for any employer, execution-date override, ledger Verify |

### Flow (ux-design section 6.1, Phase 1 slice)

1. **Upload** (`/upload`): drop a CSV. The header is pre-checked in the browser (I51-like, advisory); the
   sha256 is computed client-side so it can be matched against the manifest. `Upload and validate` POSTs
   `multipart/form-data` to `/api/batches`; `202` lands on the batch page, `200 duplicate:true` shows the
   "already uploaded" interstitial.
2. **Batch detail** (`/batches/{id}`): the stepper and status badge refresh every 3 s while the batch is
   transient (10 s after two minutes, paused while the tab is hidden) and a polite live region announces
   "Batch is now Validated". Tabs: Overview (counts, outcome by event type, next step, top findings, file),
   Findings (group by row for Submitters / by severity for Reviewers, facets in the URL, rejected-rows CSV
   behind a confirmation because it contains full SINs), Records (raw vs parsed values, PY column toggle),
   Reports (Execution report in-app + HTML/JSON, Rejected individuals; later-phase reports shown disabled).
3. **Ledger explorer** (`/ledger`, Reviewer/Admin): newest-first chain with stream / event-type / batch /
   seq-range filters, `?seq=N` opens the entry drawer with recomputed hashes, Admin **Verify integrity**
   appends a `ChainAnchorPublished` entry and drives the IntegrityBanner (verified / stale / tampered).

Golden inputs to try: `tests/golden/happy-terfin/input.csv` (VALIDATED, all accepted),
`tests/golden/file-rejected-header/input.csv` (FILE_REJECTED, I51), `tests/golden/mixed-100-rows/input.csv`
(62 accepted / 38 rejected). Identical bytes for the same employer are deduplicated.

`npm run e2e:phase1` replays this flow against a running dev server through the installed Chrome
(playwright-core, no browser download) and writes screenshots to `docs/screenshots/phase1/`.

## Dev authentication

`AUTH_MODE=header`: route handlers read `x-user-id`, `x-user-role` (`EmployerSubmitter` | `Reviewer` |
`Admin`) and, for submitters, `x-employer-id` - but only the middleware may set them (it strips whatever a
client sends). From the command line, log in once through `POST /api/auth/dev-login` (non-production only)
and reuse the cookie:

```powershell
curl.exe -c .data/cookies.txt -X POST http://localhost:3000/api/auth/dev-login `
  -H "content-type: application/json" -d "{\"userId\":\"jsmith\",\"role\":\"EmployerSubmitter\",\"employerId\":\"0235\"}"
curl.exe -b .data/cookies.txt -X POST "http://localhost:3000/api/batches?wait=true" `
  -F "file=@tests/golden/happy-terfin/input.csv;type=text/csv" -F "employerId=0235"
```

In-process tests call the route handlers directly and keep passing the headers themselves.

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
src/app/(auth)/login     dev login (non-production)
src/app/(app)/**         authenticated pages: dashboard, upload, batches/[batchId]/*, ledger, forbidden
src/app/api/**           route handlers (architecture section 11)
src/components/ui/       shadcn-style primitives (Radix + Tailwind, owned code)
src/components/app/      product components (badges, DataTable, dropzone, stepper, findings, ledger, ...)
src/middleware.ts        dev cookie -> auth headers bridge (disabled in production)
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
  queries/               server-side data access shared by API routes and pages (batches, findings, records, ledger, dashboard)
  ui/                    status-map (single state language), format, nav, preflight, polling hook
  rules/                 Rule interface, registry, engine, events/l0 l1 l2 rules
src/types/               domain types (architecture section 4)
tests/                   unit, rules (one spec per rule), integration, ui (jsdom), golden fixtures
```

## Development

AI agents under `.claude/agents/` (Architect, UX Designer, Web Developer, QA Engineer) build the
application following `.github/instructions/`.

## License

Proprietary - All Rights Reserved. See [LICENSE](LICENSE).

-- Ledger integrity (architecture section 6 / section 9). Runs identically on PGlite and Postgres 16.

INSERT INTO "ledger_heads" ("stream_id", "last_seq", "last_hash", "updated_at")
VALUES ('__global__', 0, repeat('0', 64), now())
ON CONFLICT ("stream_id") DO NOTHING;
--> statement-breakpoint

-- Immutability: no UPDATE/DELETE/TRUNCATE ever, enforced in the DB, not just the app.
CREATE OR REPLACE FUNCTION ledger_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only';
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_ledger_no_update
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_block_mutation();
--> statement-breakpoint

-- Chain integrity on insert: prev hashes must equal current heads; seq must be head + 1.
CREATE OR REPLACE FUNCTION ledger_check_chain() RETURNS trigger AS $$
DECLARE
  g ledger_heads%ROWTYPE;
  s ledger_heads%ROWTYPE;
BEGIN
  SELECT * INTO g FROM ledger_heads WHERE stream_id = '__global__' FOR UPDATE;
  IF NEW.seq <> g.last_seq + 1 OR NEW.prev_hash_global <> g.last_hash THEN
    RAISE EXCEPTION 'global chain mismatch at seq %', NEW.seq;
  END IF;
  SELECT * INTO s FROM ledger_heads WHERE stream_id = NEW.stream_id FOR UPDATE;
  IF NOT FOUND THEN
    IF NEW.stream_seq <> 1 OR NEW.prev_hash_stream <> repeat('0', 64) THEN
      RAISE EXCEPTION 'stream genesis mismatch for %', NEW.stream_id;
    END IF;
    INSERT INTO ledger_heads VALUES (NEW.stream_id, NEW.stream_seq, NEW.entry_hash, now());
  ELSE
    IF NEW.stream_seq <> s.last_seq + 1 OR NEW.prev_hash_stream <> s.last_hash THEN
      RAISE EXCEPTION 'stream chain mismatch for %', NEW.stream_id;
    END IF;
    UPDATE ledger_heads SET last_seq = NEW.stream_seq, last_hash = NEW.entry_hash, updated_at = now()
      WHERE stream_id = NEW.stream_id;
  END IF;
  UPDATE ledger_heads SET last_seq = NEW.seq, last_hash = NEW.entry_hash, updated_at = now()
    WHERE stream_id = '__global__';
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_ledger_chain
  BEFORE INSERT ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_check_chain();
--> statement-breakpoint

-- Postgres-only defence in depth (no-op on PGlite, which runs as a single superuser):
-- the application role gets INSERT/SELECT only on ledger_entries. Applied when the role exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hoopp_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "ledger_entries" FROM hoopp_app;
    GRANT SELECT, INSERT ON "ledger_entries" TO hoopp_app;
  END IF;
END
$$;

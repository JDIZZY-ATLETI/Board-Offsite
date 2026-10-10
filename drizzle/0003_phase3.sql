ALTER TABLE "ariel_update_sets" DROP CONSTRAINT "ariel_update_sets_batch_id_unique";--> statement-breakpoint
ALTER TABLE "ariel_update_sets" ADD COLUMN "build_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ariel_update_sets" ADD COLUMN "employer_id" text;--> statement-breakpoint
ALTER TABLE "ariel_update_sets" ADD COLUMN "counts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ariel_update_sets" ADD COLUMN "ledger_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "ariel_update_sets" ADD COLUMN "ledger_seq" bigint;--> statement-breakpoint
CREATE INDEX "ix_update_sets_batch" ON "ariel_update_sets" USING btree ("batch_id","build_no");--> statement-breakpoint
ALTER TABLE "ariel_update_items" ADD COLUMN "record_id" uuid;--> statement-breakpoint
ALTER TABLE "ariel_update_items" ADD COLUMN "line_number" integer;--> statement-breakpoint
ALTER TABLE "ariel_update_items" ADD COLUMN "event_type" text;--> statement-breakpoint
ALTER TABLE "ariel_update_items" ADD COLUMN "event_date" date;--> statement-breakpoint
ALTER TABLE "ariel_update_items" ADD COLUMN "year_scope" text;--> statement-breakpoint
ALTER TABLE "ariel_update_items" ADD COLUMN "calculated" jsonb;--> statement-breakpoint
ALTER TABLE "ariel_update_items" ADD COLUMN "sin_masked" char(11);--> statement-breakpoint
CREATE INDEX "ix_items_set_type" ON "ariel_update_items" USING btree ("update_set_id","record_type");--> statement-breakpoint
ALTER TABLE "exports" ALTER COLUMN "json_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ALTER COLUMN "csv_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ALTER COLUMN "json_sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ALTER COLUMN "csv_sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "format" text DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "content_hash" char(64);--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "export_dir" text;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "manifest_path" text;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "manifest_sha256" char(64);--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "ledger_seq" bigint;--> statement-breakpoint
CREATE INDEX "ix_exports_batch" ON "exports" USING btree ("batch_id");--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "update_set_id" uuid;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "rejected_by" text;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "rejected_reason" text;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "reopened_by" text;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "exported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "member_projections" ADD COLUMN "corrections" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "member_projections" ADD COLUMN "last_update_set" jsonb;--> statement-breakpoint
ALTER TABLE "member_projections" ADD COLUMN "last_event_type" text;--> statement-breakpoint
ALTER TABLE "member_projections" ADD COLUMN "counts" jsonb DEFAULT '{}'::jsonb NOT NULL;
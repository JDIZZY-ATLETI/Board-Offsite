CREATE SCHEMA "ariel_mock";
--> statement-breakpoint
CREATE TYPE "public"."ariel_operation" AS ENUM('UPDATE', 'CREATE', 'UPSERT_ADD', 'CLOSE', 'DELETE', 'SET_FLAG');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('RECEIVED', 'PARSED', 'VALIDATED', 'LEDGERED', 'PROJECTION_BUILT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPORTED', 'FAILED', 'FILE_REJECTED');--> statement-breakpoint
CREATE TYPE "public"."finding_level" AS ENUM('L0', 'L1', 'L2');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('FILE_ERROR', 'COMPLETE_MEMBER_ERROR', 'WARNING', 'INFORMATION');--> statement-breakpoint
CREATE TYPE "public"."finding_visibility" AS ENUM('PUBLIC', 'PRIVATE');--> statement-breakpoint
CREATE TYPE "public"."update_set_status" AS ENUM('BUILDING', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPORTED');--> statement-breakpoint
CREATE TABLE "batch_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"from_status" "batch_status",
	"to_status" "batch_status" NOT NULL,
	"actor" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"batch_id" uuid PRIMARY KEY NOT NULL,
	"employer_id" text NOT NULL,
	"file_type" text NOT NULL,
	"source_system" text DEFAULT 'HOOPP_CSV' NOT NULL,
	"status" "batch_status" DEFAULT 'RECEIVED' NOT NULL,
	"execution_date" date NOT NULL,
	"raw_file_id" uuid NOT NULL,
	"file_sha256" char(64) NOT NULL,
	"uploaded_by" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_accepted" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"warnings_total" integer DEFAULT 0 NOT NULL,
	"infos_total" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events_records" (
	"record_id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"sin_pseudo" char(64),
	"sin_masked" char(11),
	"sin_enc" "bytea",
	"last_name" text,
	"first_name" text,
	"event_type" text,
	"employment_end_date" date,
	"date_of_death" date,
	"event_year" integer,
	"cy_weeks" numeric(6, 2),
	"cy_low" numeric(10, 2),
	"cy_high" numeric(10, 2),
	"cy_ae" integer,
	"cy_pa" integer,
	"py_weeks" numeric(6, 2),
	"py_low" numeric(10, 2),
	"py_high" numeric(10, 2),
	"py_ae" integer,
	"py_pa" integer,
	"raw_values" jsonb NOT NULL,
	"parse_ok" boolean NOT NULL,
	"accepted" boolean
);
--> statement-breakpoint
CREATE TABLE "raw_files" (
	"raw_file_id" uuid PRIMARY KEY NOT NULL,
	"original_filename" text NOT NULL,
	"sha256" char(64) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"encoding_detected" text NOT NULL,
	"lake_path" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_findings" (
	"finding_id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"record_id" uuid,
	"line_number" integer,
	"sin_pseudo" char(64),
	"rule_id" text NOT NULL,
	"message_id" text NOT NULL,
	"level" "finding_level" NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"visibility" "finding_visibility" DEFAULT 'PUBLIC' NOT NULL,
	"field" text,
	"year_scope" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data_import_message" text NOT NULL,
	"portal_message" text NOT NULL,
	"override_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"override_reason" text,
	"override_actor" text,
	"override_at" timestamp with time zone,
	"calculated" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"stream_id" text NOT NULL,
	"stream_seq" bigint NOT NULL,
	"event_type" text NOT NULL,
	"batch_id" uuid,
	"actor" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" char(64) NOT NULL,
	"prev_hash_global" char(64) NOT NULL,
	"prev_hash_stream" char(64) NOT NULL,
	"entry_hash" char(64) NOT NULL,
	CONSTRAINT "ledger_entries_entry_id_unique" UNIQUE("entry_id"),
	CONSTRAINT "ledger_entries_entry_hash_unique" UNIQUE("entry_hash"),
	CONSTRAINT "ux_ledger_stream_seq" UNIQUE("stream_id","stream_seq")
);
--> statement-breakpoint
CREATE TABLE "ledger_heads" (
	"stream_id" text PRIMARY KEY NOT NULL,
	"last_seq" bigint NOT NULL,
	"last_hash" char(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"approval_id" uuid PRIMARY KEY NOT NULL,
	"update_set_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"actor" text NOT NULL,
	"role" text NOT NULL,
	"reason" text,
	"content_hash_at_decision" char(64) NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	CONSTRAINT "ck_approvals_decision" CHECK ("approvals"."decision" IN ('APPROVED','REJECTED')),
	CONSTRAINT "ck_approvals_reason" CHECK ("approvals"."decision" <> 'REJECTED' OR "approvals"."reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ariel_update_items" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"update_set_id" uuid NOT NULL,
	"sin_pseudo" char(64) NOT NULL,
	"member_display" text NOT NULL,
	"employer_id" text NOT NULL,
	"record_type" text NOT NULL,
	"operation" "ariel_operation" NOT NULL,
	"target_key" jsonb NOT NULL,
	"fields" jsonb NOT NULL,
	"before_values" jsonb,
	"source_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"derivation_rule" text NOT NULL,
	"explanation" text NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ariel_update_sets" (
	"update_set_id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"status" "update_set_status" DEFAULT 'BUILDING' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"content_hash" char(64),
	"artifacts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"built_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ariel_update_sets_batch_id_unique" UNIQUE("batch_id")
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"export_id" uuid PRIMARY KEY NOT NULL,
	"update_set_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"exported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"json_path" text NOT NULL,
	"csv_path" text NOT NULL,
	"json_sha256" char(64) NOT NULL,
	"csv_sha256" char(64) NOT NULL,
	"ledger_entry_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"role" text,
	"action" text NOT NULL,
	"target" text,
	"ip" "inet",
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "member_projections" (
	"sin_pseudo" char(64) PRIMARY KEY NOT NULL,
	"sin_masked" char(11) NOT NULL,
	"last_name" text,
	"first_name" text,
	"employer_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"latest_event" jsonb,
	"ariel_status" jsonb,
	"pending_items" integer DEFAULT 0 NOT NULL,
	"exported_items" integer DEFAULT 0 NOT NULL,
	"last_ledger_seq" bigint NOT NULL,
	"stream_head_hash" char(64) NOT NULL,
	"timeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection_checkpoints" (
	"projection_name" text PRIMARY KEY NOT NULL,
	"last_seq" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ariel_mock"."addresses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" uuid,
	"effective_start_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ariel_mock"."contribution_tx" (
	"tx_id" uuid PRIMARY KEY NOT NULL,
	"employment_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"begin_date" date NOT NULL,
	"end_date" date NOT NULL,
	"payment_date" date NOT NULL,
	"target_date" date NOT NULL,
	"declaration_date" date,
	"indicator" text NOT NULL,
	"summary_attribute" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ariel_mock"."employers" (
	"employer_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"year_end_closed_indicator" date
);
--> statement-breakpoint
CREATE TABLE "ariel_mock"."employment_type_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"employment_id" uuid,
	"type" text NOT NULL,
	"effective_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ariel_mock"."employments" (
	"employment_id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"employer_id" text NOT NULL,
	"permanency_date" date NOT NULL,
	"termination_date" date,
	"termination_code" text,
	"last_annual_data_update" date,
	"other_information" text,
	"employment_type" text NOT NULL,
	"termination_data_update" date
);
--> statement-breakpoint
CREATE TABLE "ariel_mock"."members" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"sin_enc" "bytea" NOT NULL,
	"sin_pseudo" char(64) NOT NULL,
	"last_name" text,
	"first_name" text,
	"date_of_birth" date NOT NULL,
	"date_of_death" date,
	"status" text NOT NULL,
	"sub_status" text,
	"status_effective_date" date NOT NULL,
	"sub_status_effective_date" date,
	"calculation_indicators" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ariel_mock"."membership_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" uuid,
	"status" text,
	"sub_status" text,
	"effective_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ariel_mock"."pension_adjustments" (
	"pa_id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"employer_id" text NOT NULL,
	"calculation_year" integer NOT NULL,
	"amount" integer NOT NULL,
	"calculation_date" date NOT NULL,
	"entry_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ariel_mock"."rate_tables" (
	"table_name" text NOT NULL,
	"year" integer NOT NULL,
	"value" numeric(14, 4) NOT NULL,
	CONSTRAINT "rate_tables_table_name_year_pk" PRIMARY KEY("table_name","year")
);
--> statement-breakpoint
CREATE TABLE "ariel_mock"."salary_rates" (
	"tx_id" uuid PRIMARY KEY NOT NULL,
	"employment_id" uuid NOT NULL,
	"type" text NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	"effective_date" date NOT NULL,
	"entry_date" date,
	"indicator" text NOT NULL,
	"summary_attribute" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ariel_mock"."service_breaks" (
	"break_id" uuid PRIMARY KEY NOT NULL,
	"employment_id" uuid NOT NULL,
	"type" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date
);
--> statement-breakpoint
CREATE TABLE "ariel_mock"."service_tx" (
	"tx_id" uuid PRIMARY KEY NOT NULL,
	"employment_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(8, 4) NOT NULL,
	"begin_date" date NOT NULL,
	"end_date" date NOT NULL,
	"payment_date" date NOT NULL,
	"target_date" date NOT NULL,
	"declaration_date" date,
	"indicator" text NOT NULL,
	"summary_attribute" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "batch_status_history" ADD CONSTRAINT "batch_status_history_batch_id_batches_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("batch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_raw_file_id_raw_files_raw_file_id_fk" FOREIGN KEY ("raw_file_id") REFERENCES "public"."raw_files"("raw_file_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_records" ADD CONSTRAINT "events_records_batch_id_batches_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("batch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_findings" ADD CONSTRAINT "validation_findings_batch_id_batches_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("batch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_findings" ADD CONSTRAINT "validation_findings_record_id_events_records_record_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."events_records"("record_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_update_set_id_ariel_update_sets_update_set_id_fk" FOREIGN KEY ("update_set_id") REFERENCES "public"."ariel_update_sets"("update_set_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_ledger_entry_id_ledger_entries_entry_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("entry_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ariel_update_items" ADD CONSTRAINT "ariel_update_items_update_set_id_ariel_update_sets_update_set_id_fk" FOREIGN KEY ("update_set_id") REFERENCES "public"."ariel_update_sets"("update_set_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ariel_update_items" ADD CONSTRAINT "ariel_update_items_ledger_entry_id_ledger_entries_entry_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("entry_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ariel_update_sets" ADD CONSTRAINT "ariel_update_sets_batch_id_batches_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("batch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_update_set_id_ariel_update_sets_update_set_id_fk" FOREIGN KEY ("update_set_id") REFERENCES "public"."ariel_update_sets"("update_set_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_ledger_entry_id_ledger_entries_entry_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("entry_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ariel_mock"."addresses" ADD CONSTRAINT "addresses_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "ariel_mock"."members"("member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ariel_mock"."contribution_tx" ADD CONSTRAINT "contribution_tx_employment_id_employments_employment_id_fk" FOREIGN KEY ("employment_id") REFERENCES "ariel_mock"."employments"("employment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ariel_mock"."employment_type_history" ADD CONSTRAINT "employment_type_history_employment_id_employments_employment_id_fk" FOREIGN KEY ("employment_id") REFERENCES "ariel_mock"."employments"("employment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ariel_mock"."employments" ADD CONSTRAINT "employments_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "ariel_mock"."members"("member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ariel_mock"."employments" ADD CONSTRAINT "employments_employer_id_employers_employer_id_fk" FOREIGN KEY ("employer_id") REFERENCES "ariel_mock"."employers"("employer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ariel_mock"."membership_status_history" ADD CONSTRAINT "membership_status_history_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "ariel_mock"."members"("member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ariel_mock"."pension_adjustments" ADD CONSTRAINT "pension_adjustments_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "ariel_mock"."members"("member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ariel_mock"."salary_rates" ADD CONSTRAINT "salary_rates_employment_id_employments_employment_id_fk" FOREIGN KEY ("employment_id") REFERENCES "ariel_mock"."employments"("employment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ariel_mock"."service_breaks" ADD CONSTRAINT "service_breaks_employment_id_employments_employment_id_fk" FOREIGN KEY ("employment_id") REFERENCES "ariel_mock"."employments"("employment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ariel_mock"."service_tx" ADD CONSTRAINT "service_tx_employment_id_employments_employment_id_fk" FOREIGN KEY ("employment_id") REFERENCES "ariel_mock"."employments"("employment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_batches_employer_sha" ON "batches" USING btree ("employer_id","file_sha256") WHERE "batches"."status" <> 'FILE_REJECTED';--> statement-breakpoint
CREATE INDEX "ix_batches_status_received" ON "batches" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "ix_batches_received" ON "batches" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_records_batch_line" ON "events_records" USING btree ("batch_id","line_number");--> statement-breakpoint
CREATE INDEX "ix_records_batch_sin" ON "events_records" USING btree ("batch_id","sin_pseudo");--> statement-breakpoint
CREATE INDEX "ix_records_sin" ON "events_records" USING btree ("sin_pseudo");--> statement-breakpoint
CREATE INDEX "ix_findings_batch_sev" ON "validation_findings" USING btree ("batch_id","severity");--> statement-breakpoint
CREATE INDEX "ix_findings_batch_line" ON "validation_findings" USING btree ("batch_id","line_number","sort_order");--> statement-breakpoint
CREATE INDEX "ix_findings_record" ON "validation_findings" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "ix_findings_rule" ON "validation_findings" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "ix_ledger_stream" ON "ledger_entries" USING btree ("stream_id","stream_seq");--> statement-breakpoint
CREATE INDEX "ix_ledger_batch" ON "ledger_entries" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "ix_ledger_type_time" ON "ledger_entries" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_approvals_one_final" ON "approvals" USING btree ("update_set_id") WHERE "approvals"."decision" = 'APPROVED';--> statement-breakpoint
CREATE INDEX "ix_items_set_member" ON "ariel_update_items" USING btree ("update_set_id","sin_pseudo","sort_order");--> statement-breakpoint
CREATE INDEX "ix_items_member" ON "ariel_update_items" USING btree ("sin_pseudo");--> statement-breakpoint
CREATE INDEX "ix_mock_members_sin" ON "ariel_mock"."members" USING btree ("sin_pseudo");
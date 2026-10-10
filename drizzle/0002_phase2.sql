CREATE TABLE "rules_config_overrides" (
	"rule_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rules_config_overrides_rule_id_key_pk" PRIMARY KEY("rule_id","key")
);
--> statement-breakpoint
ALTER TABLE "ariel_mock"."members" ALTER COLUMN "status" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ariel_mock"."members" ALTER COLUMN "status_effective_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "held_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "rules_config_hash" char(64);--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "ariel_snapshot_hash" char(64);--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "ariel_adapter" text;--> statement-breakpoint
ALTER TABLE "events_records" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "validation_findings" ADD COLUMN "override_note" text;--> statement-breakpoint
ALTER TABLE "validation_findings" ADD COLUMN "override_ledger_seq" bigint;--> statement-breakpoint
ALTER TABLE "ariel_mock"."members" ADD COLUMN "scenario" text;--> statement-breakpoint
ALTER TABLE "ariel_mock"."rate_tables" ADD COLUMN "placeholder" boolean DEFAULT true NOT NULL;
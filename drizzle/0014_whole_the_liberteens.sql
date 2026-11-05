CREATE TABLE "rap_moderation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"asset_id" text,
	"generation_id" text,
	"media_hash" text NOT NULL,
	"storage_key" text NOT NULL,
	"policy_version" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_task_id" text,
	"request_body" text,
	"idempotency_key" text NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp DEFAULT now() NOT NULL,
	"lease_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rap_moderation_provider_task_id_unique" UNIQUE("provider_task_id"),
	CONSTRAINT "rap_moderation_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "rap_upload" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"asset_id" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rap_upload_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "rap_asset" ADD COLUMN "media_hash" text;--> statement-breakpoint
ALTER TABLE "rap_generation" ADD COLUMN "media_hash" text;--> statement-breakpoint
ALTER TABLE "rap_generation" ADD COLUMN "moderated_at" timestamp;--> statement-breakpoint
ALTER TABLE "rap_generation" ADD COLUMN "persisted_at" timestamp;--> statement-breakpoint
ALTER TABLE "rap_moderation" ADD CONSTRAINT "rap_moderation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rap_moderation" ADD CONSTRAINT "rap_moderation_asset_id_rap_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."rap_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rap_moderation" ADD CONSTRAINT "rap_moderation_generation_id_rap_generation_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."rap_generation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rap_upload" ADD CONSTRAINT "rap_upload_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rap_upload" ADD CONSTRAINT "rap_upload_asset_id_rap_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."rap_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rap_moderation_asset_version_idx" ON "rap_moderation" USING btree ("asset_id","media_hash","policy_version");--> statement-breakpoint
CREATE UNIQUE INDEX "rap_moderation_generation_version_idx" ON "rap_moderation" USING btree ("generation_id","media_hash","policy_version");--> statement-breakpoint
CREATE INDEX "rap_moderation_work_idx" ON "rap_moderation" USING btree ("next_run_at","status");--> statement-breakpoint
CREATE INDEX "rap_upload_expiry_idx" ON "rap_upload" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "rap_upload_user_idx" ON "rap_upload" USING btree ("user_id","created_at");
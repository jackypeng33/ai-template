CREATE TABLE "rap_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"storage_key" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rap_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"generation_id" text,
	"kind" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rap_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"user_id" text NOT NULL,
	"request" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"email_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rap_generation" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"left_asset_id" text NOT NULL,
	"right_asset_id" text NOT NULL,
	"snapshot" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_task_id" text,
	"result_key" text,
	"result_expires_at" timestamp,
	"submitted_at" timestamp,
	"finished_at" timestamp,
	"next_run_at" timestamp DEFAULT now() NOT NULL,
	"lease_until" timestamp,
	"error" text,
	"provider_credits" text,
	"email_sent_at" timestamp,
	"email_attempted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rap_generation_provider_task_id_unique" UNIQUE("provider_task_id")
);
--> statement-breakpoint
CREATE TABLE "rap_order" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"left_asset_id" text NOT NULL,
	"right_asset_id" text NOT NULL,
	"snapshot" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"merchant_id" text NOT NULL,
	"environment" text NOT NULL,
	"provider_order_id" text,
	"approval_url" text,
	"payment_id" text,
	"status" text DEFAULT 'created' NOT NULL,
	"retry_credits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rap_order_provider_order_id_unique" UNIQUE("provider_order_id")
);
--> statement-breakpoint
ALTER TABLE "rap_asset" ADD CONSTRAINT "rap_asset_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rap_audit" ADD CONSTRAINT "rap_audit_order_id_rap_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."rap_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rap_audit" ADD CONSTRAINT "rap_audit_generation_id_rap_generation_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."rap_generation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rap_feedback" ADD CONSTRAINT "rap_feedback_order_id_rap_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."rap_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rap_feedback" ADD CONSTRAINT "rap_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rap_generation" ADD CONSTRAINT "rap_generation_order_id_rap_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."rap_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rap_generation" ADD CONSTRAINT "rap_generation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rap_generation" ADD CONSTRAINT "rap_generation_left_asset_id_rap_asset_id_fk" FOREIGN KEY ("left_asset_id") REFERENCES "public"."rap_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rap_generation" ADD CONSTRAINT "rap_generation_right_asset_id_rap_asset_id_fk" FOREIGN KEY ("right_asset_id") REFERENCES "public"."rap_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rap_order" ADD CONSTRAINT "rap_order_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rap_order" ADD CONSTRAINT "rap_order_left_asset_id_rap_asset_id_fk" FOREIGN KEY ("left_asset_id") REFERENCES "public"."rap_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rap_order" ADD CONSTRAINT "rap_order_right_asset_id_rap_asset_id_fk" FOREIGN KEY ("right_asset_id") REFERENCES "public"."rap_asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rap_order" ADD CONSTRAINT "rap_order_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rap_asset_expiry_idx" ON "rap_asset" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rap_feedback_user_order_idx" ON "rap_feedback" USING btree ("user_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rap_generation_user_request_idx" ON "rap_generation" USING btree ("user_id","request_id");--> statement-breakpoint
CREATE INDEX "rap_generation_work_idx" ON "rap_generation" USING btree ("next_run_at","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rap_order_user_request_idx" ON "rap_order" USING btree ("user_id","request_id");--> statement-breakpoint
CREATE INDEX "rap_order_user_idx" ON "rap_order" USING btree ("user_id","created_at");
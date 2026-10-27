CREATE TABLE "subscription_credit_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"amount" integer NOT NULL,
	"due_at" timestamp NOT NULL,
	"granted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "payment_event" ADD COLUMN "provider_subscription_id" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "checkout_request_id" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "billing_snapshot" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "approval_url" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "locale" varchar(8);--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "next_billing_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "provider_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "provider_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "billing_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_credit_grant" ADD CONSTRAINT "subscription_credit_grant_subscription_id_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_credit_grant" ADD CONSTRAINT "subscription_credit_grant_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_credit_grant" ADD CONSTRAINT "subscription_credit_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_credit_grant_due_idx" ON "subscription_credit_grant" USING btree ("due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_user_checkout_idx" ON "subscription" USING btree ("user_id","checkout_request_id");
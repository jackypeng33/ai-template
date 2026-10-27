CREATE TABLE "billing_order" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" varchar(32) NOT NULL,
	"request_id" text NOT NULL,
	"pack_key" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(8) NOT NULL,
	"credits" integer NOT NULL,
	"merchant_id" text NOT NULL,
	"environment" varchar(16) NOT NULL,
	"locale" varchar(8) NOT NULL,
	"provider_order_id" text,
	"approval_url" text,
	"status" varchar(32) DEFAULT 'created' NOT NULL,
	"payment_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_order_provider_order_id_unique" UNIQUE("provider_order_id")
);
--> statement-breakpoint
CREATE TABLE "payment_event" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"event_type" text NOT NULL,
	"provider_order_id" text,
	"resource_id" text,
	"status" varchar(32) DEFAULT 'received' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_order" ADD CONSTRAINT "billing_order_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_order" ADD CONSTRAINT "billing_order_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_order_user_request_idx" ON "billing_order" USING btree ("user_id","request_id");--> statement-breakpoint
CREATE INDEX "billing_order_user_idx" ON "billing_order" USING btree ("user_id","created_at");
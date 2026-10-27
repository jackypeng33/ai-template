CREATE TABLE "rap_metric" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"event" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rap_metric_session_event_idx" ON "rap_metric" USING btree ("session_id","event");
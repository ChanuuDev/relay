CREATE TABLE "tasks" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"project" text DEFAULT '' NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"provider" text,
	"status" text NOT NULL,
	"board" boolean DEFAULT false NOT NULL,
	"position" double precision,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"completed_at" bigint,
	"revision" integer NOT NULL,
	CONSTRAINT "tasks_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" IN ('todo', 'doing', 'review', 'done')),
	CONSTRAINT "tasks_provider_check" CHECK ("tasks"."provider" IS NULL OR "tasks"."provider" IN ('anthropic', 'openai', 'xai', 'cursor'))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"all_day" boolean NOT NULL,
	"start_at" text NOT NULL,
	"end_at" text NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"color" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"revision" integer NOT NULL,
	CONSTRAINT "calendar_events_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "calendar_events_range_check" CHECK ("calendar_events"."end_at" >= "calendar_events"."start_at")
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "calendar_events_user_start_idx" ON "calendar_events" USING btree ("user_id","start_at");
--> statement-breakpoint
CREATE TABLE "planner_meta" (
	"user_id" text PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planner_meta" ADD CONSTRAINT "planner_meta_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"provider" text NOT NULL,
	"agent" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activity_log_user_created_idx" ON "activity_log" USING btree ("user_id","created_at");
--> statement-breakpoint
INSERT INTO "activity_log" ("user_id", "session_id", "provider", "agent", "created_at")
	SELECT s."user_id", s."id", s."provider", s."agent", u."created_at" FROM "session_updates" u JOIN "sessions" s ON s."id" = u."session_id"
	WHERE u."summary" <> '세션 첫 기록 (훅 자동 기록)' ORDER BY u."created_at", u."id";
--> statement-breakpoint
CREATE FUNCTION "relay_activity_log"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	INSERT INTO "activity_log" ("user_id", "session_id", "provider", "agent", "created_at")
		SELECT s."user_id", s."id", s."provider", s."agent", NEW."created_at" FROM "sessions" s WHERE s."id" = NEW."session_id";
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "session_updates_activity" AFTER INSERT ON "session_updates" FOR EACH ROW
	WHEN (NEW."summary" <> '세션 첫 기록 (훅 자동 기록)') EXECUTE FUNCTION "relay_activity_log"();

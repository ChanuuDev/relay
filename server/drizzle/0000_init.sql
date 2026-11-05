CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_id" text,
	"name" text NOT NULL,
	"platform" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text,
	"provider" text NOT NULL,
	"agent" text NOT NULL,
	"provider_session_id" text NOT NULL,
	"session_name" text,
	"model" text,
	"working_directory" text NOT NULL,
	"summary" text NOT NULL,
	"parent_session_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"status" text,
	"pinned" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sessions_status_check" CHECK ("sessions"."status" IS NULL OR "sessions"."status" IN ('working', 'blocked', 'handoff', 'done')),
	CONSTRAINT "sessions_parent_check" CHECK ("sessions"."parent_session_id" IS NULL OR "sessions"."parent_session_id" <> "sessions"."id")
);
--> statement-breakpoint
CREATE TABLE "session_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"summary" text NOT NULL,
	"status" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "session_updates_sequence_check" CHECK ("session_updates"."sequence" > 0),
	CONSTRAINT "session_updates_status_check" CHECK ("session_updates"."status" IS NULL OR "session_updates"."status" IN ('working', 'blocked', 'handoff', 'done'))
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"parent_id" text,
	"name" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"revision" integer NOT NULL,
	"position" double precision,
	CONSTRAINT "notes_kind_check" CHECK ("notes"."kind" IN ('folder', 'note')),
	CONSTRAINT "notes_parent_check" CHECK ("notes"."parent_id" IS NULL OR "notes"."parent_id" <> "notes"."id")
);
--> statement-breakpoint
CREATE TABLE "notes_meta" (
	"user_id" text PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calculations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expression" text NOT NULL,
	"result" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" integer NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_parent_session_id_sessions_id_fk" FOREIGN KEY ("parent_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "session_updates" ADD CONSTRAINT "session_updates_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notes_meta" ADD CONSTRAINT "notes_meta_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calculations" ADD CONSTRAINT "calculations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_hash_idx" ON "api_tokens" USING btree ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_user_provider_idx" ON "sessions" USING btree ("user_id","provider","provider_session_id");
--> statement-breakpoint
CREATE INDEX "sessions_user_updated_idx" ON "sessions" USING btree ("user_id","updated_at","id");
--> statement-breakpoint
CREATE INDEX "sessions_parent_idx" ON "sessions" USING btree ("parent_session_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "session_updates_sequence_idx" ON "session_updates" USING btree ("session_id","sequence");
--> statement-breakpoint
CREATE INDEX "notes_user_parent_idx" ON "notes" USING btree ("user_id","parent_id");
--> statement-breakpoint
CREATE INDEX "calculations_user_created_idx" ON "calculations" USING btree ("user_id","created_at","id");

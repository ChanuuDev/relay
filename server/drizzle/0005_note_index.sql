ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_id_uniq" UNIQUE("user_id","id");
--> statement-breakpoint
CREATE TABLE "note_meta" (
	"user_id" text NOT NULL,
	"note_id" text NOT NULL,
	"doc_type" text DEFAULT 'memo' NOT NULL,
	"doc_status" text,
	"project" text DEFAULT '' NOT NULL,
	"source_repo" text,
	"source_path" text,
	"source_commit" text,
	"superseded_by" text,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "note_meta_user_id_note_id_pk" PRIMARY KEY("user_id","note_id"),
	CONSTRAINT "note_meta_type_check" CHECK ("note_meta"."doc_type" IN ('memo', 'knowledge', 'design', 'decision')),
	CONSTRAINT "note_meta_status_check" CHECK ("note_meta"."doc_status" IS NULL OR "note_meta"."doc_status" IN ('draft', 'adopted', 'superseded')),
	CONSTRAINT "note_meta_superseded_check" CHECK ("note_meta"."superseded_by" IS NULL OR "note_meta"."superseded_by" <> "note_meta"."note_id")
);
--> statement-breakpoint
ALTER TABLE "note_meta" ADD CONSTRAINT "note_meta_note_fk" FOREIGN KEY ("user_id","note_id") REFERENCES "public"."notes"("user_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "note_meta" ADD CONSTRAINT "note_meta_superseded_fk" FOREIGN KEY ("user_id","superseded_by") REFERENCES "public"."notes"("user_id","id") ON DELETE SET NULL ("superseded_by") ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "note_meta_source_idx" ON "note_meta" USING btree ("user_id","source_repo","source_path") WHERE "note_meta"."source_repo" IS NOT NULL AND "note_meta"."source_path" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "note_cards" (
	"user_id" text NOT NULL,
	"note_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"summary" text NOT NULL,
	"terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "note_cards_user_id_note_id_pk" PRIMARY KEY("user_id","note_id")
);
--> statement-breakpoint
ALTER TABLE "note_cards" ADD CONSTRAINT "note_cards_note_fk" FOREIGN KEY ("user_id","note_id") REFERENCES "public"."notes"("user_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "embedding_models" (
	"user_id" text NOT NULL,
	"model_key" text NOT NULL,
	"name" text NOT NULL,
	"dimensions" integer NOT NULL,
	"prompt" text NOT NULL,
	"chunk_version" integer NOT NULL,
	"floor" double precision DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "embedding_models_user_id_model_key_pk" PRIMARY KEY("user_id","model_key")
);
--> statement-breakpoint
ALTER TABLE "embedding_models" ADD CONSTRAINT "embedding_models_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "embedding_models_active_idx" ON "embedding_models" USING btree ("user_id") WHERE "embedding_models"."active";
--> statement-breakpoint
CREATE TABLE "note_index" (
	"user_id" text NOT NULL,
	"note_id" text NOT NULL,
	"model_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"content_hash" text NOT NULL,
	"chunk_count" integer NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" bigint DEFAULT 0 NOT NULL,
	"lease_token" text,
	"lease_until" bigint DEFAULT 0 NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "note_index_user_id_note_id_model_key_pk" PRIMARY KEY("user_id","note_id","model_key"),
	CONSTRAINT "note_index_status_check" CHECK ("note_index"."status" IN ('ready', 'failed', 'pending'))
);
--> statement-breakpoint
ALTER TABLE "note_index" ADD CONSTRAINT "note_index_note_fk" FOREIGN KEY ("user_id","note_id") REFERENCES "public"."notes"("user_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "note_index" ADD CONSTRAINT "note_index_model_fk" FOREIGN KEY ("user_id","model_key") REFERENCES "public"."embedding_models"("user_id","model_key") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "note_index_model_idx" ON "note_index" USING btree ("user_id","model_key");
--> statement-breakpoint
CREATE TABLE "note_chunks" (
	"user_id" text NOT NULL,
	"note_id" text NOT NULL,
	"model_key" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"heading_path" text DEFAULT '' NOT NULL,
	"line_start" integer NOT NULL,
	"line_end" integer NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"chunk_hash" text NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" bytea NOT NULL,
	CONSTRAINT "note_chunks_user_id_note_id_model_key_chunk_index_pk" PRIMARY KEY("user_id","note_id","model_key","chunk_index")
);
--> statement-breakpoint
ALTER TABLE "note_chunks" ADD CONSTRAINT "note_chunks_note_fk" FOREIGN KEY ("user_id","note_id") REFERENCES "public"."notes"("user_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "note_chunks" ADD CONSTRAINT "note_chunks_model_fk" FOREIGN KEY ("user_id","model_key") REFERENCES "public"."embedding_models"("user_id","model_key") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "note_chunks_model_idx" ON "note_chunks" USING btree ("user_id","model_key");
--> statement-breakpoint
CREATE TABLE "note_semantic_links" (
	"user_id" text NOT NULL,
	"model_key" text NOT NULL,
	"source_note_id" text NOT NULL,
	"target_note_id" text NOT NULL,
	"score" double precision NOT NULL,
	"strength" double precision NOT NULL,
	"source_heading" text DEFAULT '' NOT NULL,
	"source_start" integer NOT NULL,
	"source_end" integer NOT NULL,
	"target_heading" text DEFAULT '' NOT NULL,
	"target_start" integer NOT NULL,
	"target_end" integer NOT NULL,
	CONSTRAINT "note_semantic_links_pk" PRIMARY KEY("user_id","model_key","source_note_id","target_note_id"),
	CONSTRAINT "note_semantic_links_pair_check" CHECK ("note_semantic_links"."source_note_id" <> "note_semantic_links"."target_note_id")
);
--> statement-breakpoint
ALTER TABLE "note_semantic_links" ADD CONSTRAINT "note_semantic_links_source_fk" FOREIGN KEY ("user_id","source_note_id") REFERENCES "public"."notes"("user_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "note_semantic_links" ADD CONSTRAINT "note_semantic_links_target_fk" FOREIGN KEY ("user_id","target_note_id") REFERENCES "public"."notes"("user_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "note_semantic_links" ADD CONSTRAINT "note_semantic_links_model_fk" FOREIGN KEY ("user_id","model_key") REFERENCES "public"."embedding_models"("user_id","model_key") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "note_semantic_links_target_idx" ON "note_semantic_links" USING btree ("user_id","model_key","target_note_id");
--> statement-breakpoint
CREATE TABLE "note_link_dismissals" (
	"user_id" text NOT NULL,
	"a_note_id" text NOT NULL,
	"b_note_id" text NOT NULL,
	"dismissed_at" bigint NOT NULL,
	CONSTRAINT "note_link_dismissals_pk" PRIMARY KEY("user_id","a_note_id","b_note_id"),
	CONSTRAINT "note_link_dismissals_order_check" CHECK ("note_link_dismissals"."a_note_id" < "note_link_dismissals"."b_note_id")
);
--> statement-breakpoint
ALTER TABLE "note_link_dismissals" ADD CONSTRAINT "note_link_dismissals_a_fk" FOREIGN KEY ("user_id","a_note_id") REFERENCES "public"."notes"("user_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "note_link_dismissals" ADD CONSTRAINT "note_link_dismissals_b_fk" FOREIGN KEY ("user_id","b_note_id") REFERENCES "public"."notes"("user_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "note_index_meta" (
	"user_id" text PRIMARY KEY NOT NULL,
	"docs" integer DEFAULT 0 NOT NULL,
	"idx" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_index_meta" ADD CONSTRAINT "note_index_meta_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

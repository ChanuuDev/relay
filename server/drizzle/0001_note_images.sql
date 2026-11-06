CREATE TABLE "note_images" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"type" text NOT NULL,
	"size" integer NOT NULL,
	"data" bytea NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "note_images_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "note_images_id_check" CHECK (length("note_images"."id") = 64)
);
--> statement-breakpoint
ALTER TABLE "note_images" ADD CONSTRAINT "note_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

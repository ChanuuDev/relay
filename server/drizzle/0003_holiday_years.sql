CREATE TABLE "holiday_years" (
	"year" integer PRIMARY KEY NOT NULL,
	"items" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL
);

ALTER TABLE "tasks" DROP CONSTRAINT "tasks_provider_check";
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_provider_check" CHECK ("tasks"."provider" IS NULL OR "tasks"."provider" IN ('anthropic', 'openai', 'xai', 'cursor', 'google'));
-- Add Unsplash cover payload column to `project` and `task`.
-- Stored as JSON text, nullable, mutually exclusive with `cover_image_key`.
-- See src/shared/schemas/unsplash.ts for the payload shape.
ALTER TABLE `project` ADD `cover_unsplash` text;--> statement-breakpoint
ALTER TABLE `task` ADD `cover_unsplash` text;

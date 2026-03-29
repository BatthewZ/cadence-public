DROP INDEX `workspace_slug_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_owner_slug_unique` ON `workspace` (`ownerId`,`slug`);
-- Rebuild `task_activity` so `apiTokenId` is SET NULL on token delete, as the
-- schema declares. 0028 added the column with `ALTER TABLE ... ADD`, and
-- drizzle-kit omitted the ON DELETE clause, leaving NO ACTION: deleting a
-- token (directly, or via the user → api_token cascade) failed while any
-- activity row still pointed at it.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_task_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`taskId` text NOT NULL,
	`actorId` text,
	`action` text NOT NULL,
	`field` text,
	`oldValue` text,
	`newValue` text,
	`apiTokenId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`taskId`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`apiTokenId`) REFERENCES `api_token`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
INSERT INTO `__new_task_activity`("id", "taskId", "actorId", "action", "field", "oldValue", "newValue", "apiTokenId", "createdAt") SELECT "id", "taskId", "actorId", "action", "field", "oldValue", "newValue", "apiTokenId", "createdAt" FROM `task_activity`;--> statement-breakpoint
DROP TABLE `task_activity`;--> statement-breakpoint
ALTER TABLE `__new_task_activity` RENAME TO `task_activity`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `task_activity_task_idx` ON `task_activity` (`taskId`,`createdAt`);

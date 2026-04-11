PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_webhook` (
	`id` text PRIMARY KEY NOT NULL,
	`workspaceId` text NOT NULL,
	`projectId` text,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`consecutiveFailures` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_webhook`("id", "workspaceId", "projectId", "name", "url", "secret", "events", "active", "consecutiveFailures", "createdAt", "updatedAt") SELECT "id", "workspaceId", "projectId", "name", "url", "secret", "events", "active", "consecutiveFailures", "createdAt", "updatedAt" FROM `webhook`;--> statement-breakpoint
DROP TABLE `webhook`;--> statement-breakpoint
ALTER TABLE `__new_webhook` RENAME TO `webhook`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `webhook_workspace_idx` ON `webhook` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `webhook_workspace_active_idx` ON `webhook` (`workspaceId`,`active`);--> statement-breakpoint
CREATE INDEX `webhook_project_idx` ON `webhook` (`projectId`);

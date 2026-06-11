CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`workspaceId` text NOT NULL,
	`actorUserId` text NOT NULL,
	`apiTokenId` text,
	`resourceType` text NOT NULL,
	`resourceId` text,
	`action` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`status` integer NOT NULL,
	`metadata` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actorUserId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`apiTokenId`) REFERENCES `api_token`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_workspace_idx` ON `audit_log` (`workspaceId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `audit_log_token_idx` ON `audit_log` (`apiTokenId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `audit_log_resource_idx` ON `audit_log` (`resourceType`,`resourceId`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actorUserId`,`createdAt`);
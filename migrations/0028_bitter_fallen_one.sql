CREATE TABLE `api_token` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`workspaceId` text NOT NULL,
	`name` text NOT NULL,
	`tokenHash` text NOT NULL,
	`tokenPrefix` text NOT NULL,
	`scopes` text NOT NULL,
	`projectScope` text NOT NULL,
	`projectIds` text,
	`lastUsedAt` integer,
	`expiresAt` integer,
	`revokeAt` integer,
	`revokedAt` integer,
	`rotatedToId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rotatedToId`) REFERENCES `api_token`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_token_tokenHash_unique` ON `api_token` (`tokenHash`);--> statement-breakpoint
CREATE INDEX `api_token_user_idx` ON `api_token` (`userId`);--> statement-breakpoint
CREATE INDEX `api_token_workspace_idx` ON `api_token` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `api_token_revoke_at_idx` ON `api_token` (`revokeAt`);--> statement-breakpoint
ALTER TABLE `task_activity` ADD `apiTokenId` text REFERENCES api_token(id);
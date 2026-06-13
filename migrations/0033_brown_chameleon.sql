CREATE TABLE `calendar_feed_token` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`workspaceId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`createdAt` integer NOT NULL,
	`lastUsedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feed_token_tokenHash_unique` ON `calendar_feed_token` (`tokenHash`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feed_token_user_workspace_unique` ON `calendar_feed_token` (`userId`,`workspaceId`);
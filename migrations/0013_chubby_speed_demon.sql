CREATE TABLE `webhook` (
	`id` text PRIMARY KEY NOT NULL,
	`workspaceId` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`consecutiveFailures` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_workspace_idx` ON `webhook` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `webhook_workspace_active_idx` ON `webhook` (`workspaceId`,`active`);--> statement-breakpoint
CREATE TABLE `webhook_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`webhookId` text NOT NULL,
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`statusCode` integer,
	`response` text,
	`success` integer NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`maxAttempts` integer DEFAULT 5 NOT NULL,
	`nextRetryAt` integer,
	`createdAt` integer NOT NULL,
	`lastAttemptAt` integer NOT NULL,
	FOREIGN KEY (`webhookId`) REFERENCES `webhook`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_delivery_webhook_created_idx` ON `webhook_delivery` (`webhookId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `webhook_delivery_success_retry_idx` ON `webhook_delivery` (`success`,`nextRetryAt`);
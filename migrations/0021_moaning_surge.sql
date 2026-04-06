CREATE TABLE `legal_acceptance` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`tosVersion` text NOT NULL,
	`acceptedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `legal_acceptance_user_idx` ON `legal_acceptance` (`userId`);
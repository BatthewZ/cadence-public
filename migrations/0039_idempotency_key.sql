CREATE TABLE `idempotency_key` (
	`userId` text NOT NULL,
	`key` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` integer,
	`responseBody` text,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`userId`, `key`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idempotency_key_created_idx` ON `idempotency_key` (`createdAt`);

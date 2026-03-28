PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_upload` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text,
	`key` text NOT NULL,
	`filename` text NOT NULL,
	`mimeType` text NOT NULL,
	`size` integer NOT NULL,
	`purpose` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_upload`("id", "userId", "key", "filename", "mimeType", "size", "purpose", "createdAt") SELECT "id", "userId", "key", "filename", "mimeType", "size", "purpose", "createdAt" FROM `upload`;--> statement-breakpoint
DROP TABLE `upload`;--> statement-breakpoint
ALTER TABLE `__new_upload` RENAME TO `upload`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `upload_user_idx` ON `upload` (`userId`);
CREATE TABLE `task_attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`taskId` text NOT NULL,
	`uploadId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`taskId`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploadId`) REFERENCES `upload`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_attachment_task_idx` ON `task_attachment` (`taskId`,`createdAt`);
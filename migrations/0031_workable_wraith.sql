CREATE TABLE `saved_view` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`creatorId` text NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`position` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creatorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saved_view_project_creator_idx` ON `saved_view` (`projectId`,`creatorId`);--> statement-breakpoint
CREATE UNIQUE INDEX `saved_view_project_creator_name_idx` ON `saved_view` (`projectId`,`creatorId`,`name`);
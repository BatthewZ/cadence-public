CREATE TABLE `label` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `label_project_name_idx` ON `label` (`projectId`,`name`);--> statement-breakpoint
CREATE TABLE `task_label` (
	`id` text PRIMARY KEY NOT NULL,
	`taskId` text NOT NULL,
	`labelId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`taskId`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`labelId`) REFERENCES `label`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_label_task_label_idx` ON `task_label` (`taskId`,`labelId`);--> statement-breakpoint
CREATE INDEX `task_label_label_idx` ON `task_label` (`labelId`);
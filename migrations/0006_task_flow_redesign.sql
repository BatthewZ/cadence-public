ALTER TABLE `task_group` ADD `is_completion_group` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `completed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `completedAt` integer;--> statement-breakpoint
ALTER TABLE `task` ADD `completedBy` text REFERENCES user(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE TABLE `task_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`taskId` text NOT NULL REFERENCES task(id) ON DELETE CASCADE,
	`actorId` text REFERENCES user(id) ON DELETE SET NULL,
	`action` text NOT NULL,
	`field` text,
	`oldValue` text,
	`newValue` text,
	`createdAt` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `task_activity_task_idx` ON `task_activity` (`taskId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `task_project_completed_idx` ON `task` (`projectId`,`completed`);--> statement-breakpoint
UPDATE `task_group` SET `is_completion_group` = 1 WHERE `name` = 'Done';--> statement-breakpoint
UPDATE `task` SET `completed` = 1, `completedAt` = `updatedAt` WHERE `status` = 'completed' OR `status` = 'cancelled';--> statement-breakpoint
DROP INDEX IF EXISTS `task_project_status_idx`;--> statement-breakpoint
ALTER TABLE `task` DROP COLUMN `status`;

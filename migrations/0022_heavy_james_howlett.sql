DROP INDEX `comment_task_idx`;--> statement-breakpoint
CREATE INDEX `comment_task_created_idx` ON `comment` (`taskId`,`createdAt`);
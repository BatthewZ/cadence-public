ALTER TABLE `task` ADD `source_uid` text;--> statement-breakpoint
CREATE UNIQUE INDEX `task_project_source_uid_unique_idx` ON `task` (`projectId`,`source_uid`) WHERE source_uid IS NOT NULL;
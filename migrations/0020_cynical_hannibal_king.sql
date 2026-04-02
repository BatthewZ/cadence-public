ALTER TABLE `task` ADD `recurrence_rule` text;--> statement-breakpoint
ALTER TABLE `task` ADD `recurrence_parent_id` text REFERENCES task(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `recurrence_series_id` text;--> statement-breakpoint
CREATE INDEX `task_recurrence_parent_idx` ON `task` (`recurrence_parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_recurrence_parent_unique_idx` ON `task` (`recurrence_parent_id`) WHERE recurrence_parent_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `task_recurrence_series_idx` ON `task` (`recurrence_series_id`);
CREATE INDEX `project_workspace_updated_idx` ON `project` (`workspaceId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `task_project_updated_idx` ON `task` (`projectId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `task_group_project_updated_idx` ON `task_group` (`projectId`,`updatedAt`);
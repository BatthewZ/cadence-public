CREATE INDEX `comment_task_idx` ON `comment` (`taskId`);--> statement-breakpoint
CREATE INDEX `subtask_task_idx` ON `subtask` (`taskId`);--> statement-breakpoint
CREATE INDEX `team_workspace_idx` ON `team` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `upload_user_idx` ON `upload` (`userId`);
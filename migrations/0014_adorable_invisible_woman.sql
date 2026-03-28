DROP INDEX `invitation_workspace_idx`;--> statement-breakpoint
DROP INDEX `invitation_email_idx`;--> statement-breakpoint
CREATE INDEX `invitation_workspace_status_idx` ON `invitation` (`workspaceId`,`status`);--> statement-breakpoint
CREATE INDEX `invitation_email_status_expires_idx` ON `invitation` (`email`,`status`,`expiresAt`);--> statement-breakpoint
DROP INDEX `task_assignee_due_idx`;--> statement-breakpoint
CREATE INDEX `task_assignee_completed_due_idx` ON `task` (`assigneeId`,`completed`,`dueDate`);--> statement-breakpoint
CREATE INDEX `task_project_assignee_idx` ON `task` (`projectId`,`assigneeId`);--> statement-breakpoint
CREATE INDEX `task_project_due_completed_idx` ON `task` (`projectId`,`dueDate`,`completed`);
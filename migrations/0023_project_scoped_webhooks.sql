ALTER TABLE `webhook` ADD `projectId` text REFERENCES project(id);--> statement-breakpoint
CREATE INDEX `webhook_project_idx` ON `webhook` (`projectId`);
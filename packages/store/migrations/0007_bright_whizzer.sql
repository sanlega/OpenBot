ALTER TABLE `delegations` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `delegations` ADD `depth` integer;--> statement-breakpoint
CREATE INDEX `delegations_parent_idx` ON `delegations` (`parent_id`);
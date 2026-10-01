CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`bot_id` text NOT NULL,
	`tier` text NOT NULL,
	`content` text NOT NULL,
	`source_chain_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`forgotten_at` integer
);
--> statement-breakpoint
CREATE INDEX `memories_bot_id_idx` ON `memories` (`bot_id`);--> statement-breakpoint
CREATE INDEX `memories_scope_idx` ON `memories` (`scope`);
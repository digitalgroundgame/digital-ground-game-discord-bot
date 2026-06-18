CREATE TABLE IF NOT EXISTS `content_override` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`field` text NOT NULL,
	`value` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `content_override_key_field_uq` ON `content_override` (`key`,`field`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `linked_account` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`discord_user_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`email` text,
	`display_name` text,
	`linked_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`discord_user_id`) REFERENCES `user`(`discord_user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `linked_account_user_provider_uq` ON `linked_account` (`discord_user_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `linked_account_provider_external_uq` ON `linked_account` (`provider`,`external_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user` (
	`discord_user_id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);

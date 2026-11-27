CREATE TABLE `admins` (
	`slot` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "one_admin" CHECK("admins"."slot"=1)
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`details` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`order_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`returned` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`order_id`, `variant_id`),
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "item_quantities" CHECK("order_items"."quantity">0 AND "order_items"."returned">=0 AND "order_items"."returned"<="order_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`request_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`session_id` text,
	`payment_intent` text,
	`amount_cents` integer NOT NULL,
	`shipping_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`refund_cents` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`scope`) REFERENCES `stock_state`(`scope`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_amounts" CHECK("orders"."amount_cents">0 AND "orders"."refund_cents">=0 AND "orders"."refund_cents"<="orders"."amount_cents")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_request` ON `orders` (`scope`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_session` ON `orders` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_payment` ON `orders` (`payment_intent`);--> statement-breakpoint
CREATE TABLE `stock_state` (
	`scope` text PRIMARY KEY NOT NULL,
	`initialized` integer DEFAULT 0 NOT NULL,
	`reported_total` integer,
	`reported_at` text,
	`verified_at` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "scope_valid" CHECK("stock_state"."scope" IN ('real','test'))
);
--> statement-breakpoint
CREATE TABLE `stripe_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`object_id` text NOT NULL,
	`processed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `variants` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`color` text NOT NULL,
	`size` text NOT NULL,
	`available` integer NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_operation` text,
	FOREIGN KEY (`scope`) REFERENCES `stock_state`(`scope`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stock_nonnegative" CHECK("variants"."available">=0 AND "variants"."reserved">=0),
	CONSTRAINT "enabled_boolean" CHECK("variants"."enabled" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variant_color_size` ON `variants` (`scope`,`color`,`size`);
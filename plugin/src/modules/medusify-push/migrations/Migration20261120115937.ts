import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261120115937 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "medusify_stock_alert" drop constraint if exists "medusify_stock_alert_subscription_id_inventory_item_id_unique";`);
    this.addSql(`alter table if exists "medusify_operation" drop constraint if exists "medusify_operation_key_unique";`);
    this.addSql(`create table if not exists "medusify_operation" ("id" text not null, "key" text not null, "kind" text not null, "result" jsonb not null, "undone" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "medusify_operation_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_medusify_operation_key_unique" ON "medusify_operation" ("key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_medusify_operation_deleted_at" ON "medusify_operation" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "medusify_stock_alert" ("id" text not null, "subscription_id" text not null, "inventory_item_id" text not null, "last_sent_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "medusify_stock_alert_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_medusify_stock_alert_deleted_at" ON "medusify_stock_alert" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_medusify_stock_alert_subscription_id_inventory_item_id_unique" ON "medusify_stock_alert" ("subscription_id", "inventory_item_id") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "medusify_push_subscription" add column if not exists "low_stock_threshold" integer not null default 5;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "medusify_operation" cascade;`);

    this.addSql(`drop table if exists "medusify_stock_alert" cascade;`);

    this.addSql(`alter table if exists "medusify_push_subscription" drop column if exists "low_stock_threshold";`);
  }

}

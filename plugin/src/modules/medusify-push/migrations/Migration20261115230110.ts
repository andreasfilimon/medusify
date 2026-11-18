import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261115230110 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "medusify_push_subscription" drop constraint if exists "medusify_push_subscription_endpoint_unique";`);
    this.addSql(`create table if not exists "medusify_push_subscription" ("id" text not null, "endpoint" text not null, "p256dh" text not null, "auth" text not null, "user_id" text not null, "user_agent" text null, "last_success_at" timestamptz null, "failure_count" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "medusify_push_subscription_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_medusify_push_subscription_endpoint_unique" ON "medusify_push_subscription" ("endpoint") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_medusify_push_subscription_user_id" ON "medusify_push_subscription" ("user_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_medusify_push_subscription_deleted_at" ON "medusify_push_subscription" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "medusify_push_subscription" cascade;`);
  }

}

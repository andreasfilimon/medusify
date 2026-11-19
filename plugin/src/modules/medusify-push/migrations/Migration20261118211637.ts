import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261118211637 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "medusify_push_subscription" add column if not exists "disabled_kinds" text[] not null default '{}';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "medusify_push_subscription" drop column if exists "disabled_kinds";`);
  }

}

import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261121104748 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "medusify_push_subscription" add column if not exists "daily_summary_hour" integer null, add column if not exists "daily_summary_tz" text null, add column if not exists "daily_summary_sent_on" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "medusify_push_subscription" drop column if exists "daily_summary_hour", drop column if exists "daily_summary_tz", drop column if exists "daily_summary_sent_on";`);
  }

}

import { model } from "@medusajs/framework/utils"

/**
 * When a device was last told about low stock of an inventory item. At most one message per device and item in 24
 * hours: the claim is one `INSERT ... ON CONFLICT DO UPDATE ... WHERE` (lib/low-stock.ts), so parallel events or several
 * backend processes cannot both win.
 */
const StockAlert = model
  .define(
    { name: "MedusifyStockAlert", tableName: "medusify_stock_alert" },
    {
      id: model.id({ prefix: "msal" }).primaryKey(),
      subscription_id: model.text(),
      inventory_item_id: model.text(),
      last_sent_at: model.dateTime(),
    }
  )
  .indexes([{ on: ["subscription_id", "inventory_item_id"], unique: true }])

export default StockAlert

import { model } from "@medusajs/framework/utils"

/**
 * One finished write of the app that must not run twice: a stock change, a quick-created product. The app makes a key
 * per tap and sends it again unchanged when the answer was lost; the second request finds the row and answers with the
 * stored result instead of writing again. Rows older than a few days are removed on the next write.
 */
const Operation = model.define(
  { name: "MedusifyOperation", tableName: "medusify_operation" },
  {
    id: model.id({ prefix: "mop" }).primaryKey(),
    key: model.text().unique(),
    kind: model.text(),
    /** What the first request answered with (and, for a stock change, what was applied, so "undo" can reverse it). */
    result: model.json(),
    /** The change was taken back by an undo. */
    undone: model.boolean().default(false),
  }
)

export default Operation

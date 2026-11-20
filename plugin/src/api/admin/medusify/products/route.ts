import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../../../../constants"
import { listProducts } from "../../../../lib/catalog"
import { stockAccess } from "../../../../lib/rbac"
import type { MedusifyPushModuleService } from "../../../../modules/medusify-push"
import { quickCreateProductWorkflow } from "../../../../workflows/quick-create-product"
import type { GetProductsQuery, PostProduct } from "../validators"

/** GET /admin/medusify/products?q=&status=&offset=&limit= — products with price, stock per location and status, by title. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = req.validatedQuery as unknown as GetProductsQuery
  const page = await listProducts(req.scope, { q: query.q, status: query.status, offset: query.offset, limit: query.limit }, await stockAccess(req))
  res.json({ ...page, offset: query.offset, limit: query.limit })
}

type Locking = { execute<R>(keys: string | string[], job: () => Promise<R>, args?: { timeout?: number; expire?: number }): Promise<R> }

/**
 * POST /admin/medusify/products — quick create: one product, one variant, price, photo and stock at one location.
 * The key makes a repeat (a second tap, a retry after a lost answer) answer with the same product: 200 with `replayed`,
 * the first answer is 201.
 */
export async function POST(req: AuthenticatedMedusaRequest<PostProduct>, res: MedusaResponse) {
  const body = req.validatedBody
  const locking = req.scope.resolve(Modules.LOCKING) as unknown as Locking
  const push: MedusifyPushModuleService = req.scope.resolve(MEDUSIFY_PUSH_MODULE)
  const done = await locking.execute(
    [`medusify-product:${body.idempotency_key}`],
    async () => {
      const [again] = await push.listMedusifyOperations({ key: body.idempotency_key, kind: "product" }, { take: 1 })
      if (again) return { ...(again.result as { product_id: string; variant_id: string }), replayed: true }
      const { result } = await quickCreateProductWorkflow(req.scope).run({
        input: {
          key: body.idempotency_key,
          title: body.title,
          status: body.status,
          currency_code: body.price.currency_code,
          amount: body.price.amount,
          location_id: body.stock.location_id,
          quantity: body.stock.quantity,
          image_url: body.image_url,
        },
      })
      return { product_id: result.product_id, variant_id: result.variant_id, replayed: false }
    },
    { timeout: 60, expire: 120 }
  )
  res.status(done.replayed ? 200 : 201).json(done)
}

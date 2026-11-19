import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

/** Where the app's key and the content it belongs to are kept: on the return itself, so a repeat finds it. */
export const IDEMPOTENCY_KEY_FIELD = "medusify_idempotency_key"
export const IDEMPOTENCY_FINGERPRINT_FIELD = "medusify_fingerprint"

export type ReturnContent = { items: { id: string; quantity: number }[]; refund_amount?: number }

/** The same content gives the same string, whatever the order of the items. */
export function fingerprintOf(content: ReturnContent): string {
  const items = [...content.items]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((i) => `${i.id}x${i.quantity}`)
    .join(",")
  return `${items}|${content.refund_amount ?? 0}`
}

type ReturnRow = { id: string; status?: string | null; metadata?: Record<string, unknown> | null }

/**
 * The return an earlier request with this key made, if any. A canceled return does not count: Medusa's own rollback
 * cancels what a failed run left behind, and then the key is free again.
 */
export function replayOf(returns: ReturnRow[], key: string): { returnId: string; fingerprint: string | null } | null {
  const hit = returns.find((r) => r.status !== "canceled" && r.metadata?.[IDEMPOTENCY_KEY_FIELD] === key)
  if (!hit) return null
  const fingerprint = hit.metadata?.[IDEMPOTENCY_FINGERPRINT_FIELD]
  return { returnId: hit.id, fingerprint: typeof fingerprint === "string" ? fingerprint : null }
}

/** How long a second request waits for the first one with the same key, and when a lost lock frees itself. */
const LOCK_WAIT_SECONDS = 60
const LOCK_EXPIRE_SECONDS = 180

export type Once<T> = { replayed: false; value: T } | { replayed: true; returnId: string }

type Locking = {
  execute<R>(keys: string | string[], job: () => Promise<R>, args?: { timeout?: number; expire?: number }): Promise<R>
}

/**
 * Runs `create` at most once per key and order. A second request with the same key either waits for the first one and
 * is then answered with its return (`replayed`), or, when the first one failed and rolled back, runs itself. The same
 * key with other content is a conflict: it is a bug in the caller, and writing a second return would hide it.
 */
export async function once<T>(
  container: MedusaContainer,
  input: { orderId: string; key: string; content: ReturnContent },
  create: () => Promise<T>
): Promise<Once<T>> {
  const locking = container.resolve(Modules.LOCKING) as unknown as Locking
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  return locking.execute(
    [`medusify-return:${input.orderId}:${input.key}`],
    async (): Promise<Once<T>> => {
      const { data } = await query.graph({
        entity: "return",
        fields: ["id", "status", "metadata"],
        filters: { order_id: input.orderId },
      })
      const hit = replayOf(data as ReturnRow[], input.key)
      if (hit) {
        if (hit.fingerprint !== fingerprintOf(input.content)) {
          throw new MedusaError(MedusaError.Types.CONFLICT, "This key was used for a different return.")
        }
        return { replayed: true, returnId: hit.returnId }
      }
      return { replayed: false, value: await create() }
    },
    { timeout: LOCK_WAIT_SECONDS, expire: LOCK_EXPIRE_SECONDS }
  )
}

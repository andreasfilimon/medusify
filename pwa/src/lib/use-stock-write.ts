import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useRef } from "react"
import * as api from "./api"
import type { Shop } from "./types"

/**
 * Writes stock changes with an idempotency key that outlives one tap. The same change (same item, place and amount) keeps
 * its key until it is settled, so tapping "Speichern" again after a lost answer is the same request for the shop, which
 * answers a repeat without booking twice. Another amount is another change and gets a new key, and so is the same amount
 * from another starting number: once the first change was booked the shop shows the new number, and a later "+1" from
 * there is a new change, not a repeat the shop would answer without booking. "Verwerfen" forgets the keys of the place.
 */
export function useStockWrite(shop: Shop) {
  const qc = useQueryClient()
  const keys = useRef(new Map<string, string>())
  const write = useCallback(
    async (inventoryItemId: string, locationId: string, delta: number, from: number): Promise<api.StockAnswer> => {
      const content = `${inventoryItemId}|${locationId}|${from}|${delta}`
      let key = keys.current.get(content)
      if (!key) {
        key = crypto.randomUUID()
        keys.current.set(content, key)
      }
      try {
        const answer = await api.changeStock(shop, { mode: "adjust", inventory_item_id: inventoryItemId, location_id: locationId, quantity: delta, idempotency_key: key })
        keys.current.delete(content)
        await Promise.all([qc.invalidateQueries({ queryKey: ["product"] }), qc.invalidateQueries({ queryKey: ["products"] })])
        return answer
      } catch (err) {
        // A clear refusal settles the change; anything else may have been booked, so the key stays for the next tap.
        const f = api.catalogFailure(err)
        if (f.kind === "rejected" || f.kind === "forbidden" || f.kind === "old" || f.kind === "auth") keys.current.delete(content)
        throw err
      }
    },
    [shop, qc],
  )
  /** The change was given up: its key must not answer a later change of the same size, which would then not be booked. */
  const forget = useCallback(
    (inventoryItemId: string, locationId: string) => {
      for (const content of [...keys.current.keys()]) if (content.startsWith(`${inventoryItemId}|${locationId}|`)) keys.current.delete(content)
      // A lost answer may have been booked after all: show the shop's number again.
      void qc.invalidateQueries({ queryKey: ["product"] })
    },
    [qc],
  )
  return { write, forget }
}

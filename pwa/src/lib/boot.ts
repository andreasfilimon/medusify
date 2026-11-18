import { prefs } from "./prefs"
import { shopIdFromOrigin } from "./shops"
import type { ShopStore } from "./store"
import type { Shop } from "./types"

/**
 * Loads the saved shops and moves ids written by the first version ("shop-example-com") to the origin based id.
 * Token, push state, colour and name stay. The selected shop in the preferences follows. The list is written back once,
 * so the next start finds nothing to do. An entry whose url cannot be read keeps its id.
 */
export async function loadShopsMigrated(store: ShopStore): Promise<Shop[]> {
  const stored = await store.loadShops()
  const renamed = new Map<string, string>()
  const next = stored.map((shop) => {
    let id: string
    try {
      id = shopIdFromOrigin(shop.url)
    } catch {
      return shop
    }
    if (id === shop.id) return shop
    renamed.set(shop.id, id)
    return { ...shop, id }
  })
  if (renamed.size === 0) return stored
  await store.saveShops(next)
  const scope = prefs.scope()
  const moved = scope ? renamed.get(scope) : undefined
  if (moved) prefs.setScope(moved)
  return next
}

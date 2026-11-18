import { unregisterEverywhere, type PushApi } from "./push"
import type { ShopStore } from "./store"
import type { Shop } from "./types"

export interface SessionDeps {
  push: PushApi
  /** Ends the cookie session of the home shop (DELETE /auth/session). */
  endSession(shop: Shop): Promise<void>
  store: ShopStore
  /** Endpoint of this browser's push subscription, null if there is none. */
  currentEndpoint(): Promise<string | null>
  /** Cancels the browser-side push subscription. */
  unsubscribeLocal(): Promise<void>
  /** Drops what the app keeps outside the store (selected shop). Display preferences stay. */
  clearSessionPrefs(): void
}

export type LogoutResult = {
  /** Shops where the push subscription could not be removed (offline, rejected). It still exists there. */
  pushStillAt: Shop[]
  /** True if the home session could not be ended on the server (the cookie then expires on its own). */
  sessionStillOpen: boolean
}

/**
 * Logout order matters: the push subscription is removed while the credentials still exist, then the
 * home session ends, then everything on the device is deleted, then the browser subscription is cancelled.
 * An unreachable shop never blocks the local wipe; it is reported so the user knows what remains.
 */
export async function logoutAll(shops: Shop[], deps: SessionDeps): Promise<LogoutResult> {
  // If the endpoint cannot be read (service worker not ready) nothing was removed anywhere: report every shop
  // that holds a subscription. The sign-out itself still runs through.
  let endpoint: string | null = null
  let endpointUnknown = false
  try {
    endpoint = await deps.currentEndpoint()
  } catch {
    endpointUnknown = true
  }
  const failedIds = endpointUnknown ? shops.filter((s) => s.pushRegistered).map((s) => s.id) : await unregisterEverywhere(shops, endpoint, deps.push)
  const home = shops.find((s) => s.home)
  let sessionStillOpen = false
  if (home) {
    try {
      await deps.endSession(home)
    } catch {
      sessionStillOpen = true
    }
  }
  await deps.store.clear()
  deps.clearSessionPrefs()
  // Not when the service worker was already unreachable: this would wait for it a second time.
  if (!endpointUnknown) await deps.unsubscribeLocal().catch(() => undefined)
  return { pushStillAt: shops.filter((s) => failedIds.includes(s.id)), sessionStillOpen }
}

/** Removes one foreign shop: its push registration goes first, then its token with the shop record. */
export async function removeForeignShop(shop: Shop, shops: Shop[], deps: Pick<SessionDeps, "push" | "store" | "currentEndpoint">): Promise<{ pushLeft: boolean; shops: Shop[] }> {
  const endpoint = await deps.currentEndpoint().catch(() => null)
  const failed = await unregisterEverywhere([shop], endpoint, deps.push)
  const rest = shops.filter((s) => s.id !== shop.id)
  await deps.store.saveShops(rest)
  return { pushLeft: failed.length > 0, shops: rest }
}

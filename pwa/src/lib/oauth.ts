/**
 * Browser side of the Google sign-in (Medusa third-party flow). Pure helpers, no network.
 *
 * The OAuth state that Medusa hands out is remembered in sessionStorage for the one round trip and compared on the
 * way back. Without that comparison anybody could feed this browser a callback link of their own and sign it in
 * as them (login CSRF). sessionStorage holds a single-use random value, never a credential.
 */
const STATE_KEY = "medusify.oauth.state"

export const GOOGLE_CALLBACK_PATH = "/medusify/auth/google"

export function callbackUrl(origin: string): string {
  return `${origin}${GOOGLE_CALLBACK_PATH}`
}

/** The state parameter of the location Medusa returned (Google's authorization URL, or the stand-in's). */
export function stateFromLocation(location: string): string | null {
  try {
    return new URL(location).searchParams.get("state")
  } catch {
    return null
  }
}

export function rememberState(state: string, storage: Pick<Storage, "setItem"> = sessionStorage) {
  storage.setItem(STATE_KEY, state)
}

/** Reads and deletes in one step: a state can only be redeemed once. */
export function takeState(storage: Pick<Storage, "getItem" | "removeItem"> = sessionStorage): string | null {
  const value = storage.getItem(STATE_KEY)
  storage.removeItem(STATE_KEY)
  return value
}

export type CallbackParams = { code: string | null; state: string | null; error: string | null }

/** Parameters of a return from Google, or null when the page was not opened by one. */
export function readCallback(pathname: string, search: string): CallbackParams | null {
  if (pathname !== GOOGLE_CALLBACK_PATH) return null
  const q = new URLSearchParams(search)
  return { code: q.get("code"), state: q.get("state"), error: q.get("error") }
}

/** Claims of a JWT, read without verifying: the shop verifies, the app only needs to know whether an admin is attached. */
export function jwtClaims(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1] ?? ""
    const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4)
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** A Google login of an account the shop does not know yields a token with an empty actor. It must not start a session. */
export function hasAdminActor(token: string): boolean {
  const id = jwtClaims(token).actor_id
  return typeof id === "string" && id.length > 0
}

/** Takes the code out of the address bar and the history before anything else runs. */
export function stripCallbackFromUrl(win: Pick<Window, "history" | "location"> = window) {
  win.history.replaceState(win.history.state, "", "/medusify/")
}

import { randomBytes } from "node:crypto"
import { AbstractAuthModuleProvider } from "@medusajs/framework/utils"
import type { AuthenticationInput, AuthenticationResponse, AuthIdentityProviderService } from "@medusajs/framework/types"

/**
 * Dev shop stand-in for @medusajs/auth-google. DEV ONLY, never ship it: it trusts whatever account name the
 * browser sends. It speaks the same two-step redirect protocol as the real provider, so the app's Google flow can be
 * tested end to end without a Google project:
 *
 *   authenticate      -> stores {callback_url} under a random state key, returns a location that goes straight
 *                        back to callback_url with ?code=fake:<account>&state=<key> (Google would show a consent page)
 *   validateCallback  -> checks the state key exists, derives the identity from the code, returns the auth identity
 *
 * The identity id is "fake-sub-<account>", like the real provider's id is Google's `sub`. Whether the identity is
 * linked to an admin user is decided by the seed script `src/scripts/link-fake-google.ts`, exactly as with Google.
 * The account comes from the request body `fake_account`, else DEVSHOP_FAKE_GOOGLE_ACCOUNT, else the dev admin.
 */
export default class FakeGoogleProvider extends AbstractAuthModuleProvider {
  static identifier = "google"
  static DISPLAY_NAME = "Google (dev stand-in)"

  async authenticate(req: AuthenticationInput, svc: AuthIdentityProviderService): Promise<AuthenticationResponse> {
    const body = (req.body ?? {}) as { callback_url?: string; fake_account?: string }
    if (!body.callback_url) return { success: false, error: "callback_url is required" }
    const account = body.fake_account ?? process.env.DEVSHOP_FAKE_GOOGLE_ACCOUNT ?? "admin@devshop.invalid"
    const stateKey = randomBytes(32).toString("hex")
    await svc.setState(stateKey, { callback_url: body.callback_url, account })
    const location = new URL(body.callback_url)
    location.searchParams.set("code", `fake:${account}`)
    location.searchParams.set("state", stateKey)
    return { success: true, location: location.toString() }
  }

  async validateCallback(req: AuthenticationInput, svc: AuthIdentityProviderService): Promise<AuthenticationResponse> {
    const query = (req.query ?? {}) as Record<string, string | undefined>
    const code = query.code
    if (!code) return { success: false, error: "No code provided" }
    const state = (await svc.getState(query.state ?? "")) as { account?: string } | null
    if (!state) return { success: false, error: "No state provided, or session expired" }
    const account = code.replace(/^fake:/, "")
    const entity_id = `fake-sub-${account}`
    try {
      const authIdentity = await svc.retrieve({ entity_id })
      return { success: true, authIdentity }
    } catch (e) {
      if ((e as { type?: string }).type !== "not_found") return { success: false, error: (e as Error).message }
      const authIdentity = await svc.create({ entity_id, user_metadata: { email: account, name: "Dev stand-in" } })
      return { success: true, authIdentity }
    }
  }
}

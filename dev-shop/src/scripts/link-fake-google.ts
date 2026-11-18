/**
 * Dev shop only. Links the fake Google identity of the dev admin to the admin user, the step an allowlist
 * does for real accounts in a shop. Safe to re-run.
 *
 *   npx medusa exec ./src/scripts/link-fake-google.ts
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"

export default async function linkFakeGoogle({ container }: ExecArgs) {
  const email = process.env.DEVSHOP_FAKE_GOOGLE_ACCOUNT ?? "admin@devshop.invalid"
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const auth = container.resolve(Modules.AUTH)
  const { data: users } = await query.graph({ entity: "user", fields: ["id", "email"], filters: { email } })
  const user = users[0]
  if (!user) throw new Error(`no admin user ${email}`)
  const entity_id = `fake-sub-${email}`
  const existing = await auth.listProviderIdentities({ provider: "google", entity_id })
  if (existing.length > 0) {
    // A sign-in attempt before this script ran makes Medusa create the identity without a user. Link that one.
    const identityId = existing[0].auth_identity_id as string
    const [identity] = await auth.listAuthIdentities({ id: [identityId] })
    if (identity?.app_metadata?.user_id === user.id) {
      console.log("fake google identity already linked")
      return
    }
    await auth.updateAuthIdentities([{ id: identityId, app_metadata: { ...(identity?.app_metadata ?? {}), user_id: user.id } }])
    console.log(`linked existing ${entity_id} to user ${user.id}`)
    return
  }
  await auth.createAuthIdentities({ provider_identities: [{ provider: "google", entity_id }], app_metadata: { user_id: user.id } })
  console.log(`linked ${entity_id} to user ${user.id}`)
}

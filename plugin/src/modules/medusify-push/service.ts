import { MedusaService } from "@medusajs/framework/utils"
import webpush from "web-push"
import { MAX_CONSECUTIVE_FAILURES } from "../../constants"
import PushSubscription from "./models/push-subscription"
import { resolveOptions } from "./options"
import type {
  MedusifyPushOptions,
  PushPayload,
  ResolvedMedusifyPushOptions,
  SendResult,
} from "./types"

type SubscriptionRow = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  failure_count?: number | null
}

class MedusifyPushModuleService extends MedusaService({ PushSubscription }) {
  protected readonly config_: ResolvedMedusifyPushOptions

  constructor(container: Record<string, unknown>, options?: MedusifyPushOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...arguments)
    this.config_ = resolveOptions(options)
  }

  getConfig(): ResolvedMedusifyPushOptions {
    return this.config_
  }

  isEnabled(): boolean {
    return this.config_.enabled
  }

  /** The public VAPID key (safe to expose), or null when push is disabled. */
  getVapidPublicKey(): string | null {
    return this.config_.vapid?.publicKey ?? null
  }

  /**
   * Sends to every stored subscription of the shop. `mayReceive` decides per admin user (once per user, not per
   * device) whether that user gets the message; subscriptions of users who may not are skipped and kept.
   * The module has no access to Medusa's RBAC (own container), so the caller passes the check in.
   */
  async sendToAll(
    payload: PushPayload,
    mayReceive?: (userId: string) => Promise<boolean>
  ): Promise<SendResult> {
    const subscriptions = await this.listPushSubscriptions({}, { take: null })
    if (!mayReceive) {
      return this.sendToSubscriptions(subscriptions, payload)
    }
    const verdicts = new Map<string, Promise<boolean>>()
    const allowed = await Promise.all(
      subscriptions.map((sub: { user_id: string }) => {
        if (!verdicts.has(sub.user_id)) {
          verdicts.set(sub.user_id, mayReceive(sub.user_id).catch(() => false))
        }
        return verdicts.get(sub.user_id)!
      })
    )
    return this.sendToSubscriptions(
      subscriptions.filter((_: unknown, i: number) => allowed[i]),
      payload
    )
  }

  /** Sends to the subscriptions of one admin user. */
  async sendToUser(userId: string, payload: PushPayload): Promise<SendResult> {
    const subscriptions = await this.listPushSubscriptions(
      { user_id: userId },
      { take: null }
    )
    return this.sendToSubscriptions(subscriptions, payload)
  }

  /**
   * Sends one payload to the given subscriptions and keeps the bookkeeping:
   * - 404/410 from the push service ⇒ the subscription is gone, delete it
   * - success ⇒ last_success_at = now, failure_count = 0
   * - other errors ⇒ failure_count + 1, deleted after MAX_CONSECUTIVE_FAILURES
   * Never throws for a single failing subscription.
   */
  async sendToSubscriptions(
    subscriptions: SubscriptionRow[],
    payload: PushPayload
  ): Promise<SendResult> {
    const result: SendResult = { sent: 0, failed: 0, removed: 0 }
    const vapid = this.config_.vapid
    if (!this.config_.enabled || !vapid || !subscriptions.length) {
      return result
    }

    const body = JSON.stringify(payload)
    const toRemove: string[] = []
    const successes: string[] = []
    const failures: { id: string; failure_count: number }[] = []

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
            {
              vapidDetails: {
                subject: vapid.subject,
                publicKey: vapid.publicKey,
                privateKey: vapid.privateKey,
              },
              TTL: 60 * 60 * 24,
              urgency: "high",
            }
          )
          result.sent++
          successes.push(sub.id)
        } catch (error) {
          const status = (error as { statusCode?: number })?.statusCode
          if (status === 404 || status === 410) {
            toRemove.push(sub.id)
            result.removed++
            return
          }
          result.failed++
          const next = (sub.failure_count ?? 0) + 1
          if (next >= MAX_CONSECUTIVE_FAILURES) {
            toRemove.push(sub.id)
            result.removed++
          } else {
            failures.push({ id: sub.id, failure_count: next })
          }
        }
      })
    )

    if (toRemove.length) {
      await this.deletePushSubscriptions(toRemove)
    }
    const now = new Date()
    if (successes.length) {
      await this.updatePushSubscriptions(
        successes.map((id) => ({ id, last_success_at: now, failure_count: 0 }))
      )
    }
    if (failures.length) {
      await this.updatePushSubscriptions(failures)
    }
    return result
  }
}

export default MedusifyPushModuleService

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useId, useRef, useState } from "react"
import { useApp } from "../app/context"
import { ALL_ALLOWED, orderActions } from "../lib/actions"
import { changeLines, type ChangeKind } from "../lib/order-change"
import * as api from "../lib/api"
import { optimisticDelivered } from "../lib/optimistic"
import { formatMoney } from "../lib/format"
import type { Order, Shop } from "../lib/types"
import { useAction } from "../lib/use-action"
import { ChangeSheet } from "./ChangeSheet"
import { ConfirmBody } from "./ConfirmSheet"
import { Icon, type IconName } from "./Icon"
import { Section } from "./kit"
import { RefundSheet } from "./RefundSheet"
import { ReturnSheet } from "./ReturnSheet"
import { Sheet } from "./Sheet"

type Open = "capture" | "paid" | "cancel" | "refund" | "return" | ChangeKind | null

/** One action of the list: a plain row, red when it cannot be taken back. */
function ActionRow({ icon, title, sub, danger, disabled, onClick }: { icon: IconName; title: string; sub?: string; danger?: boolean; disabled?: boolean; onClick(): void }) {
  return (
    <button className={`row${danger ? " danger-row" : ""}`} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size="sm" />
      <span className="row-main">
        <span className={`row-title reg${danger ? "" : " tint"}`}>{title}</span>
        {sub ? <span className="row-sub">{sub}</span> : null}
      </span>
      <Icon name="caret-right" size="xs" />
    </button>
  )
}

/**
 * What the user can still do with the order: capture, mark as paid, mark as delivered, refund, accept a return, cancel.
 * Each row exists only while the order's state allows it and the user's role may do it (`orderActions`). The rights come
 * from the plugin; while they load, nothing is offered that could turn out to be forbidden.
 */
export function OrderActions({ shop, order, intent = null }: { shop: Shop; order: Order; intent?: "paid" | null }) {
  const { t, lang, online } = useApp()
  const [open, setOpen] = useState<Open>(null)
  const qc = useQueryClient()
  const perms = useQuery({ queryKey: ["permissions", shop.id], queryFn: () => api.getPermissions(shop), staleTime: 5 * 60_000, retry: false })
  const { run, busy, error, clearError } = useAction()
  const errId = useId()
  const money = (n: number) => formatMoney(n, order.currency_code, lang)
  const intentUsed = useRef(false)
  const mayPay = !!perms.data && !!orderActions(order, perms.data).markPaid
  // Coming from the swipe action in the list: open the confirmation once, and only if the role and the order still allow it.
  useEffect(() => {
    if (intent !== "paid" || intentUsed.current || !perms.data) return
    intentUsed.current = true
    if (mayPay) setOpen("paid")
  }, [intent, perms.data, mayPay])

  if (!perms.data) return null
  const a = orderActions(order, perms.data ?? ALL_ALLOWED)
  // Changes after the order (plugin 0.4.0): Medusa refuses them on a canceled or draft order
  const open_ = !["canceled", "draft", "archived"].includes(order.status)
  const change = {
    edit: open_ && perms.data.order_edit && !!order.items?.length,
    exchange: open_ && perms.data.exchange && changeLines(order, "exchange").length > 0,
    claim: open_ && perms.data.claim && changeLines(order, "claim").length > 0,
  }
  const any = a.capture || a.markPaid || a.cancel || a.deliver.length || a.refund || a.returnable.length || change.edit || change.exchange || change.claim
  if (!any) return null

  const close = () => {
    clearError()
    setOpen(null)
  }
  const confirm = (action: () => Promise<unknown>, done: string) => void run(action, done).then((ok) => ok && setOpen(null))

  return (
    <>
      <Section id="actions" title={t("act.section")}>
        <div className="group plain">
          {a.capture ? <ActionRow icon="check-circle" title={t("act.capture")} sub={t("act.captureSub", { amount: money(a.capture.amount) })} disabled={!online} onClick={() => setOpen("capture")} /> : null}
          {a.markPaid ? <ActionRow icon="check" title={t("act.markPaid")} sub={t("act.markPaidSub")} disabled={!online} onClick={() => setOpen("paid")} /> : null}
          {a.deliver.map((d) => (
            <ActionRow
              key={d.fulfillmentId}
              icon="truck"
              title={t("act.deliver")}
              sub={d.tracking ? t("act.deliverSub", { tracking: d.tracking }) : t("act.deliverSubPlain")}
              disabled={!online || busy}
              onClick={() => void run(() => api.markDelivered(shop, order.id, d.fulfillmentId), t("act.deliverDone"), () => optimisticDelivered(qc, order.id, d.fulfillmentId))}
            />
          ))}
          {change.edit ? <ActionRow icon="note-pencil" title={t("oc.edit")} sub={t("oc.editSub")} disabled={!online} onClick={() => setOpen("edit")} /> : null}
          {change.exchange ? <ActionRow icon="arrow-down" title={t("oc.exchange")} sub={t("oc.exchangeSub")} disabled={!online} onClick={() => setOpen("exchange")} /> : null}
          {change.claim ? <ActionRow icon="warning-circle" title={t("oc.claim")} sub={t("oc.claimSub")} disabled={!online} onClick={() => setOpen("claim")} /> : null}
          {a.returnable.length ? <ActionRow icon="package" title={t("act.return")} sub={t("act.returnSub")} disabled={!online} onClick={() => setOpen("return")} /> : null}
          {a.refund ? <ActionRow icon="arrow-u-up-left" title={t("act.refund")} sub={t("act.refundSub", { amount: money(a.refund.max) })} danger disabled={!online} onClick={() => setOpen("refund")} /> : null}
          {a.cancel ? <ActionRow icon="x-circle" title={t("act.cancel")} danger disabled={!online} onClick={() => setOpen("cancel")} /> : null}
        </div>
        {!online ? <p className="note">{t("act.offline")}</p> : null}
        {error && !open ? <p className="note bad" role="alert">{error}</p> : null}
      </Section>

      {open === "capture" && a.capture ? (
        <Sheet title={t("act.capture")} onClose={close} locked={busy}>
          <ConfirmBody
            text={t("act.captureBody", { amount: money(a.capture.amount) })}
            facts={[{ label: t("act.fact.amount"), value: money(a.capture.amount) }, { label: t("act.fact.shop"), value: shop.name }]}
            label={t("act.captureConfirm", { amount: money(a.capture.amount) })}
            busy={busy}
            error={error}
            offline={!online}
            errId={errId}
            onConfirm={() => confirm(() => api.capturePayment(shop, a.capture!.paymentId), t("act.captureDone"))}
          />
        </Sheet>
      ) : null}

      {open === "paid" && a.markPaid ? (
        <Sheet title={t("act.markPaid")} onClose={close} locked={busy}>
          <ConfirmBody
            text={t("act.markPaidBody")}
            label={t("act.markPaidConfirm")}
            busy={busy}
            error={error}
            offline={!online}
            errId={errId}
            onConfirm={() => confirm(() => api.markPaid(shop, a.markPaid!.collectionId, order.id), t("act.markPaidDone"))}
          />
        </Sheet>
      ) : null}

      {open === "cancel" && a.cancel ? (
        <Sheet title={t("act.cancelTitle")} onClose={close} locked={busy}>
          <ConfirmBody
            text={t("act.cancelBody", { n: `#${order.display_id}`, shop: shop.name })}
            label={t("act.cancelConfirm")}
            danger
            busy={busy}
            error={error}
            offline={!online}
            errId={errId}
            onConfirm={() => confirm(() => api.cancelOrder(shop, order.id), t("act.cancelDone"))}
          />
        </Sheet>
      ) : null}

      {open === "refund" && a.refund ? <RefundSheet shop={shop} order={order} paymentId={a.refund.paymentId} max={a.refund.max} onClose={close} /> : null}
      {(open === "edit" || open === "exchange" || open === "claim") && change[open] ? <ChangeSheet shop={shop} order={order} kind={open} onClose={close} /> : null}
      {open === "return" && a.returnable.length ? <ReturnSheet shop={shop} order={order} items={a.returnable} refund={a.refund} onClose={close} /> : null}
    </>
  )
}

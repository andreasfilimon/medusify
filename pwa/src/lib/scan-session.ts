/**
 * The pure parts of the scanner mode: when a code counts, the list of what was counted in this sitting, and undo.
 * Nothing here touches the camera or the network, so every rule has a plain test.
 */

/**
 * How long a code has to be out of the picture before the same code counts again. The decoder reports a code on every frame
 * while it is in view (five times a second): holding one item in front of the camera must count once, and a second item with
 * the same barcode counts when the first one has been taken away.
 */
export const LIFT_MS = 900

export type Gate = { code: string | null; seenAt: number }
export const OPEN_GATE: Gate = { code: null, seenAt: 0 }

/** Whether a code seen at `now` is a new scan. The gate remembers the last sighting either way. */
export function admit(gate: Gate, code: string, now: number): { accept: boolean; gate: Gate } {
  const same = gate.code === code && now - gate.seenAt < LIFT_MS
  return { accept: !same, gate: { code, seenAt: now } }
}

export type Mode = "plus" | "count"

/** One counted scan in "+1 per scan": the key identifies the request, so a retry is the same request. */
export type Entry = {
  key: string
  variantId: string
  inventoryItemId: string
  locationId: string
  productTitle: string
  variantTitle: string
  /** The shop's answer to the request: what the stock is now; null while it is on its way or failed. */
  stocked: number | null
  status: "sending" | "done" | "failed"
  undone: boolean
  /** The key of the request that took this one back, while it is on its way or when it was sent. */
  undoKey: string | null
  /** The sentence for a failure, for the row. */
  error?: string | null
}

/** The entries that still count: neither taken back nor failed. */
export const live = (entries: readonly Entry[]) => entries.filter((e) => !e.undone && e.status !== "failed")

/** Units added in this sitting for each variant. */
export function addedByVariant(entries: readonly Entry[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of live(entries)) out.set(e.variantId, (out.get(e.variantId) ?? 0) + 1)
  return out
}

export const totalAdded = (entries: readonly Entry[]) => live(entries).length

/**
 * The newest entry that can still be taken back: sent, not taken back. One whose take-back was sent and got no answer
 * stays here: the next tap sends the same request again (`undoKey` keeps its key), the shop answers a repeat without booking twice.
 */
export const lastUndoable = (entries: readonly Entry[]) => [...entries].reverse().find((e) => e.status === "done" && !e.undone)

/**
 * A scan that is about to be sent: new entries are appended (this is where a scan first shows in the list), an entry that is
 * sent again after a failure or a lost answer is patched in place, so the row and its key stay the same.
 */
export const upsertEntry = (entries: readonly Entry[], entry: Entry): Entry[] =>
  entries.some((e) => e.key === entry.key) ? patchEntry(entries, entry.key, { status: "sending", error: null }) : [...entries, entry]

export const patchEntry = (entries: readonly Entry[], key: string, patch: Partial<Entry>): Entry[] => entries.map((e) => (e.key === key ? { ...e, ...patch } : e))

/**
 * "Zählen": what has been counted per variant and place in this sitting; nothing is written until the count is applied.
 * The row key is variant and place: switching the place mid-sitting starts a new row instead of moving the count.
 */
export type TallyRow = { key: string; variantId: string; inventoryItemId: string; locationId: string; productTitle: string; variantTitle: string; counted: number; was: number | null }
export type Tally = Map<string, TallyRow>

export const tallyKey = (variantId: string, locationId: string) => `${variantId}|${locationId}`

export function tallyAdd(tally: Tally, v: Omit<TallyRow, "key" | "counted">, by = 1): Tally {
  const key = tallyKey(v.variantId, v.locationId)
  const next = new Map(tally)
  const prev = next.get(key)
  next.set(key, { ...v, key, counted: Math.max(0, (prev?.counted ?? 0) + by), was: prev ? prev.was : v.was })
  return next
}

export function tallySet(tally: Tally, key: string, counted: number): Tally {
  const prev = tally.get(key)
  if (!prev) return tally
  const next = new Map(tally)
  next.set(key, { ...prev, counted: Math.max(0, counted) })
  return next
}

export function tallyRemove(tally: Tally, key: string): Tally {
  const next = new Map(tally)
  next.delete(key)
  return next
}

/**
 * A count was written: the row goes, unless it was counted further while the request ran (the camera keeps scanning). Then
 * it stays with the newer number, which the next "apply" writes.
 */
export function tallyWritten(tally: Tally, key: string, written: number): Tally {
  return tally.get(key)?.counted === written ? tallyRemove(tally, key) : tally
}

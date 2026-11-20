import { describe, expect, it } from "vitest"
import { LIFT_MS, OPEN_GATE, addedByVariant, admit, lastUndoable, live, patchEntry, upsertEntry, tallyAdd, tallyKey, tallyRemove, tallySet, tallyWritten, totalAdded, type Entry, type Tally } from "../src/lib/scan-session"

const entry = (o: Partial<Entry> = {}): Entry => ({ key: "k1", variantId: "v1", inventoryItemId: "i1", locationId: "l1", productTitle: "Mug", variantTitle: "", stocked: 5, status: "done", undone: false, undoKey: null, ...o })

describe("when a code counts", () => {
  it("counts the first sighting", () => expect(admit(OPEN_GATE, "123", 1000).accept).toBe(true))
  it("does not count the same code on the next frames (it is still in view)", () => {
    let g = admit(OPEN_GATE, "123", 1000).gate
    for (let t = 1200; t <= 3000; t += 200) {
      const r = admit(g, "123", t)
      expect(r.accept).toBe(false)
      g = r.gate
    }
  })
  it("counts the same code again once it has been out of the picture long enough", () => {
    const g = admit(OPEN_GATE, "123", 1000).gate
    expect(admit(g, "123", 1000 + LIFT_MS).accept).toBe(true)
    expect(admit(g, "123", 1000 + LIFT_MS - 1).accept).toBe(false)
  })
  it("counts a different code at once", () => {
    const g = admit(OPEN_GATE, "123", 1000).gate
    expect(admit(g, "456", 1100).accept).toBe(true)
  })
  it("keeps the gate shut while the same code stays in view for a long time", () => {
    let g = OPEN_GATE
    let counted = 0
    for (let t = 0; t < 10_000; t += 200) {
      const r = admit(g, "123", t)
      if (r.accept) counted++
      g = r.gate
    }
    expect(counted).toBe(1)
  })
})

describe("the list of one sitting", () => {
  it("counts what is sent and not taken back, not what failed", () => {
    const list = [entry({ key: "a" }), entry({ key: "b", undone: true }), entry({ key: "c", status: "failed" }), entry({ key: "d", status: "sending" })]
    expect(live(list).map((e) => e.key)).toEqual(["a", "d"])
    expect(totalAdded(list)).toBe(2)
  })
  it("adds up per variant", () => {
    const m = addedByVariant([entry({ key: "a" }), entry({ key: "b" }), entry({ key: "c", variantId: "v2" }), entry({ key: "d", undone: true })])
    expect(m.get("v1")).toBe(2)
    expect(m.get("v2")).toBe(1)
  })
  it("undo takes the newest entry that was sent and not taken back", () => {
    const list = [entry({ key: "a" }), entry({ key: "b" }), entry({ key: "c", status: "sending" })]
    expect(lastUndoable(list)?.key).toBe("b")
    expect(lastUndoable([entry({ key: "a", undone: true })])).toBeUndefined()
  })
  it("a take-back that got no answer stays undoable: the next tap sends the same request", () => {
    expect(lastUndoable([entry({ key: "a", undoKey: "u1" })])?.key).toBe("a")
  })
  it("patches one entry and leaves the others", () => {
    const next = patchEntry([entry({ key: "a" }), entry({ key: "b" })], "b", { status: "failed" })
    expect(next.map((e) => e.status)).toEqual(["done", "failed"])
  })
  it("a new scan is appended, a repeated send patches the same row and keeps its key", () => {
    const first = upsertEntry([], entry({ key: "a", status: "sending", stocked: null }))
    expect(first.map((e) => e.key)).toEqual(["a"])
    const failed = patchEntry(first, "a", { status: "failed", error: "x" })
    const again = upsertEntry(failed, entry({ key: "a", status: "sending", stocked: null }))
    expect(again).toHaveLength(1)
    expect(again[0]).toMatchObject({ key: "a", status: "sending", error: null })
    expect(upsertEntry(again, entry({ key: "b" })).map((e) => e.key)).toEqual(["a", "b"])
  })
})

describe("the count (Zählen)", () => {
  const v = { variantId: "v1", inventoryItemId: "i1", locationId: "l1", productTitle: "Mug", variantTitle: "", was: 7 }
  const K = tallyKey("v1", "l1")
  it("adds one per scan and keeps the number the shop showed first", () => {
    let t: Tally = new Map()
    t = tallyAdd(t, v)
    t = tallyAdd(t, { ...v, was: 9 })
    expect(t.get(K)).toMatchObject({ counted: 2, was: 7 })
  })
  it("never goes below zero", () => {
    let t = tallyAdd(new Map(), v)
    t = tallyAdd(t, v, -5)
    expect(t.get(K)?.counted).toBe(0)
    expect(tallySet(t, K, -3).get(K)?.counted).toBe(0)
  })
  it("sets and removes a row, and does not change the old map", () => {
    const t = tallyAdd(new Map(), v)
    const set = tallySet(t, K, 12)
    expect(set.get(K)?.counted).toBe(12)
    expect(t.get(K)?.counted).toBe(1)
    expect(tallyRemove(set, K).size).toBe(0)
    expect(tallySet(t, "nope", 3)).toBe(t)
  })
  it("another place is another row: switching the place does not move the count there", () => {
    let t: Tally = tallyAdd(tallyAdd(new Map(), v), v) // 2 at l1
    t = tallyAdd(t, { ...v, locationId: "l2", was: 3 }) // 1 at l2
    expect([...t.values()].map((r) => [r.locationId, r.counted, r.was])).toEqual([["l1", 2, 7], ["l2", 1, 3]])
  })
  it("a written count takes its row off, unless it was scanned further while the request ran", () => {
    const written = tallySet(tallyAdd(new Map(), v), K, 4)
    expect(tallyWritten(written, K, 4).size).toBe(0)
    // two more scans arrived while "4" was being written: the row stays with 6 for the next apply
    const later = tallyAdd(tallyAdd(written, v), v)
    expect(tallyWritten(later, K, 4).get(K)?.counted).toBe(6)
    expect(tallyWritten(later, "gone", 4)).toBe(later)
  })
})

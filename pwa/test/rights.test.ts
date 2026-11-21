import { describe, expect, it } from "vitest"
import { ACTION_KEYS, ALL_ALLOWED, mayInAnyShop } from "../src/lib/actions"
import { RIGHT_GROUPS, lineState } from "../src/lib/rights"
import { dictionaries } from "../src/lib/i18n"

describe("rights screen", () => {
  it("every action of the plugin is on exactly one line, every line has its text in both languages", () => {
    const listed = RIGHT_GROUPS.flatMap((g) => g.lines.flatMap((l) => l.actions))
    expect([...listed].sort()).toEqual([...ACTION_KEYS].sort())
    for (const lang of ["de", "en"] as const) {
      for (const g of RIGHT_GROUPS) {
        expect(dictionaries[lang][`rights.group.${g.id}` as keyof (typeof dictionaries)["de"]]).toBeTruthy()
        for (const l of g.lines) expect(dictionaries[lang][`rights.line.${l.id}` as keyof (typeof dictionaries)["de"]]).toBeTruthy()
      }
    }
  })

  it("a line is allowed when all its actions are, partly when some are", () => {
    expect(lineState(ALL_ALLOWED, ["order_edit", "exchange", "claim"])).toBe("yes")
    expect(lineState({ ...ALL_ALLOWED, claim: false }, ["order_edit", "exchange", "claim"])).toBe("part")
    expect(lineState({ ...ALL_ALLOWED, reports: false }, ["reports"])).toBe("no")
  })
})

describe("links in More", () => {
  const no = { ...ALL_ALLOWED, reports: false }
  it("a link goes only when every signed-in shop says no", () => {
    expect(mayInAnyShop([no, no], "reports")).toBe(false)
    expect(mayInAnyShop([no, ALL_ALLOWED], "reports")).toBe(true)
    expect(mayInAnyShop([no, undefined], "reports")).toBe(true) // not answered yet
    expect(mayInAnyShop([], "reports")).toBe(true)
  })
})

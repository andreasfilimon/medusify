import { describe, expect, it } from "vitest"
import api from "../src/lib/api.ts?raw"
import sw from "../public/sw.js?raw"

const sources = import.meta.glob<string>("../src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true })

describe("service worker source", () => {
  it("caches exactly one file: the offline page", () => {
    expect(sw.match(/\.add\(/g)).toHaveLength(1)
    // IndexedDB `store.put` (the badge numbers) is fine; the Cache API takes the offline page only.
    expect(sw).not.toMatch(/cache\.put\(|caches[^;]*\.put\(|\.addAll\(/)
    expect(sw).toContain("offline.html")
  })
  it("answers only page navigations", () => {
    expect(sw).toMatch(/request\.mode\s*!==?\s*"navigate"|request\.mode\s*===\s*"navigate"/)
  })
  it("always shows a notification for a push and stays inside /medusify/", () => {
    expect(sw).toContain("showNotification")
    expect(sw).toContain("notificationclick")
    expect(sw).toContain("/medusify/")
  })
})

describe("app fetches", () => {
  it("never reads from the HTTP cache", () => {
    const calls = api.match(/fetch(Impl)?\([^)]*\{[\s\S]*?\}\)/g) ?? []
    expect(calls.length).toBeGreaterThanOrEqual(4)
    for (const c of calls) expect(c).toContain('cache: "no-store"')
  })
  it("stores no credentials in localStorage; sessionStorage only holds the single-use OAuth state", () => {
    const using = (re: RegExp) =>
      Object.entries(sources)
        .filter(([, text]) => re.test(text))
        .map(([file]) => file.replace("../", ""))
    expect(using(/localStorage\.(get|set|remove)Item/)).toEqual(["src/lib/prefs.ts"])
    expect(using(/sessionStorage/)).toEqual(["src/lib/oauth.ts"])
  })
})

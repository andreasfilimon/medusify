import { describe, expect, it } from "vitest"
import { callbackUrl, hasAdminActor, jwtClaims, readCallback, rememberState, stateFromLocation, stripCallbackFromUrl, takeState } from "../src/lib/oauth"

const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.s`

describe("oauth state", () => {
  it("reads the state out of the authorization URL", () => {
    expect(stateFromLocation("https://accounts.example/o/oauth2/v2/auth?client_id=x&state=abc123&response_type=code")).toBe("abc123")
    expect(stateFromLocation("not a url")).toBeNull()
    expect(stateFromLocation("https://accounts.example/auth?client_id=x")).toBeNull()
  })
  it("can be redeemed once", () => {
    rememberState("s-1")
    expect(takeState()).toBe("s-1")
    expect(takeState()).toBeNull()
  })
})

describe("callback", () => {
  it("is recognised only on the callback path", () => {
    expect(readCallback("/medusify/auth/google", "?code=c&state=s")).toEqual({ code: "c", state: "s", error: null })
    expect(readCallback("/medusify/orders", "?code=c&state=s")).toBeNull()
    expect(readCallback("/medusify/auth/google", "?error=access_denied")).toEqual({ code: null, state: null, error: "access_denied" })
  })
  it("builds the callback address on the shop's own origin", () => {
    expect(callbackUrl("https://shop.example")).toBe("https://shop.example/medusify/auth/google")
  })
  it("takes code and state out of the address bar", () => {
    history.replaceState(null, "", "/medusify/auth/google?code=secret&state=s")
    stripCallbackFromUrl()
    expect(location.pathname + location.search).toBe("/medusify/")
    expect(location.href).not.toContain("secret")
  })
})

describe("token claims", () => {
  it("reads claims without verifying", () => expect(jwtClaims(jwt({ actor_id: "user_1" })).actor_id).toBe("user_1"))
  it("a token without an admin attached is not a login", () => {
    expect(hasAdminActor(jwt({ actor_id: "user_1" }))).toBe(true)
    expect(hasAdminActor(jwt({ actor_id: "" }))).toBe(false)
    expect(hasAdminActor(jwt({}))).toBe(false)
    expect(hasAdminActor("garbage")).toBe(false)
  })
})

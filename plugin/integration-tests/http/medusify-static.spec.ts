import http from "node:http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

jest.setTimeout(120 * 1000)

// A throw-away bundle next to a "secret" file the server must never hand out.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "medusify-static-"))
const root = path.join(sandbox, "pwa")
const SECRET = "TOP-SECRET-MARKER-9d1f"
fs.mkdirSync(path.join(root, "assets"), { recursive: true })
fs.writeFileSync(path.join(sandbox, "secret.txt"), SECRET)
fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>medusify</title>")
fs.writeFileSync(path.join(root, "offline.html"), "<!doctype html><style>body{margin:0}</style><title>offline</title>")
fs.writeFileSync(path.join(root, "sw.js"), "self.addEventListener('install',()=>{})")
fs.writeFileSync(path.join(root, "manifest.webmanifest"), '{"name":"c"}')
fs.writeFileSync(path.join(root, "assets", "app-abc123.js"), "console.log(1)")
fs.writeFileSync(path.join(root, "assets", "app-abc123.css"), "body{}")
fs.writeFileSync(path.join(root, "icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
fs.writeFileSync(path.join(root, "logo.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>")
fs.symlinkSync(path.join(sandbox, "secret.txt"), path.join(root, "linked-secret.txt"))
process.env.MEDUSIFY_PWA_DIR = root

/** Raw request: Node's http client does not normalize the path (axios/URL would resolve `..` before sending). */
function raw(baseURL: string, pathAndQuery: string, method = "GET", headers: http.OutgoingHttpHeaders = {}) {
  const url = new URL(baseURL)
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request(
      { host: url.hostname, port: url.port, path: pathAndQuery, method, headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })
        )
      }
    )
    req.on("error", reject)
    req.end()
  })
}

medusaIntegrationTestRunner({
  testSuite: ({ api }) => {
    const base = () => (api as any).defaults.baseURL as string

    describe("PWA under /medusify", () => {
      it("serves index.html at /medusify/ with the right content type, no cookie/auth needed", async () => {
        const res = await raw(base(), "/medusify/")
        expect(res.status).toBe(200)
        expect(res.headers["content-type"]).toBe("text/html; charset=utf-8")
        expect(res.headers["cache-control"]).toBe("no-cache")
        expect(res.headers["x-content-type-options"]).toBe("nosniff")
        expect(res.body).toContain("<title>medusify</title>")
      })

      it("redirects /medusify to /medusify/ so the service worker scope and relative paths work", async () => {
        const res = await raw(base(), "/medusify?x=1")
        expect(res.status).toBe(308)
        expect(res.headers.location).toBe("/medusify/?x=1")
      })

      it.each([
        ["/medusify/sw.js", "text/javascript; charset=utf-8", "no-cache"],
        ["/medusify/manifest.webmanifest", "application/manifest+json; charset=utf-8", "no-cache"],
        ["/medusify/assets/app-abc123.js", "text/javascript; charset=utf-8", "public, max-age=31536000, immutable"],
        ["/medusify/assets/app-abc123.css", "text/css; charset=utf-8", "public, max-age=31536000, immutable"],
        ["/medusify/icon.png", "image/png", "public, max-age=3600"],
        ["/medusify/logo.svg", "image/svg+xml", "public, max-age=3600"],
      ])("%s → %s, Cache-Control %s", async (url, type, cache) => {
        const res = await raw(base(), url)
        expect(res.status).toBe(200)
        expect(res.headers["content-type"]).toBe(type)
        expect(res.headers["cache-control"]).toBe(cache)
      })

      describe("security headers", () => {
        const directives = (csp: string) =>
          Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...src]) => [name, src]))

        // Medusa itself puts `frame-ancestors 'self'` on every answer, so "a CSP exists" proves nothing: the
        // policy has to be the app's, on success, redirect and error answers alike.
        it.each([
          ["/medusify/", 200],
          ["/medusify/sw.js", 200],
          ["/medusify/assets/app-abc123.js", 200],
          ["/medusify/orders/order_123", 200],
          ["/medusify/missing.js", 404],
          ["/medusify/..%2fsecret.txt", 400],
          ["/medusify", 308],
        ])("%s (%i) carries nosniff, no-referrer, no framing and the app's CSP", async (url, status) => {
          const res = await raw(base(), url)
          expect(res.status).toBe(status)
          expect(res.headers["x-content-type-options"]).toBe("nosniff")
          expect(res.headers["referrer-policy"]).toBe("no-referrer")
          expect(res.headers["x-frame-options"]).toBe("DENY")
          const d = directives(res.headers["content-security-policy"] as string)
          expect(d["default-src"]).toEqual(["'self'"])
          expect(d["script-src"]).toEqual(["'self'", "'wasm-unsafe-eval'"])
          expect(d["frame-ancestors"]).toEqual(["'none'"])
        })

        it("the CSP keeps scripts on the app, forbids framing and plugins, and allows the shops the app talks to", async () => {
          const res = await raw(base(), "/medusify/")
          const d = directives(res.headers["content-security-policy"] as string)
          expect(d["default-src"]).toEqual(["'self'"])
          expect(d["script-src"]).toEqual(["'self'", "'wasm-unsafe-eval'"])
          expect(d["frame-ancestors"]).toEqual(["'none'"])
          expect(d["object-src"]).toEqual(["'none'"])
          expect(d["base-uri"]).toEqual(["'none'"])
          expect(d["worker-src"]).toEqual(["'self'"])
          // Exactly the origins the app's "add shop" check accepts (pwa/src/lib/shops.ts): https anywhere, plain http only on
          // localhost, its subdomains and 127.0.0.1. An IPv6 literal such as http://[::1]:* is not a valid CSP source.
          expect(d["connect-src"]).toEqual(["'self'", "https:", "http://localhost:*", "http://*.localhost:*", "http://127.0.0.1:*"])
          // no way to run injected script: no inline, no eval, no wildcard in script-src
          for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "*", "https:", "data:"]) {
            expect(d["script-src"]).not.toContain(bad)
          }
          expect(d["style-src"]).not.toContain("'unsafe-inline'")
        })

        it("an HTML file with an inline <style> gets exactly that style's sha256 in style-src", async () => {
          const css = "body{margin:0}"
          const hash = `'sha256-${crypto.createHash("sha256").update(css).digest("base64")}'`
          const res = await raw(base(), "/medusify/offline.html")
          expect(directives(res.headers["content-security-policy"] as string)["style-src"]).toEqual(["'self'", hash])
          const plain = await raw(base(), "/medusify/")
          expect(directives(plain.headers["content-security-policy"] as string)["style-src"]).toEqual(["'self'"])
        })
      })

      it("sw.js may control the whole /medusify/ scope", async () => {
        const res = await raw(base(), "/medusify/sw.js")
        expect(res.headers["service-worker-allowed"]).toBe("/medusify/")
      })

      it("HEAD sends headers without a body; If-None-Match gives 304", async () => {
        const head = await raw(base(), "/medusify/assets/app-abc123.js", "HEAD")
        expect(head.status).toBe(200)
        expect(head.body).toBe("")
        expect(Number(head.headers["content-length"])).toBeGreaterThan(0)
        const cached = await raw(base(), "/medusify/assets/app-abc123.js", "GET", {
          "If-None-Match": head.headers.etag as string,
        })
        expect(cached.status).toBe(304)
      })

      it("falls back to index.html for client-side routes (no file extension)", async () => {
        for (const url of ["/medusify/orders/order_123", "/medusify/settings", "/medusify/a/b/c/"]) {
          const res = await raw(base(), url)
          expect(res.status).toBe(200)
          expect(res.headers["content-type"]).toBe("text/html; charset=utf-8")
          expect(res.body).toContain("<title>medusify</title>")
        }
      })

      it("a missing file WITH an extension is a real 404, not index.html", async () => {
        for (const url of ["/medusify/assets/missing.js", "/medusify/nope.css", "/medusify/x.png"]) {
          const res = await raw(base(), url)
          expect(res.status).toBe(404)
          expect(res.body).not.toContain("<title>medusify</title>")
        }
      })

      it("only GET/HEAD are served; the rest of the API is unaffected", async () => {
        await expect(api.post("/medusify/", {})).rejects.toMatchObject({ response: { status: 404 } })
        const health = await raw(base(), "/health")
        expect(health.status).toBe(200)
      })

      describe("path traversal is blocked", () => {
        const attacks = [
          "/medusify/../secret.txt",
          "/medusify/%2e%2e/secret.txt",
          "/medusify/%2E%2E/secret.txt",
          "/medusify/..%2fsecret.txt",
          "/medusify/%2e%2e%2fsecret.txt",
          "/medusify/..%2Fsecret.txt",
          "/medusify/assets/../../secret.txt",
          "/medusify/assets/%2e%2e/%2e%2e/secret.txt",
          "/medusify/..\\secret.txt",
          "/medusify/..%5csecret.txt",
          "/medusify/%5c..%5csecret.txt",
          "/medusify/%252e%252e/secret.txt",
          "/medusify/%252e%252e%252fsecret.txt",
          "/medusify/..%00/secret.txt",
          "/medusify/%00",
          "/medusify//..//secret.txt",
          "/medusify/linked-secret.txt", // symlink inside the bundle pointing outside
          `/medusify/${encodeURIComponent(path.join(sandbox, "secret.txt"))}`, // absolute path
        ]
        it.each(attacks)("%s never returns the secret", async (url) => {
          const res = await raw(base(), url)
          expect(res.body).not.toContain(SECRET)
          expect([400, 404, 308]).toContain(res.status)
          if (res.status === 200) throw new Error("must not be served")
        })
      })
    })
  },
})

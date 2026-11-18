import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MEDUSIFY_PUSH_MODULE, MEDUSIFY_PWA_BASE_PATH } from "../constants"
import type { MedusifyPushModuleService } from "../modules/medusify-push"

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
}

/** Find `<package root>/pwa-dist`, from source (src/lib) and from the build (.medusa/server/src/lib). */
export function defaultPwaDir(startDir: string = __dirname): string | null {
  let dir = startDir
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "pwa-dist")
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export type ResolvedAsset =
  | { kind: "file"; file: string; spaFallback: boolean }
  | { kind: "redirect"; location: string }
  | { kind: "bad-request" }
  | { kind: "not-found" }

/**
 * Maps a request URL below /medusify to a file in `root`. Pure and synchronous so the
 * traversal rules can be tested without HTTP. Rules:
 *  - the raw path is split on "/" FIRST, then each segment is decoded: an encoded slash
 *    (%2f) or backslash (%5c) inside a segment is rejected, not turned into a separator
 *  - "..", ".", NUL and backslashes are rejected
 *  - the resolved real path must stay inside the real root (symlinks can't escape)
 *  - SPA fallback to index.html only for paths WITHOUT a file extension; a missing
 *    asset is a real 404 (else the browser would get HTML where it expects JS)
 */
export function resolveAsset(rawUrl: string, root: string): ResolvedAsset {
  const [pathname, query] = rawUrl.split("?", 2)
  if (pathname === MEDUSIFY_PWA_BASE_PATH) {
    return { kind: "redirect", location: `${MEDUSIFY_PWA_BASE_PATH}/${query ? `?${query}` : ""}` }
  }
  if (!pathname.startsWith(`${MEDUSIFY_PWA_BASE_PATH}/`)) {
    return { kind: "not-found" }
  }

  const rawSegments = pathname.slice(MEDUSIFY_PWA_BASE_PATH.length + 1).split("/")
  const segments: string[] = []
  for (const raw of rawSegments) {
    let seg: string
    try {
      seg = decodeURIComponent(raw)
    } catch {
      return { kind: "bad-request" }
    }
    if (seg.includes("/") || seg.includes("\\") || seg.includes("\0")) {
      return { kind: "bad-request" }
    }
    if (seg === "..") {
      return { kind: "bad-request" }
    }
    if (seg === "" || seg === ".") continue
    segments.push(seg)
  }

  let realRoot: string
  try {
    realRoot = fs.realpathSync(root)
  } catch {
    return { kind: "not-found" }
  }

  const index = path.join(realRoot, "index.html")
  if (!segments.length) {
    return fs.existsSync(index) ? { kind: "file", file: index, spaFallback: false } : { kind: "not-found" }
  }

  const target = path.resolve(realRoot, ...segments)
  const inside = (p: string) => p === realRoot || p.startsWith(realRoot + path.sep)
  if (!inside(target)) {
    return { kind: "bad-request" }
  }
  try {
    const real = fs.realpathSync(target)
    if (!inside(real)) {
      return { kind: "bad-request" }
    }
    if (fs.statSync(real).isFile()) {
      return { kind: "file", file: real, spaFallback: false }
    }
  } catch {
    // does not exist — fall through
  }

  const last = segments[segments.length - 1]
  if (path.extname(last)) {
    return { kind: "not-found" }
  }
  return fs.existsSync(index) ? { kind: "file", file: index, spaFallback: true } : { kind: "not-found" }
}

/**
 * Content-Security-Policy of the app. It talks to every shop the merchant adds, so `connect-src` allows any https
 * origin; plain http only for loopback (same rule as in the app's "add shop" check). Scripts only from the app
 * itself; `'wasm-unsafe-eval'` is for the barcode decoder (WebAssembly), it does not allow `eval()`.
 */
export const CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "'wasm-unsafe-eval'"],
  "style-src": ["'self'"],
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "font-src": ["'self'"],
  "connect-src": ["'self'", "https:", "http://localhost:*", "http://*.localhost:*", "http://127.0.0.1:*"],
  "worker-src": ["'self'"],
  "manifest-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
}

const styleHashCache = new Map<string, { mtimeMs: number; hashes: string[] }>()

/** sha256 sources for the inline <style> blocks of an HTML file (the offline page ships one). Cached per file version. */
function inlineStyleHashes(file: string, mtimeMs: number): string[] {
  const hit = styleHashCache.get(file)
  if (hit && hit.mtimeMs === mtimeMs) return hit.hashes
  const html = fs.readFileSync(file, "utf8")
  const hashes = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(
    (m) => `'sha256-${crypto.createHash("sha256").update(m[1], "utf8").digest("base64")}'`
  )
  styleHashCache.set(file, { mtimeMs, hashes })
  return hashes
}

/** The policy as a header value; `extraStyleSources` are hashes of inline styles in the file being served. */
export function contentSecurityPolicy(extraStyleSources: string[] = []): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([name, sources]) => [name, ...(name === "style-src" ? [...sources, ...extraStyleSources] : sources)].join(" "))
    .join("; ")
}

function cacheControl(file: string, root: string): string {
  const rel = path.relative(fs.realpathSync(root), file).split(path.sep).join("/")
  const base = path.basename(file)
  if (base === "sw.js" || base === "index.html" || base.endsWith(".webmanifest") || base === "manifest.json") {
    return "no-cache"
  }
  // Vite puts content-hashed files under assets/
  if (rel.startsWith("assets/")) {
    return "public, max-age=31536000, immutable"
  }
  return "public, max-age=3600"
}

/**
 * Express-style global middleware mounted on `/medusify`. Serves the PWA bundle; anything that is
 * not GET/HEAD falls through (404 from Medusa). Ends the response itself, so no other route sees it.
 */
export async function medusifyStaticMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return next()
  }

  // Security headers go on every answer from this middleware, including redirects and errors.
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("Referrer-Policy", "no-referrer")
  res.setHeader("Content-Security-Policy", contentSecurityPolicy())
  // Medusa sets `SAMEORIGIN` and `frame-ancestors 'self'` on everything; the app is never framed, not even by the shop.
  res.setHeader("X-Frame-Options", "DENY")

  let root: string | null = null
  try {
    const service: MedusifyPushModuleService = req.scope.resolve(MEDUSIFY_PUSH_MODULE)
    root = service.getConfig().pwaDir ?? defaultPwaDir()
  } catch {
    root = defaultPwaDir()
  }
  if (!root) {
    res.status(404).type("text/plain").send("medusify PWA is not installed")
    return
  }

  const resolved = resolveAsset(req.originalUrl, root)

  switch (resolved.kind) {
    case "redirect":
      res.redirect(308, resolved.location)
      return
    case "bad-request":
      res.status(400).type("text/plain").send("bad path")
      return
    case "not-found":
      res.status(404).type("text/plain").send("not found")
      return
  }

  const stat = await fs.promises.stat(resolved.file)
  const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`
  const file = resolved.file
  const ext = path.extname(file).toLowerCase()

  res.setHeader("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream")
  if (ext === ".html") {
    res.setHeader("Content-Security-Policy", contentSecurityPolicy(inlineStyleHashes(file, stat.mtimeMs)))
  }
  res.setHeader("Cache-Control", cacheControl(file, root))
  res.setHeader("ETag", etag)
  res.setHeader("Last-Modified", stat.mtime.toUTCString())
  if (path.basename(file) === "sw.js") {
    res.setHeader("Service-Worker-Allowed", `${MEDUSIFY_PWA_BASE_PATH}/`)
  }

  if (req.headers["if-none-match"] === etag) {
    res.status(304).end()
    return
  }
  res.setHeader("Content-Length", String(stat.size))
  if (req.method === "HEAD") {
    res.status(200).end()
    return
  }
  res.status(200)
  fs.createReadStream(file)
    .on("error", () => {
      if (!res.headersSent) res.status(500)
      res.end()
    })
    .pipe(res)
}

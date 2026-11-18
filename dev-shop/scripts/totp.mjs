// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) for the dev shop. Shared by enroll-mfa.mjs and the E2E tests.
import { createHmac } from "node:crypto"

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function base32Decode(input) {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase()
  let bits = ""
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx < 0) throw new Error("invalid base32 character")
    bits += idx.toString(2).padStart(5, "0")
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

export function totp(secret, now = Date.now()) {
  const counter = Math.floor(now / 1000 / 30)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(code).padStart(6, "0")
}

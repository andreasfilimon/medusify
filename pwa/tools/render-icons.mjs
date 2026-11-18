// Renders the PNG icons from the two own SVG sources with Chromium (own work, MIT with the project).
import { chromium } from "@playwright/test"
import { readFileSync, writeFileSync } from "node:fs"

const any = readFileSync("public/icons/icon.svg", "utf8")
const maskable = readFileSync("public/icons/icon-maskable.svg", "utf8")
const jobs = [
  [any, 180, "public/apple-touch-icon.png"],
  [any, 192, "public/icons/icon-192.png"],
  [any, 512, "public/icons/icon-512.png"],
  [maskable, 512, "public/icons/icon-maskable-512.png"],
]
const browser = await chromium.launch()
for (const [svg, size, out] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
  writeFileSync(out, await page.screenshot({ type: "png", omitBackground: false }))
  await page.close()
}
await browser.close()

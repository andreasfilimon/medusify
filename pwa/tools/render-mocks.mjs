#!/usr/bin/env node
// render-mocks: renders docs/mocks/*.html with Playwright WebKit (iPhone 15), light and dark, writes screenshots to
// docs/mocks/shots/ and a measurement log (shots/render-log.txt).
// Per image it measures: scrollWidth == innerWidth, controls >= 44x44 px, inputs >= 16 px, computed font-family.
// Run from the pwa folder: `npm run mocks` (needs `npx playwright install webkit` once).
// Exit 0 = all measurements pass, 1 = at least one measurement failed, 2 = browser or file not available.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { webkit, devices } = await import('@playwright/test').catch((e) => { console.error('Playwright is missing (run npm ci in pwa/):', e.message); process.exit(2); });
const mocks = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'mocks');
const shots = path.join(mocks, 'shots');
fs.mkdirSync(shots, { recursive: true });

const targets = [
  { name: 'start', file: 'start.html' },
  { name: 'bestellliste', file: 'bestellliste.html' },
  { name: 'bestelldetail', file: 'bestelldetail.html' },
  { name: 'versenden-sheet', file: 'bestelldetail.html', hash: '#versenden' },
];
const log = [];
let bad = 0;
const browser = await webkit.launch().catch((e) => { console.error('WebKit does not start:', e.message); process.exit(2); });
log.push(`Browser: WebKit ${browser.version()}  ·  Playwright device: iPhone 15 (viewport 393×852 to simulate a full-screen standalone app)`);

for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], viewport: { width: 393, height: 852 }, colorScheme: scheme });
  for (const t of targets) {
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(path.join(mocks, t.file)).href + (t.hash || ''));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !el.closest('[hidden]') && !(el.closest('.overlay') && getComputedStyle(el.closest('.overlay')).display === 'none'); };
      const small = [...document.querySelectorAll('a[href], button, input, select, [role=tab], [role=switch]')].filter(vis).map((el) => {
        const r = el.getBoundingClientRect();
        return { el: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') + ' "' + (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().slice(0, 28) + '"', w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
      }).filter((x) => x.w < 44 || x.h < 44);
      const inputs = [...document.querySelectorAll('input')].filter(vis).map((i) => ({ el: i.getAttribute('aria-label') || i.placeholder || i.value, px: parseFloat(getComputedStyle(i).fontSize) })).filter((x) => x.px < 16);
      const tiny = [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && e.textContent.trim() && vis(e)).filter((e) => parseFloat(getComputedStyle(e).fontSize) < 11).map((e) => e.textContent.trim().slice(0, 20));
      return {
        scrollX: (() => { const e = document.querySelector('.scroll'); return e ? e.scrollWidth - e.clientWidth : 0; })(),
        sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body.scrollWidth,
        small, inputs, tiny,
        font: getComputedStyle(document.body).fontFamily, rootPx: getComputedStyle(document.documentElement).fontSize,
        notoLoaded: document.fonts.check('16px "Noto Sans"'),
        textOverflow: [...document.querySelectorAll('.row-main, .amount, .chip, .row-end')].filter(vis).filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === 'ellipsis').map((e) => e.textContent.trim().slice(0, 30)),
      };
    });
    const ok = m.sw === m.iw && m.bw <= m.iw && m.scrollX <= 0 && m.small.length === 0 && m.inputs.length === 0 && m.tiny.length === 0;
    if (!ok) bad++;
    const base = `${t.name}-${scheme}`;
    await page.screenshot({ path: path.join(shots, `${base}.png`) });
    if (!t.hash) {
      await page.evaluate(() => { const s = document.querySelector('.scroll'); if (s) s.scrollTop = s.scrollHeight; });
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(shots, `${base}-unten.png`) });
    }
    log.push(`${ok ? 'OK  ' : 'FAIL'} ${base}: scrollWidth=${m.sw} innerWidth=${m.iw} body=${m.bw} scroll-overflow-x=${m.scrollX} · tap targets<44: ${m.small.length} · inputs<16px: ${m.inputs.length} · text<11px: ${m.tiny.length} · Root=${m.rootPx} · Noto Sans loaded=${m.notoLoaded} · font-family="${m.font}"`);
    for (const s of m.small) log.push(`     too small: ${s.el} ${s.w}×${s.h}`);
    for (const s of m.inputs) log.push(`     input <16px: ${s.el} ${s.px}px`);
    for (const s of m.textOverflow) log.push(`     text truncated (ellipsis): ${s}`);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
log.push(`RESULT: ${bad === 0 ? 'all measurements pass' : bad + ' image(s) with a failed measurement'}`);
fs.writeFileSync(path.join(shots, 'render-log.txt'), log.join('\n') + '\n');
console.log(log.join('\n'));
process.exit(bad ? 1 : 0);

#!/usr/bin/env node
// build-tokens: generates docs/mocks/tokens.css and the GEN blocks in docs/DESIGN.md from tokens.json,
// computes WCAG 2.x contrast ratios (light and dark) and checks for drift.
//   node docs/tools/build-tokens.mjs           build and measure
//   node docs/tools/build-tokens.mjs --check   check only (writes nothing)
// Exit 0 = all green · 1 = contrast missed · 2 = drift (hex without a source, raw hex in mocks) · 3 = file missing
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.resolve(here, '..');
const tokens = JSON.parse(fs.readFileSync(path.join(here, 'tokens.json'), 'utf8'));
const CHECK = process.argv.includes('--check');

// ---- WCAG 2.x --------------------------------------------------------------
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const col = (name, mode) => {
  const c = tokens.color[name];
  if (!c) throw new Error(`Missing token: ${name}`);
  return c[mode].toUpperCase();
};

// ---- Kontrasttabelle -------------------------------------------------------
let failed = 0;
const rows = [];
for (const [fg, bg, min, what] of tokens.pairs) {
  const l = ratio(col(fg, 'light'), col(bg, 'light'));
  const d = ratio(col(fg, 'dark'), col(bg, 'dark'));
  const okL = l >= min, okD = d >= min;
  if (!okL || !okD) failed++;
  rows.push(`| ${what} | \`${fg}\` on \`${bg}\` | ${min} | ${l.toFixed(2)} ${okL ? '✓' : '✗'} | ${d.toFixed(2)} ${okD ? '✓' : '✗'} |`);
}
const contrastMd = [
  '| Pair | Tokens | Required | Light | Dark |',
  '|---|---|---|---|---|',
  ...rows,
].join('\n');

// ---- Farb-Tabelle ----------------------------------------------------------
const colorMd = [
  '| Token | Light | Dark | Role |',
  '|---|---|---|---|',
  ...Object.entries(tokens.color).map(([k, v]) => `| \`--${k}\` | \`${v.light.toUpperCase()}\` | \`${v.dark.toUpperCase()}\` | ${v.role} |`),
].join('\n');

// ---- Typo-Tabelle ----------------------------------------------------------
const typeMd = [
  '| Style | Size | Line height | Weight | Letter spacing | Matches |',
  '|---|---|---|---|---|---|',
  ...tokens.type.map((t) => `| \`${t.name}\` | ${t.rem} rem (${Math.round(t.rem * 17)} px at 17 px root) | ${t.lh} | ${t.weight} | ${t.ls} | iOS ${t.ios} |`),
].join('\n');

// ---- Skalen-Tabelle --------------------------------------------------------
const scaleMd = [
  '| Group | Value |',
  '|---|---|',
  `| Spacing (px, 4 pt grid) | ${Object.entries(tokens.space).map(([k, v]) => `\`--space-${k}\` ${v}`).join(' · ')} |`,
  `| Radii (px) | ${Object.entries(tokens.radius).map(([k, v]) => `\`--radius-${k}\` ${v}`).join(' · ')} |`,
  `| Sizes (px) | ${Object.entries(tokens.size).map(([k, v]) => `\`--size-${k}\` ${v}`).join(' · ')} |`,
  `| Shadow sheet | Light \`${tokens.shadow.sheet.light}\` · Dark \`${tokens.shadow.sheet.dark}\` |`,
  `| Shadow popover | Light \`${tokens.shadow.popover.light}\` · Dark \`${tokens.shadow.popover.dark}\` |`,
  `| Motion | ${Object.entries(tokens.motion).map(([k, v]) => `\`--${k}\` ${v}`).join(' · ')} |`,
].join('\n');

// ---- tokens.css ------------------------------------------------------------
const colorVars = (mode, indent) => Object.keys(tokens.color).map((k) => `${indent}--${k}: ${col(k, mode)};`).join('\n');
const shadowVars = (mode, indent) => Object.entries(tokens.shadow).map(([k, v]) => `${indent}--shadow-${k}: ${v[mode]};`).join('\n');
const css = `/* GENERATED from docs/tools/tokens.json by docs/tools/build-tokens.mjs. Do not edit by hand. */
:root {
  color-scheme: light dark;
${colorVars('light', '  ')}
${shadowVars('light', '  ')}
${Object.entries(tokens.space).map(([k, v]) => `  --space-${k}: ${v}px;`).join('\n')}
${Object.entries(tokens.radius).map(([k, v]) => `  --radius-${k}: ${v}px;`).join('\n')}
${Object.entries(tokens.size).map(([k, v]) => `  --size-${k}: ${v}px;`).join('\n')}
${Object.entries(tokens.motion).map(([k, v]) => `  --${k}: ${v};`).join('\n')}
${tokens.type.map((t) => `  --fs-${t.name}: ${t.rem}rem; --lh-${t.name}: ${t.lh}; --fw-${t.name}: ${t.weight}; --ls-${t.name}: ${t.ls};`).join('\n')}
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${colorVars('dark', '    ')}
${shadowVars('dark', '    ')}
  }
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] {
  color-scheme: dark;
${colorVars('dark', '  ')}
${shadowVars('dark', '  ')}
}
/* Increased contrast (iOS "Increase Contrast"): secondary text becomes primary text, hairlines become the input border. */
@media (prefers-contrast: more) {
  :root { --label-2: var(--label); --label-3: var(--label-2); --separator: var(--border-input); }
}
${tokens.type.map((t) => `.t-${t.name} { font-size: var(--fs-${t.name}); line-height: var(--lh-${t.name}); font-weight: var(--fw-${t.name}); letter-spacing: var(--ls-${t.name}); }`).join('\n')}
.num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
`;

// ---- GEN blocks in DESIGN.md ----------------------------------------------
const designPath = path.join(docs, 'DESIGN.md');
if (!fs.existsSync(designPath)) { console.error('docs/DESIGN.md is missing'); process.exit(3); }
let design = fs.readFileSync(designPath, 'utf8');
const blocks = { colors: colorMd, contrast: contrastMd, type: typeMd, scale: scaleMd };
for (const [name, body] of Object.entries(blocks)) {
  const re = new RegExp(`(<!-- GEN:${name} -->)[\\s\\S]*?(<!-- /GEN:${name} -->)`);
  if (!re.test(design)) { console.error(`Marker GEN:${name} is missing in DESIGN.md`); process.exit(3); }
  design = design.replace(re, `$1\n${body}\n$2`);
}
if (!CHECK) {
  fs.writeFileSync(path.join(docs, 'mocks', 'tokens.css'), css);
  fs.writeFileSync(designPath, design);
}

// ---- Drift check ---------------------------------------------------------
const hexes = (s) => new Set((s.match(/#[0-9a-fA-F]{6}\b/g) || []).map((h) => h.toUpperCase()));
const source = new Set(Object.values(tokens.color).flatMap((v) => [v.light.toUpperCase(), v.dark.toUpperCase()]));
const cssFile = fs.readFileSync(path.join(docs, 'mocks', 'tokens.css'), 'utf8');
const designNow = fs.readFileSync(designPath, 'utf8');
const problems = [];
for (const h of hexes(cssFile)) if (!hexes(designNow).has(h)) problems.push(`tokens.css hex ${h} is missing in DESIGN.md`);
for (const h of hexes(designNow)) if (!source.has(h)) problems.push(`DESIGN.md hex ${h} is not in tokens.json`);
if (CHECK && fs.readFileSync(designPath, 'utf8') !== design) problems.push('DESIGN.md: GEN blocks (colors, contrast, type, scale) are stale (rebuild without --check)');
if (CHECK && cssFile !== css) problems.push('tokens.css is stale (rebuild without --check)');
// Mocks must not carry raw hex colors (everything goes through tokens)
const mockDir = path.join(docs, 'mocks');
for (const f of fs.readdirSync(mockDir)) {
  if (!/\.(html|css)$/.test(f) || f === 'tokens.css') continue;
  // <meta name="theme-color"> needs a literal; allowed as long as the value is a token hex (checked below)
  const src = fs.readFileSync(path.join(mockDir, f), 'utf8');
  for (const h of hexes(src.match(/<meta name="theme-color"[^>]*>/g)?.join('') || '')) if (!source.has(h)) problems.push(`${f}: theme-color ${h} is not in tokens.json`);
  const hit = src.replace(/<meta name="theme-color"[^>]*>/g, '').match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-zA-Z_-])/g);
  if (hit) problems.push(`${f}: Roh-Hex ${[...new Set(hit)].join(', ')} (use a token)`);
}

console.log(contrastMd.split('\n').slice(2).map((l) => l.replace(/\|/g, ' ').replace(/\s+/g, ' ')).join('\n'));
console.log(`\nContrast: ${rows.length} pairs × 2 modes, ${failed} pair(s) missed`);
console.log(`Drift: ${problems.length ? '\n  ' + problems.join('\n  ') : 'none'}`);
process.exit(failed ? 1 : problems.length ? 2 : 0);

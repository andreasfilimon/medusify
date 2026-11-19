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

// ---- Material, P3, Federn: Rechenhelfer -----------------------------------------
const rgbOf = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const lumRgb = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratioY = (x, y) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
/** Browsers composite in gamma-encoded sRGB: fg at share `mix` over bg. */
const over = (fgHex, mix, bgHex) => { const f = rgbOf(fgHex), b = rgbOf(bgHex); return f.map((v, i) => Math.round(v * mix + b[i] * (1 - mix))); };
const M = tokens.material;
const materialRows = [];
const materialComposite = (mode, backdropHex) => over(col(M.base, mode), M.mix[mode], backdropHex);

// Display P3 variant of an sRGB color: more chroma at the same relative luminance, so every contrast value stays.
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const toOklab = ([r, g, b]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const fromOklab = ([L, a, b]) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
};
const SRGB_TO_P3 = [[0.8224621, 0.177538, 0], [0.0331941, 0.9668058, 0], [0.0170827, 0.0723974, 0.9105199]];
const yOfLinear = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function p3Variant(hex, boost) {
  const lin3 = rgbOf(hex).map((v) => toLinear(v / 255));
  const target = yOfLinear(lin3);
  const [L0, a0, b0] = toOklab(lin3);
  const C0 = Math.hypot(a0, b0), h = Math.atan2(b0, a0);
  for (let k = boost; k >= 1; k -= 0.01) {
    let lo = L0 - 0.1, hi = L0 + 0.1, rgb = lin3;
    for (let i = 0; i < 40; i++) { // same luminance: find L whose Y equals the original
      const mid = (lo + hi) / 2;
      rgb = fromOklab([mid, C0 * k * Math.cos(h), C0 * k * Math.sin(h)]);
      if (yOfLinear(rgb) < target) lo = mid; else hi = mid;
    }
    const p3 = SRGB_TO_P3.map((row) => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]);
    if (p3.every((v) => v >= -1e-4 && v <= 1 + 1e-4)) {
      const enc = p3.map((v) => Math.min(1, Math.max(0, fromLinear(Math.max(0, v)))));
      return { css: `color(display-p3 ${enc.map((v) => v.toFixed(4)).join(' ')})`, y: yOfLinear(rgb), k };
    }
  }
  return { css: null, y: target, k: 1 };
}
const p3Of = {};
for (const name of tokens.p3.tokens) {
  p3Of[name] = {};
  for (const mode of ['light', 'dark']) p3Of[name][mode] = p3Variant(col(name, mode), tokens.p3.boost);
}

// Damped spring as a CSS linear() easing (step response of x'' + 2ζω x' + ω² x = ω²)
function springOf({ damping: z, response }) {
  const w = (2 * Math.PI) / response, wd = w * Math.sqrt(1 - z * z);
  const x = (t) => 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
  let T = response;
  for (let t = 0; t < 6; t += 0.005) if (Math.abs(x(t) - 1) > 0.002) T = t + 0.005;
  const N = 48;
  const pts = Array.from({ length: N + 1 }, (_, i) => (i === 0 ? 0 : i === N ? 1 : +x((i / N) * T).toFixed(4)));
  let peak = 0;
  for (let t = 0; t <= T; t += 0.002) peak = Math.max(peak, x(t));
  return { css: `linear(${pts.join(', ')})`, ms: Math.round(T * 1000), overshoot: Math.max(0, peak - 1) };
}
const springs = Object.fromEntries(Object.entries(tokens.spring).map(([k, v]) => [k, { ...v, ...springOf(v) }]));

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

// ---- Material: Kontrast auf dem ungünstigsten Hintergrund -------------------
for (const [fg, min, what] of M.pairs) {
  const cells = [];
  for (const mode of ['light', 'dark']) {
    const comp = materialComposite(mode, col(M.backdrop, mode));
    const r = ratioY(lum(col(fg, mode)), lumRgb(comp));
    if (r < min) failed++;
    cells.push(`${r.toFixed(2)} ${r >= min ? '✓' : '✗'} (rgb ${comp.join(' ')})`);
  }
  materialRows.push(`| ${what} | \`${fg}\` on material over \`${M.backdrop}\` | ${min} | ${cells[0]} | ${cells[1]} |`);
}
const materialMd = [
  `Material = \`--${M.base}\` at ${Math.round(M.mix.light * 100)} % (light) and ${Math.round(M.mix.dark * 100)} % (dark) over the worst case: a solid area of \`--${M.backdrop}\` behind it (darkest thing in light mode, lightest in dark mode). Blur ${M.blur} px, saturation ${M.saturate}.`,
  '',
  '| Pair | Measured on | Required | Light | Dark |',
  '|---|---|---|---|---|',
  ...materialRows,
].join('\n');

const p3Rows = [];
for (const name of tokens.p3.tokens) {
  const L = p3Of[name].light, D = p3Of[name].dark;
  p3Rows.push(`| \`--${name}\` | \`${col(name, 'light')}\` → \`${L.css}\` (chroma × ${L.k.toFixed(2)}) | \`${col(name, 'dark')}\` → \`${D.css}\` (chroma × ${D.k.toFixed(2)}) |`);
  if (!L.css || !D.css) failed++;
}
// every contrast pair that uses a P3 token is re-measured with the P3 luminance
const p3Pairs = [];
for (const [fg, bg, min, what] of tokens.pairs) {
  if (!tokens.p3.tokens.includes(fg) && !tokens.p3.tokens.includes(bg)) continue;
  const cell = (mode) => {
    const y = (n) => (p3Of[n] ? p3Of[n][mode].y : lum(col(n, mode)));
    const r = ratioY(y(fg), y(bg));
    if (r + 1e-3 < min) failed++;
    return `${r.toFixed(2)} ${r + 1e-3 >= min ? '✓' : '✗'}`;
  };
  p3Pairs.push(`| ${what} | \`${fg}\` on \`${bg}\` | ${min} | ${cell('light')} | ${cell('dark')} |`);
}
const p3Md = [
  `Where the screen shows Display P3 (\`@media (color-gamut: p3)\`), these tokens get a more saturated variant at the same luminance (chroma × ${tokens.p3.boost} at most, reduced until it fits the P3 gamut). Everything else, and every other screen, uses the sRGB hex above.`,
  '',
  '| Token | Light: sRGB → P3 | Dark: sRGB → P3 |',
  '|---|---|---|',
  ...p3Rows,
  '',
  'Contrast of the pairs that use them, measured with the P3 luminance:',
  '',
  '| Pair | Tokens | Required | Light | Dark |',
  '|---|---|---|---|---|',
  ...p3Pairs,
].join('\n');
const springMd = [
  '| Spring | Damping ζ | Response (s) | Settles after | Overshoot | Use |',
  '|---|---|---|---|---|---|',
  ...Object.entries(springs).map(([k, v]) => `| \`${k}\` | ${v.damping} | ${v.response} | ${v.ms} ms | ${(v.overshoot * 100).toFixed(1)} % | ${v.role} |`),
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
  `| Shadow float | Light \`${M.float.light}\` · Dark \`${M.float.dark}\` |`,
  `| Edge glare | Light \`${M.glare.light}\` · Dark \`${M.glare.dark}\` |`,
  `| Motion | ${Object.entries(tokens.motion).map(([k, v]) => `\`--${k}\` ${v}`).join(' · ')} |`,
].join('\n');

// Concentric corners: inner radius = outer radius − gap
const concentric = [
  ['sheet 28 − page margin 16 = group', tokens.radius.sheet - tokens.space['4'], tokens.radius.group],
  ['capsule radius = capsule height / 2', tokens.size.capsule / 2, tokens.radius.capsule],
  ['capsule radius − gap = tab indicator', tokens.radius.capsule - tokens.size['capsule-gap'], tokens.radius.indicator],
];
const concentricMd = concentric.map(([what, got, want]) => `| ${what} | ${got} | ${want} | ${got === want ? '✓' : '✗'} |`);

// ---- tokens.css ------------------------------------------------------------
const colorVars = (mode, indent) => Object.keys(tokens.color).map((k) => `${indent}--${k}: ${col(k, mode)};`).join('\n');
const shadowVars = (mode, indent) => [
  ...Object.entries(tokens.shadow).map(([k, v]) => `${indent}--shadow-${k}: ${v[mode]};`),
  `${indent}--material-mix: ${Math.round(M.mix[mode] * 100)}%;`,
  `${indent}--glare: ${M.glare[mode]};`,
  `${indent}--shadow-float: ${M.float[mode]};`,
].join('\n');
const p3Vars = (mode, indent) => tokens.p3.tokens.filter((n) => p3Of[n][mode].css).map((n) => `${indent}--${n}: ${p3Of[n][mode].css};`).join('\n');
const springVars = (indent, real) => Object.entries(springs).map(([k, v]) => `${indent}--ease-spring-${k}: ${real ? v.css : 'var(--ease-sheet)'};`).join('\n');
const css = `/* GENERATED from docs/tools/tokens.json by docs/tools/build-tokens.mjs. Do not edit by hand. */
:root {
  color-scheme: light dark;
${colorVars('light', '  ')}
${shadowVars('light', '  ')}
${Object.entries(tokens.space).map(([k, v]) => `  --space-${k}: ${v}px;`).join('\n')}
${Object.entries(tokens.radius).map(([k, v]) => `  --radius-${k}: ${v}px;`).join('\n')}
${Object.entries(tokens.size).map(([k, v]) => `  --size-${k}: ${v}px;`).join('\n')}
${Object.entries(tokens.motion).map(([k, v]) => `  --${k}: ${v};`).join('\n')}
${Object.entries(springs).map(([k, v]) => `  --dur-spring-${k}: ${v.ms}ms;`).join('\n')}
${springVars('  ', false)}
  --material-blur: ${M.blur}px;
  --material-saturate: ${M.saturate};
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
/* Springs: a damped-spring step response as linear(); browsers without linear() keep the cubic curve above. */
@supports (transition-timing-function: linear(0, 1)) {
  :root {
${springVars('    ', true)}
  }
}
/* Display P3 variants (same luminance, more chroma); sRGB hex above is the fallback. */
@supports (color: color(display-p3 1 1 1)) {
  @media (color-gamut: p3) {
    :root {
${p3Vars('light', '      ')}
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
${p3Vars('dark', '        ')}
      }
    }
    :root[data-theme="dark"] {
${p3Vars('dark', '      ')}
    }
  }
}
`;

// ---- GEN blocks in DESIGN.md ----------------------------------------------
const designPath = path.join(docs, 'DESIGN.md');
if (!fs.existsSync(designPath)) { console.error('docs/DESIGN.md is missing'); process.exit(3); }
let design = fs.readFileSync(designPath, 'utf8');
const blocks = { colors: colorMd, contrast: contrastMd, material: materialMd, p3: p3Md, spring: springMd, concentric: ['| Rule | Computed | Token | |', '|---|---|---|---|', ...concentricMd].join('\n'), type: typeMd, scale: scaleMd };
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
for (const [what, got, want] of concentric) if (got !== want) problems.push(`concentric radii: ${what} is ${got}, token says ${want}`);
if (CHECK && fs.readFileSync(designPath, 'utf8') !== design) problems.push('DESIGN.md: GEN blocks (colors, contrast, material, p3, spring, concentric, type, scale) are stale (rebuild without --check)');
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

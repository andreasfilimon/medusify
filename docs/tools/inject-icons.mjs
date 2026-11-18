#!/usr/bin/env node
// inject-icons: inlines the Phosphor icons (MIT) used by the mock HTML files as a <symbol> sprite between
// <!--SPRITE--> and <!--/SPRITE-->. Source: docs/mocks/icons/<name>.svg (from @phosphor-icons/core 2.1.1).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mocks = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'mocks');
let missing = 0;
for (const f of fs.readdirSync(mocks).filter((n) => n.endsWith('.html'))) {
  const file = path.join(mocks, f);
  let html = fs.readFileSync(file, 'utf8');
  const used = [...new Set([...html.matchAll(/href="#i-([a-z0-9-]+)"/g)].map((m) => m[1]))].sort();
  const symbols = used.map((n) => {
    const p = path.join(mocks, 'icons', `${n}.svg`);
    if (!fs.existsSync(p)) { console.error(`${f}: icon missing: ${n}`); missing++; return ''; }
    const inner = fs.readFileSync(p, 'utf8').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    return `<symbol id="i-${n}" viewBox="0 0 256 256">${inner}</symbol>`;
  });
  const sprite = `<!--SPRITE--><svg width="0" height="0" style="position:absolute" aria-hidden="true">${symbols.join('')}</svg><!--/SPRITE-->`;
  if (!/<!--SPRITE-->[\s\S]*?<!--\/SPRITE-->/.test(html)) { console.error(`${f}: marker missing`); missing++; continue; }
  html = html.replace(/<!--SPRITE-->[\s\S]*?<!--\/SPRITE-->/, () => sprite);
  fs.writeFileSync(file, html);
  console.log(`${f}: ${used.length} icons`);
}
process.exit(missing ? 1 : 0);

#!/usr/bin/env node
// Checks "introduced before use" across the book.
//
// For every chapter (teaching drafts and yours):
//   UNDECLARED  text uses a registry term that's in neither `assumes` nor
//               `introduces` → add it to `assumes` (it'll appear in the
//               refresher box) or explain it and add it to `introduces`.
//   ORDER       an assumed concept is only introduced in a LATER chapter.
//   UNKNOWN     assumes/introduces lists an id missing from concepts.yaml.
//   PLANNED     (info) an assumed concept's introducing chapter isn't written
//               yet; the refresher box covers it for now.
//
// Usage: npm run concepts            report
//        npm run concepts -- --strict   exit 1 on UNDECLARED / ORDER / UNKNOWN

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';

const ROOT = new URL('..', import.meta.url).pathname;
const strict = process.argv.includes('--strict');
const concepts = YAML.parse(readFileSync(join(ROOT, 'src/data/concepts.yaml'), 'utf8'));
const byId = new Map(concepts.map((c) => [c.id, c]));

const key = (v, c) => `v${v}-${String(c).padStart(2, '0')}`;
const order = (k) => {
  const m = k.match(/^v(\d)-(\d+)$/);
  return m ? Number(m[1]) * 100 + Number(m[2]) : Infinity;
};

function files(dir) {
  const d = join(ROOT, dir);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith('.mdx')).map((f) => join(d, f));
}

const allChapters = [...files('src/content/teaching'), ...files('src/content/chapters')].map((file) => {
  const src = readFileSync(file, 'utf8');
  const fmText = src.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const fm = YAML.parse(fmText) ?? {};
  return { file, src, fm, key: key(fm.volume, fm.chapter) };
});
const written = new Set(allChapters.filter((c) => c.fm.status !== 'not-started').map((c) => c.key));

/** Chapter body as prose: drop frontmatter, comments, imports, JSX tags (keep their text content), code. */
function prose(src) {
  return src
    .replace(/^---\n[\s\S]*?\n---/, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^import .*$/gm, '')
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
    .replace(/<[^>]*>/g, (m) => m.replace(/[^\n]/g, ' '));
}

function aliasRegex(alias) {
  const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Plain words: whole-word, case-insensitive (except short ALL-CAPS/codes like C4, ERB, Hz: case-sensitive).
  if (/^[\w\s-]+$/.test(alias)) {
    const caseSensitive = /\d/.test(alias) || /^[A-Z]{2,}$/.test(alias) || alias === 'Hz';
    return new RegExp(`(?<![\\w-])${esc}(?![\\w-])`, caseSensitive ? 'g' : 'gi');
  }
  return new RegExp(esc, 'g'); // symbols like ♯ ¢: plain substring
}

let problems = 0;
const out = [];
for (const ch of allChapters.sort((x, y) => order(x.key) - order(y.key))) {
  if (ch.fm.status === 'not-started') continue;
  const assumes = ch.fm.assumes ?? [];
  const introduces = ch.fm.introduces ?? [];
  const declared = new Set([...assumes, ...introduces]);
  const ignored = new Set(ch.fm.lintIgnore ?? []);
  const body = prose(ch.src);
  const lines = [];

  for (const id of declared) if (!byId.has(id)) lines.push(`  UNKNOWN     "${id}" is not in concepts.yaml`);

  for (const id of assumes) {
    const c = byId.get(id);
    if (!c) continue;
    if (order(c.introducedIn) > order(ch.key))
      lines.push(`  ORDER       assumes "${id}", but it's introduced later (${c.introducedIn}). Introduce it here or move it earlier.`);
    else if (!written.has(c.introducedIn) && c.introducedIn !== ch.key)
      lines.push(`  PLANNED     "${id}" → ${c.introducedIn} (not written yet; refresher box covers it)`);
  }

  for (const c of concepts) {
    if (declared.has(c.id) || ignored.has(c.id)) continue;
    for (const alias of c.aliases ?? []) {
      const m = aliasRegex(alias).exec(body);
      if (m) {
        const line = body.slice(0, m.index).split('\n').length;
        lines.push(`  UNDECLARED  L${line} "${m[0]}" → concept "${c.id}" (add to assumes or introduces)`);
        break;
      }
    }
  }

  const real = lines.filter((l) => !l.includes('PLANNED'));
  problems += real.length;
  out.push(`\n${relative(ROOT, ch.file)}  [${ch.key}, ${ch.fm.status}]`);
  out.push(...(lines.length ? lines : ['  (clean)']));
}

console.log(out.join('\n'));
console.log(`\n${problems} problem(s).`);
if (strict && problems) process.exit(1);

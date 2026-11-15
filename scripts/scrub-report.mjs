#!/usr/bin/env node
// Lists everything that stands between the current content and a public site.
// Usage: npm run scrub        (report)
//        npm run scrub -- --strict   (exit 1 if anything blocks public-ready chapters)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const strict = process.argv.includes('--strict');

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : d.name.endsWith('.mdx') ? [join(dir, d.name)] : [],
  );
}

function frontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (m) for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

// --- tracks ---
const tracksSrc = readFileSync(join(ROOT, 'src/data/tracks.yaml'), 'utf8');
const tracks = {};
for (const block of tracksSrc.split(/\n(?=- id:)/)) {
  const id = block.match(/- id:\s*(\S+)/)?.[1];
  if (!id) continue;
  tracks[id] = {
    rights: block.match(/\n\s+rights:\s*(\S+)/)?.[1] ?? 'unknown',
    youtube: block.match(/\n\s+youtube:\s*(\S+)/)?.[1] ?? 'null',
    listened: block.match(/\n\s+listened:\s*(\S+)/)?.[1] === 'true',
  };
}
const OK_RIGHTS = new Set(['embed-official', 'cc', 'public-domain', 'own']);

let blocking = 0;
const lines = [];
const say = (s = '') => lines.push(s);

for (const [label, dir] of [
  ['YOUR CHAPTERS', 'src/content/chapters'],
  ['TEACHING DRAFTS (never published; listed for reference)', 'src/content/teaching'],
]) {
  say(`\n=== ${label} ===`);
  for (const file of walk(join(ROOT, dir))) {
    const src = readFileSync(file, 'utf8');
    const fm = frontmatter(src);
    const rel = relative(ROOT, file);
    const isMine = dir.endsWith('chapters');
    const willPublish = isMine && fm.status === 'public-ready';
    const issues = [];
    // Blank out MDX comments (keeping newlines so line numbers stay right)
    // so example snippets inside comments aren't flagged.
    const body = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, (c) => c.replace(/[^\n]/g, ' '));

    for (const m of body.matchAll(/<Callout\s+kind="(verify|scrub)"(?:\s+title="([^"]*)")?/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      issues.push(`  L${line}  ${m[1].toUpperCase()}  ${m[2] ?? ''}`);
    }
    for (const m of src.matchAll(/\{\/\*\s*(SCRUB|TODO|VERIFY):?\s*([\s\S]*?)\*\/\}/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      issues.push(`  L${line}  ${m[1]} (comment)  ${m[2].trim().split('\n')[0]}`);
    }
    for (const m of body.matchAll(/<ListeningCue\s+track="([^"]+)"/g)) {
      const t = tracks[m[1]];
      const line = src.slice(0, m.index).split('\n').length;
      if (!t) issues.push(`  L${line}  TRACK  "${m[1]}" missing from tracks.yaml`);
      else {
        if (!OK_RIGHTS.has(t.rights)) issues.push(`  L${line}  RIGHTS  ${m[1]}: rights=${t.rights}`);
        if (t.youtube === 'null') issues.push(`  L${line}  TRACK  ${m[1]}: no specific recording chosen (youtube: null)`);
        if (!t.listened) issues.push(`  L${line}  LISTEN  ${m[1]}: not yet confirmed by ear (listened: false)`);
      }
    }
    if (isMine && /teaching draft|Claude/i.test(body))
      issues.push('  ??   TONE  mentions "Claude"/"teaching draft" in body text');

    say(`\n${rel}  [status: ${fm.status ?? '?'}]${willPublish ? '  <-- PUBLIC' : ''}`);
    if (!issues.length) say('  (clean)');
    else issues.forEach((i) => say(i));
    if (willPublish) blocking += issues.length;
  }
}

say('\n=== GLOBAL ===');
say('  - Base.astro adds <meta name="robots" content="noindex"> unless PUBLIC_SITE=1');
say('  - Teaching pages are excluded from PUBLIC_SITE=1 builds');
say('  - Callout verify/scrub throw during PUBLIC_SITE=1 builds');
say('  - See PUBLISHING.md for the manual checklist');
say(`\nBlocking issues in public-ready chapters: ${blocking}`);

console.log(lines.join('\n'));
if (strict && blocking) process.exit(1);

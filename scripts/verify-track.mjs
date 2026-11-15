#!/usr/bin/env node
// Verify Spotify track IDs and YouTube video IDs against their public pages
// (no login or API key needed), so tracks.yaml never contains guessed IDs.
//
//   npm run verify-track -- spotify:2zqLPc7SNIX1JZmKtbq2F6 youtube:hTWKbfoikeg
//   npm run verify-track -- --all     (checks every ID in src/data/tracks.yaml)

import { readFileSync } from 'node:fs';
import YAML from 'yaml';

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh) track-verifier' };
const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export async function spotify(id) {
  const r = await fetch(`https://open.spotify.com/track/${id}`, { headers: UA });
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
  const html = await r.text();
  const meta = (p) => decode(html.match(new RegExp(`<meta[^>]+(?:property|name)="${p}"[^>]+content="([^"]*)"`))?.[1] ?? '');
  const title = meta('og:title');
  // og:description looks like "Artist · Album · Song · Year"
  const desc = meta('og:description');
  const duration = Number(meta('music:duration')) || null;
  return title ? { ok: true, title, desc, duration } : { ok: false, error: 'no metadata' };
}

export async function youtube(id) {
  const r = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`, { headers: UA });
  if (!r.ok) return { ok: false, error: `HTTP ${r.status} (private, removed, or not embeddable)` };
  const d = await r.json();
  return { ok: true, title: d.title, channel: d.author_name };
}

const fmt = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');

async function check(kind, id, label = '') {
  const res = kind === 'spotify' ? await spotify(id) : await youtube(id);
  const head = `${kind.padEnd(8)} ${id.padEnd(24)}`;
  if (!res.ok) return console.log(`${head} ✗ ${res.error} ${label}`), false;
  const detail = kind === 'spotify' ? `${res.title} — ${res.desc} ${fmt(res.duration)}` : `${res.title} — channel: ${res.channel}`;
  console.log(`${head} ✓ ${detail}${label ? `   [${label}]` : ''}`);
  return true;
}

const args = process.argv.slice(2);
let bad = 0;
if (args.includes('--all')) {
  const tracks = YAML.parse(readFileSync(new URL('../src/data/tracks.yaml', import.meta.url), 'utf8'));
  for (const t of tracks) {
    if (t.spotify) bad += !(await check('spotify', t.spotify, t.id));
    if (t.youtube) bad += !(await check('youtube', t.youtube, t.id));
    if (!t.spotify && !t.youtube) console.log(`(none)    ${t.id}: no IDs yet`);
  }
} else {
  for (const a of args) {
    const [kind, id] = a.split(':');
    if (!['spotify', 'youtube'].includes(kind) || !id) {
      console.log(`skip "${a}" (use spotify:<id> or youtube:<id>)`);
      continue;
    }
    bad += !(await check(kind, id));
  }
}
process.exit(bad ? 1 : 0);

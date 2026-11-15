// A small self-experiment on syncopation and groove (after Witek et al. 2014).
// Seven drum patterns, presented in shuffled order with their syncopation
// scores hidden. Rate each for how much it makes you want to move, then
// reveal: your ratings are plotted against syncopation next to the
// inverted-U shape the study reported.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PARAMS, GroovePlayer, type Pattern, pat, patternSyncopation } from '../../lib/rhythm';
import { Widget, r2, useAudioOwner } from './ui';

const HAT = [0, 2, 4, 6, 8, 10, 12, 14];
const SPECS: { kick: number[]; snare: number[] }[] = [
  { kick: [0, 8], snare: [4, 12] },
  { kick: [0, 6, 10], snare: [4, 12] },
  { kick: [0, 3, 6, 10], snare: [4, 11] },
  { kick: [0, 3, 6, 9, 14], snare: [4, 11] },
  { kick: [0, 3, 7, 10, 14], snare: [5, 11] },
  { kick: [1, 3, 6, 9, 14], snare: [5, 11] },
  { kick: [1, 3, 7, 9, 14], snare: [5, 11, 15] },
];
const LETTERS = 'ABCDEFG';
const STORE = 'archmusic:groove-ratings:v1';
const W = 680;
const H = 200;

export default function GrooveComplexity({ bpm = 100 }: { bpm?: number }) {
  const items = useMemo(
    () =>
      SPECS.map((s, i) => {
        const snare = Object.fromEntries(s.snare.map((k) => [k, 2 as const]));
        const pattern: Pattern = pat({ kick: s.kick, snare, hat: HAT });
        return { key: i, pattern, score: patternSyncopation(pattern) };
      }),
    [],
  );
  const maxScore = Math.max(...items.map((i) => i.score));

  // Shuffle after mount (not during SSR) so server and client markup match.
  const [order, setOrder] = useState(items.map((i) => i.key));
  const [ratings, setRatings] = useState<Record<number, number>>({});
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const o = items.map((i) => i.key);
    for (let i = o.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [o[i], o[j]] = [o[j], o[i]];
    }
    setOrder(o);
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
      if (saved?.ratings) setRatings(saved.ratings);
    } catch {}
  }, [items]);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ ratings }));
    } catch {}
  }, [ratings]);

  // ---- audio ----
  const [playingKey, setPlayingKey] = useState<number | null>(null);
  const current = useRef<Pattern>(items[0].pattern);
  const player = useRef<GroovePlayer | null>(null);
  const stop = useCallback(() => {
    player.current?.stop();
    setPlayingKey(null);
  }, []);
  useAudioOwner(playingKey !== null, stop);
  useEffect(() => () => player.current?.stop(), []);

  const play = (key: number) => {
    if (playingKey === key) return stop();
    current.current = items[key].pattern;
    if (!player.current) player.current = new GroovePlayer(() => ({ pattern: current.current, params: { ...DEFAULT_PARAMS, bpm } }));
    player.current.start();
    setPlayingKey(key);
  };

  const rated = Object.keys(ratings).length;

  // ---- plot ----
  const px = (s: number) => r2(40 + (s / maxScore) * (W - 60));
  const py = (r: number) => r2(H - 30 - ((r - 1) / 4) * (H - 50));
  // Schematic inverted U (shape only, not the study's data): peak around a third of the way up the range.
  const curve = Array.from({ length: 41 }, (_, i) => {
    const s = (i / 40) * maxScore;
    const peak = maxScore * 0.4;
    const r = 1.6 + 2.6 * Math.exp(-(((s - peak) / (maxScore * 0.32)) ** 2));
    return (i ? 'L' : 'M') + px(s) + ' ' + py(r);
  }).join('');

  return (
    <Widget
      kicker="Experiment"
      title="How much does it make you want to move?"
      caption={
        <>
          Seven patterns at {bpm} BPM, all with the same steady hi-hat. Only the kick and snare change. They're shuffled,
          and their syncopation scores stay hidden until you reveal them, so you can't rate what you expect. The dashed
          curve after the reveal is a schematic of the <em>shape</em> Witek et al. (2014) reported, not their data.
          Ratings are saved only in this browser.
        </>
      }
    >
      <div className="w-rate-list">
        {order.map((key, pos) => {
          const it = items[key];
          return (
            <div key={key} className={'w-rate-row' + (playingKey === key ? ' is-playing' : '')}>
              <button type="button" className="w-play small" onClick={() => play(key)}>
                <span className="w-play-icon" aria-hidden>
                  {playingKey === key ? '■' : '▶'}
                </span>
                Pattern {LETTERS[pos]}
              </button>
              <span className="w-rate-buttons" role="radiogroup" aria-label={`Rating for pattern ${LETTERS[pos]}`}>
                {[1, 2, 3, 4, 5].map((r) => (
                  <button
                    type="button"
                    key={r}
                    role="radio"
                    aria-checked={ratings[key] === r}
                    className={ratings[key] === r ? 'is-on' : ''}
                    onClick={() => setRatings((x) => ({ ...x, [key]: r }))}
                  >
                    {r}
                  </button>
                ))}
              </span>
              {revealed && <span className="w-rate-score muted">syncopation {it.score}</span>}
            </div>
          );
        })}
      </div>
      <div className="w-controls">
        <span className="muted">1 = not at all, 5 = very much · {rated}/7 rated</span>
        <button type="button" className="w-play small" onClick={() => setRevealed((v) => !v)} disabled={rated < 3}>
          {revealed ? 'Hide scores' : rated < 3 ? 'Rate at least 3 to reveal' : 'Reveal scores'}
        </button>
        {rated > 0 && (
          <button type="button" className="w-chip" onClick={() => (setRatings({}), setRevealed(false))}>
            Reset
          </button>
        )}
      </div>

      {revealed && (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Your ratings against syncopation">
          {[1, 2, 3, 4, 5].map((r) => (
            <g key={r}>
              <line x1={40} x2={W - 20} y1={py(r)} y2={py(r)} className="stroke-grid" />
              <text x={30} y={py(r) + 4} textAnchor="end" className="w-tick">
                {r}
              </text>
            </g>
          ))}
          <path d={curve} className="stroke-ink dashed" />
          {items
            .filter((it) => ratings[it.key])
            .map((it) => (
              <circle key={it.key} cx={px(it.score)} cy={py(ratings[it.key])} r={6} className="fill-rough" />
            ))}
          <text x={40} y={H - 8} className="w-tick">
            ← less syncopated
          </text>
          <text x={W - 20} y={H - 8} textAnchor="end" className="w-tick">
            more syncopated →
          </text>
          <text x={W - 20} y={16} textAnchor="end" className="w-tick">
            dots: your ratings · dashed: inverted-U shape (schematic)
          </text>
        </svg>
      )}
    </Widget>
  );
}

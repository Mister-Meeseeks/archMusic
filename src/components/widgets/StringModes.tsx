// A vibrating string. Shows the standing-wave modes one at a time (each a
// harmonic) or all together as a pluck. The pluck position sets which
// harmonics are present: anything with a node where you pluck can't sound.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdditiveVoice } from '../../lib/audio';
import { pluckRecipe } from '../../lib/spectrum';
import { midiToHz } from '../../lib/tuning';
import { Segmented, Slider, Widget, r2, useAudioOwner } from './ui';

const W = 680;
const H = 150;
const PAD = 30;
const N_SHOW = 10;

export default function StringModes() {
  const [view, setView] = useState<number>(0); // 0 = plucked (all modes); n = single mode n
  const [p, setP] = useState(0.2);
  const [t, setT] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [playing, setPlaying] = useState(false);
  const voice = useRef<AdditiveVoice | null>(null);

  // Respect reduced-motion preferences.
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setAnimate(false);
  }, []);

  // Slow visual time: the fundamental completes one cycle every 2 s on screen.
  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      setT((now - t0) / 1000);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  const amps = useMemo(() => pluckRecipe(p, N_SHOW), [p]);

  const stop = useCallback(() => {
    voice.current?.stop(0.3);
    voice.current = null;
    setPlaying(false);
  }, []);
  useAudioOwner(playing, stop);

  const sound = () => {
    voice.current?.stop(0.05);
    const f0 = midiToHz(45); // A2, 110 Hz
    const spectrum = view === 0 ? amps.map((a, k) => ({ f: k + 1, a })).filter((x) => x.a > 0.001) : [{ f: view, a: 1 }];
    const v = new AdditiveVoice(spectrum, f0, 0.9);
    v.pluck(1.6); // attack + decay scheduled on the audio clock
    voice.current = v;
    setPlaying(true);
    window.setTimeout(() => {
      if (voice.current === v) {
        voice.current = null;
        setPlaying(false);
      }
    }, 2500);
  };

  // ---- geometry ----
  const L = W - 2 * PAD;
  const y0 = H / 2;
  const amp = 46;
  const visF = 0.5; // visual cycles per second for the fundamental
  const path = useMemo(() => {
    const pts: string[] = [];
    const modes = view === 0 ? amps.map((a, k) => ({ n: k + 1, a })) : [{ n: view, a: 1 }];
    // Normalize the pluck shape so its starting displacement is a triangle of height 1.
    const norm = view === 0 ? Math.max(...Array.from({ length: 101 }, (_, i) => Math.abs(modes.reduce((s, m) => s + m.a * Math.sin(m.n * Math.PI * (i / 100)), 0)))) : 1;
    for (let i = 0; i <= 200; i++) {
      const x = i / 200;
      let y = 0;
      for (const m of modes) y += m.a * Math.sin(m.n * Math.PI * x) * Math.cos(2 * Math.PI * visF * m.n * t * (view === 0 ? 1 : 1 / m.n));
      pts.push((i ? 'L' : 'M') + r2(PAD + x * L) + ' ' + r2(y0 - (y / norm) * amp));
    }
    return pts.join('');
  }, [amps, view, t, L]);

  const nodesX = view > 0 ? Array.from({ length: view + 1 }, (_, i) => PAD + (i / view) * L) : [];

  return (
    <Widget
      kicker="Lab"
      title="A vibrating string"
      caption={
        <>
          Motion is slowed down enormously, and the height exaggerated. Choose a single <strong>mode</strong> to see one
          standing wave: harmonic <em>n</em> fits <em>n</em> half-waves on the string, with still points (nodes)
          between them. <strong>Plucked</strong> shows them all at once, in the proportions set by where you pluck. The
          bars underneath show those proportions. Press <strong>Pluck</strong> to hear it at 110 Hz.
        </>
      }
    >
      <div className="w-controls">
        <button type="button" className="w-play" onClick={sound}>
          <span className="w-play-icon" aria-hidden>
            ▶
          </span>
          Pluck
        </button>
        <Segmented
          label="Show"
          value={view}
          options={[{ value: 0, label: 'Plucked' }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: `Mode ${n}` }))]}
          onChange={setView}
        />
        <button type="button" className="w-chip" onClick={() => setAnimate((a) => !a)}>
          {animate ? 'Pause motion' : 'Animate'}
        </button>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Vibrating string">
        <line x1={PAD} x2={W - PAD} y1={y0} y2={y0} className="stroke-grid" />
        <rect x={PAD - 8} y={y0 - 30} width={6} height={60} className="fill-ink" />
        <rect x={W - PAD + 2} y={y0 - 30} width={6} height={60} className="fill-ink" />
        <path d={path} className="string-line" />
        {nodesX.map((x, i) => (
          <circle key={i} cx={r2(x)} cy={y0} r={4} className="fill-rough" />
        ))}
        {view === 0 && (
          <g>
            <line x1={r2(PAD + p * L)} x2={r2(PAD + p * L)} y1={10} y2={H - 10} className="stroke-b dashed" />
            <text x={r2(PAD + p * L) + 5} y={18} className="w-tick key-b">
              pluck point
            </text>
          </g>
        )}
        {view > 0 && (
          <text x={W - PAD} y={16} textAnchor="end" className="w-tick">
            mode {view}: {view} half-wave{view > 1 ? 's' : ''} · {view} × 110 = {view * 110} Hz
          </text>
        )}
      </svg>

      {view === 0 && (
        <>
          <svg viewBox={`0 0 ${W} 90`} className="w-plot" role="img" aria-label="Harmonic strengths for this pluck">
            {amps.map((a, k) => {
              const bw = (W - 2 * PAD) / N_SHOW;
              return (
                <g key={k}>
                  <rect x={r2(PAD + k * bw + 6)} y={r2(10 + 56 * (1 - a))} width={r2(bw - 12)} height={r2(Math.max(0.5, 56 * a))} className="harm-bar" />
                  <text x={r2(PAD + k * bw + bw / 2)} y={84} textAnchor="middle" className="w-tick">
                    {k + 1}
                  </text>
                </g>
              );
            })}
          </svg>
          <Slider
            label="Pluck point"
            min={0.05}
            max={0.5}
            step={0.01}
            value={p}
            onChange={setP}
            display={p > 0.48 ? 'middle (½)' : `${Math.round(p * 100)}% of the length`}
          />
        </>
      )}
    </Widget>
  );
}

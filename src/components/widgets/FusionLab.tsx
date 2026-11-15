// Harmonic fusion: why twelve sine waves sound like one note, and what
// breaks the spell. A repeating complex tone (f0 = 200 Hz, 12 harmonics).
// Pick one harmonic and give it a reason to stand apart:
//   - mistune it (it no longer fits the harmonic series),
//   - start it early (onset asynchrony),
//   - wobble it on its own (vibrato on that harmonic only),
// or wobble every harmonic together (common fate, which binds them tighter).
// The spectrum shows exactly what is played.

import { useCallback, useEffect, useRef, useState } from 'react';
import { loop, startRun, type Run } from '../../lib/sequence';
import { PlayButton, Segmented, Slider, Widget, r2, scale, useAudioOwner } from './ui';

const F0 = 200;
const N = 12;
const NOTE = 0.9; // seconds the full tone sounds
const GAP = 0.45;
const amp = (n: number) => 1 / n;
const TOTAL = Array.from({ length: N }, (_, i) => amp(i + 1)).reduce((s, a) => s + a, 0);

type Wobble = 'none' | 'one' | 'all';

export default function FusionLab() {
  const [k, setK] = useState(4);
  const [mistune, setMistune] = useState(0); // percent
  const [early, setEarly] = useState(0); // ms
  const [wobble, setWobble] = useState<Wobble>('none');
  const [playing, setPlaying] = useState(false);
  const params = useRef({ k, mistune, early, wobble });
  params.current = { k, mistune, early, wobble };
  const run = useRef<Run | null>(null);
  const cancel = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    run.current?.stop(0.06);
    run.current = null;
    cancel.current?.();
    cancel.current = null;
    setPlaying(false);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => stop, [stop]);

  const play = () => {
    if (playing) return stop();
    const r = startRun(0.1);
    run.current = r;
    const { ctx } = r;
    cancel.current = loop(r, (t) => {
      const p = params.current;
      const lead = p.early / 1000;
      const start = t + lead; // the main tone starts after the early harmonic's lead
      const end = start + NOTE;
      // one shared LFO for vibrato: ±1.5% at 5.5 Hz
      let lfo: OscillatorNode | null = null;
      if (p.wobble !== 'none') {
        lfo = ctx.createOscillator();
        lfo.frequency.value = 5.5;
        lfo.start(t);
        lfo.stop(end + 0.2);
      }
      for (let n = 1; n <= N; n++) {
        const isK = n === p.k;
        const f = F0 * n * (isK ? 1 + p.mistune / 100 : 1);
        const on = isK ? t : start;
        const osc = ctx.createOscillator();
        osc.frequency.value = f;
        const g = ctx.createGain();
        const a = (amp(n) / TOTAL) * 0.55;
        g.gain.setValueAtTime(0, on);
        g.gain.linearRampToValueAtTime(a, on + 0.012);
        g.gain.setValueAtTime(a, end);
        g.gain.linearRampToValueAtTime(0, end + 0.06);
        if (lfo && (p.wobble === 'all' || isK)) {
          const depth = ctx.createGain();
          depth.gain.value = f * 0.015;
          lfo.connect(depth).connect(osc.frequency);
        }
        osc.connect(g).connect(r.bus);
        osc.start(on);
        osc.stop(end + 0.1);
        osc.onended = () => g.disconnect();
      }
      return lead + NOTE + GAP;
    });
    setPlaying(true);
  };

  // ---- drawing ----
  const W = 680;
  const H = 190;
  const SX = 440; // spectrum width
  const fx = scale(0, F0 * (N + 0.7), 30, SX - 10);
  const ay = scale(0, 1, H - 34, 16);
  const tx = scale(-0.3, NOTE + 0.1, SX + 30, W - 14);
  return (
    <Widget
      kicker="Lab"
      title="Twelve sine waves, one note"
      caption={
        <>
          Left: the spectrum being played, twelve harmonics of 200 Hz (the chosen one highlighted; a mistuned harmonic
          is drawn where it actually sits). Right: when each harmonic starts and stops. With nothing changed you hear{' '}
          <strong>one</strong> buzzy note at 200 Hz, not twelve tones. Each control gives the chosen harmonic a reason
          to stand apart.
        </>
      }
    >
      <div className="w-controls">
        <PlayButton playing={playing} onClick={play} />
        <Segmented
          label="Harmonic"
          value={k}
          options={[2, 3, 4, 5, 6, 8].map((n) => ({ value: n, label: String(n) }))}
          onChange={setK}
        />
        <Segmented
          label="Wobble"
          value={wobble}
          options={[
            { value: 'none', label: 'None' },
            { value: 'one', label: 'This harmonic' },
            { value: 'all', label: 'All together' },
          ]}
          onChange={setWobble}
        />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Spectrum of the tone and the timing of each harmonic">
        {Array.from({ length: N }, (_, i) => i + 1).map((n) => (
          <line key={'g' + n} x1={fx(F0 * n)} x2={fx(F0 * n)} y1={16} y2={H - 34} className="stroke-grid" />
        ))}
        {Array.from({ length: N }, (_, i) => i + 1).map((n) => {
          const isK = n === k;
          const f = F0 * n * (isK ? 1 + mistune / 100 : 1);
          return (
            <g key={n}>
              <line
                x1={fx(f)}
                x2={fx(f)}
                y1={H - 34}
                y2={ay(amp(n))}
                className={isK ? 'harm-line is-k' : 'harm-line'}
                strokeDasharray={isK && wobble !== 'none' ? '3 2' : undefined}
              />
              {isK && wobble !== 'none' && (
                <line x1={fx(f * 0.985)} x2={fx(f * 1.015)} y1={ay(amp(n)) - 5} y2={ay(amp(n)) - 5} className="harm-line is-k" />
              )}
              {(n <= 6 || n % 2 === 0) && (
                <text x={fx(F0 * n)} y={H - 20} textAnchor="middle" className="w-tick">
                  {n}
                </text>
              )}
            </g>
          );
        })}
        <text x={30} y={H - 4} className="w-tick">
          harmonic number (200 Hz × n) →
        </text>

        {/* timing */}
        {Array.from({ length: N }, (_, i) => i + 1).map((n) => {
          const isK = n === k;
          const yy = 16 + (n - 1) * ((H - 50) / (N - 1));
          const t0 = isK ? -early / 1000 : 0;
          return (
            <rect
              key={'t' + n}
              x={tx(t0)}
              y={r2(yy - 3)}
              width={r2(tx(NOTE) - tx(t0))}
              height={6}
              rx={2}
              className={isK ? 'harm-time is-k' : 'harm-time'}
            />
          );
        })}
        <line x1={tx(0)} x2={tx(0)} y1={10} y2={H - 28} className="stroke-grid" />
        <text x={tx(-0.3)} y={H - 4} className="w-tick">
          time → (−300 ms … note)
        </text>
      </svg>
      <div className="w-controls">
        <Slider label="Mistune" min={0} max={8} step={0.5} value={mistune} onChange={setMistune} display={`${mistune}%`} />
        <Slider label="Start early by" min={0} max={300} step={10} value={early} onChange={setEarly} display={`${early} ms`} />
      </div>
    </Widget>
  );
}

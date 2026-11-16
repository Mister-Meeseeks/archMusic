// Perception lab for chapter 1.3: four demonstrations that pitch, loudness,
// and timbre are made by the ear and brain, not read off the signal.
//
//   missing   a harmonic complex with its lowest harmonics removed: the pitch
//             stays at the (absent) fundamental; the waveform still repeats
//             at the fundamental's period.
//   shepard   Shepard tones: octave-spaced components under a fixed bell over
//             log frequency, so a scale seems to rise forever. "Plain" turns
//             the bell off and the trick fails at the octave wrap.
//   loudness  match a test tone's loudness to a 1 kHz reference, then compare
//             your settings with the ISO 226:2003 equal-loudness contours.
//   timbre    three dials that line up with the main dimensions found in
//             timbre-similarity studies: brightness, attack, spectral change.
//
// Every picture is drawn from the same numbers that drive the sound.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { boostVs1k } from '../../lib/loudness';
import { TUNES } from '../../lib/melodies';
import { harmonicWave, loop, startRun, type Run } from '../../lib/sequence';
import { PlayButton, Readout, Segmented, Slider, Widget, r2, scale, useAudioOwner } from './ui';

export type PerceptMode = 'missing' | 'shepard' | 'loudness' | 'timbre';
const MODE_LABEL: Record<PerceptMode, string> = {
  missing: 'Missing fundamental',
  shepard: 'Endless scale',
  loudness: 'Equal loudness',
  timbre: 'Timbre dials',
};
const TITLES: Record<PerceptMode, string> = {
  missing: 'A pitch with nothing at that frequency',
  shepard: 'A scale that rises forever',
  loudness: 'Match the loudness',
  timbre: 'Three dials of timbre',
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const W = 680;

// ---------- shared playback plumbing ----------
function usePlayer() {
  const [playing, setPlaying] = useState(false);
  const run = useRef<Run | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const timers = useRef<number[]>([]);
  const stop = useCallback(() => {
    run.current?.stop(0.06);
    run.current = null;
    cancel.current?.();
    cancel.current = null;
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    setPlaying(false);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => stop, [stop]);
  const start = (schedule: (r: Run, t: number, i: number) => number) => {
    const r = startRun(0.1);
    run.current = r;
    cancel.current = loop(r, (t, i) => schedule(r, t, i));
    setPlaying(true);
  };
  /** Run `fn` when the audio clock reaches t (for display only). */
  const at = (r: Run, t: number, fn: () => void) => {
    const id = window.setTimeout(fn, Math.max(0, (t - r.ctx.currentTime) * 1000));
    timers.current.push(id);
    if (timers.current.length > 64) timers.current.splice(0, 32);
  };
  return { playing, stop, start, at };
}

/** A sine partial with a short fade in and out. */
function partial(r: Run, f: number, a: number, t: number, dur: number, fade = 0.015) {
  const { ctx } = r;
  const osc = ctx.createOscillator();
  osc.frequency.value = f;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(a, t + fade);
  g.gain.setValueAtTime(a, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + fade * 3);
  osc.connect(g).connect(r.bus);
  osc.start(t);
  osc.stop(t + dur + fade * 3 + 0.05);
  osc.onended = () => g.disconnect();
}

// ---------- missing fundamental ----------
const MF_F0 = 200;
const MF_N = 12;
const mfAmp = (n: number) => 1 / Math.sqrt(n);
type MfSeq = 'note' | 'compare' | 'tune';

function complexTone(r: Run, f0: number, removed: number, t: number, dur: number, level = 0.4) {
  const present = Array.from({ length: MF_N }, (_, i) => i + 1).filter((n) => n > removed);
  const sum = present.reduce((s, n) => s + mfAmp(n), 0);
  for (const n of present) partial(r, f0 * n, (mfAmp(n) / sum) * level, t, dur);
}

function MissingFundamental() {
  const [removed, setRemoved] = useState(0);
  const [seq, setSeq] = useState<MfSeq>('note');
  const [now, setNow] = useState<string>('');
  const p = useRef({ removed, seq });
  p.current = { removed, seq };
  const { playing, stop, start, at } = usePlayer();
  const tune = TUNES.find((t) => t.id === 'twinkle')!;

  const play = () => {
    if (playing) return stop();
    start((r, t, i) => {
      const { removed: k, seq: s } = p.current;
      if (s === 'tune') {
        const [m, len] = tune.notes[i % tune.notes.length];
        const d = len * 0.24;
        complexTone(r, mtof(m - 5), k, t, d * 0.85);
        at(r, t, () => setNow(''));
        return d + (i % tune.notes.length === tune.notes.length - 1 ? 0.7 : 0);
      }
      if (s === 'compare') {
        const step = i % 3;
        if (step === 0) {
          complexTone(r, MF_F0, k, t, 0.8);
          at(r, t, () => setNow('the complex tone'));
        } else if (step === 1) {
          partial(r, MF_F0, 0.25, t, 0.6);
          at(r, t, () => setNow(`a pure tone at ${MF_F0} Hz`));
        } else {
          partial(r, MF_F0 * (k + 1), 0.25, t, 0.6);
          at(r, t, () => setNow(`a pure tone at ${MF_F0 * (k + 1)} Hz, the lowest harmonic actually present`));
        }
        return step === 2 ? 1.6 : 1.1;
      }
      complexTone(r, MF_F0, k, t, 0.8);
      at(r, t, () => setNow(''));
      return 1.2;
    });
  };
  useEffect(() => setNow(''), [seq]);

  // spectrum (left) and waveform (right)
  const H = 200;
  const SX = 330;
  const fx = scale(0, MF_F0 * (MF_N + 0.6), 28, SX - 8);
  const ay = scale(0, 1, H - 34, 22);
  const WX0 = SX + 30, WX1 = W - 14, WY = 98, WA = 58;
  const periods = 3;
  const present = Array.from({ length: MF_N }, (_, i) => i + 1).filter((n) => n > removed);
  const vals: number[] = [];
  for (let s = 0; s <= 300; s++) {
    const x = (s / 300) * periods; // in periods of f0
    vals.push(present.reduce((acc, n) => acc + mfAmp(n) * Math.sin(2 * Math.PI * n * x), 0));
  }
  const vmax = Math.max(...vals.map(Math.abs)) || 1;
  const wave = vals.map((v, s) => `${s ? 'L' : 'M'}${r2(WX0 + (s / 300) * (WX1 - WX0))},${r2(WY - (v / vmax) * WA)}`).join(' ');

  return (
    <>
      <div className="w-controls">
        <PlayButton playing={playing} onClick={play} />
        <Segmented
          label="Play"
          value={seq}
          options={[
            { value: 'note', label: 'One note' },
            { value: 'compare', label: 'Compare with pure tones' },
            { value: 'tune', label: 'A tune' },
          ]}
          onChange={setSeq}
        />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Spectrum with the lowest harmonics removed, and the resulting waveform">
        <line x1={fx(MF_F0)} x2={fx(MF_F0)} y1={14} y2={H - 34} className="stroke-b dashed" />
        <text x={fx(MF_F0) + 5} y={16} className="w-tick key-b">
          pitch you hear: {MF_F0} Hz
        </text>
        {Array.from({ length: MF_N }, (_, i) => i + 1).map((n) => (
          <g key={n}>
            <line
              x1={fx(MF_F0 * n)}
              x2={fx(MF_F0 * n)}
              y1={H - 34}
              y2={ay(mfAmp(n))}
              className={n > removed ? 'harm-line' : 'harm-line is-gone'}
            />
            {(n === 1 || n % 2 === 0) && (
              <text x={fx(MF_F0 * n)} y={H - 20} textAnchor="middle" className="w-tick">
                {MF_F0 * n >= 1000 ? `${(MF_F0 * n) / 1000}k` : MF_F0 * n}
              </text>
            )}
          </g>
        ))}
        <text x={28} y={H - 4} className="w-tick">
          frequency (Hz) of each harmonic →
        </text>

        {Array.from({ length: periods + 1 }, (_, k) => (
          <line key={k} x1={WX0 + (k / periods) * (WX1 - WX0)} x2={WX0 + (k / periods) * (WX1 - WX0)} y1={30} y2={WY + WA + 8} className="stroke-grid" />
        ))}
        <line x1={WX0} x2={WX1} y1={WY} y2={WY} className="stroke-grid" />
        <path d={wave} className="stroke-a" />
        <text x={WX0} y={16} className="w-tick">
          the sum: still repeats every {1000 / MF_F0} ms (= {MF_F0} times a second)
        </text>
        <text x={WX0} y={H - 4} className="w-tick">
          time → ({periods} repetitions)
        </text>
      </svg>
      <div className="w-controls">
        <Slider
          label="Remove the lowest"
          min={0}
          max={8}
          step={1}
          value={removed}
          onChange={setRemoved}
          display={removed === 0 ? 'none' : `${removed} harmonic${removed > 1 ? 's' : ''} (below ${MF_F0 * (removed + 1)} Hz)`}
        />
        {seq === 'compare' && <Readout label="Now playing">{playing && now ? now : '…'}</Readout>}
      </div>
    </>
  );
}

// ---------- Shepard tones ----------
const SH_BASE = mtof(24); // C1
const SH_CENTER = Math.log2(mtof(72)); // bell centered on C5
const SH_SIGMA = 1.15; // octaves
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const shBell = (f: number) => Math.exp(-0.5 * ((Math.log2(f) - SH_CENTER) / SH_SIGMA) ** 2);
function shComponents(pc: number, env: 'bell' | 'plain') {
  const out: { f: number; a: number }[] = [];
  if (env === 'bell') {
    for (let k = 0; k < 9; k++) {
      const f = SH_BASE * Math.pow(2, k + pc / 12);
      if (f < 20000) out.push({ f, a: shBell(f) });
    }
  } else {
    for (let k = 2; k <= 5; k++) out.push({ f: SH_BASE * Math.pow(2, k + pc / 12), a: 0.75 });
  }
  return out;
}

function Shepard() {
  const [dir, setDir] = useState<'up' | 'down'>('up');
  const [env, setEnv] = useState<'bell' | 'plain'>('bell');
  const [pc, setPc] = useState(0);
  const p = useRef({ dir, env, pc: 0 });
  p.current = { ...p.current, dir, env };
  const { playing, stop, start, at } = usePlayer();

  const play = () => {
    if (playing) return stop();
    start((r, t, i) => {
      const cur = p.current;
      const next = i === 0 ? cur.pc : (cur.pc + (cur.dir === 'up' ? 1 : 11)) % 12;
      cur.pc = next;
      const comps = shComponents(next, cur.env);
      const sum = comps.reduce((s, c) => s + c.a, 0);
      for (const c of comps) partial(r, c.f, (c.a / sum) * 0.38, t, 0.27, 0.02);
      at(r, t, () => setPc(next));
      return 0.34;
    });
  };

  const H = 200;
  const PX1 = 470;
  const lx = (f: number) => r2(24 + (Math.log2(f / 25) / Math.log2(16000 / 25)) * (PX1 - 34));
  const ay = scale(0, 1, H - 34, 24);
  const comps = shComponents(pc, env);
  const bell: string[] = [];
  for (let k = 0; k <= 80; k++) {
    const f = 25 * Math.pow(16000 / 25, k / 80);
    bell.push(`${k ? 'L' : 'M'}${lx(f)},${ay(shBell(f))}`);
  }
  const CX = 580, CY = 100, CR = 66;
  const pos = (k: number) => {
    const a = (k / 12) * 2 * Math.PI - Math.PI / 2;
    return { x: r2(CX + Math.cos(a) * CR), y: r2(CY + Math.sin(a) * CR) };
  };
  return (
    <>
      <div className="w-controls">
        <PlayButton playing={playing} onClick={play} />
        <Segmented
          label="Direction"
          value={dir}
          options={[
            { value: 'up', label: 'Up' },
            { value: 'down', label: 'Down' },
          ]}
          onChange={setDir}
        />
        <Segmented
          label="Loudness shape"
          value={env}
          options={[
            { value: 'bell', label: 'Shepard (fade the ends)' },
            { value: 'plain', label: 'Plain octaves' },
          ]}
          onChange={setEnv}
        />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Octave-spaced components under a bell-shaped loudness curve, and a circle of the twelve note names">
        {env === 'bell' && <path d={bell.join(' ')} className="stroke-grid" strokeDasharray="4 4" />}
        {[50, 100, 200, 500, 1000, 2000, 5000, 10000].map((f) => (
          <text key={f} x={lx(f)} y={H - 20} textAnchor="middle" className="w-tick">
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        ))}
        {comps.map((c, k) => (
          <line key={k} x1={lx(c.f)} x2={lx(c.f)} y1={H - 34} y2={ay(c.a)} className="harm-line" />
        ))}
        <text x={24} y={H - 4} className="w-tick">
          frequency (Hz, log scale): every component is the same note, an octave apart
        </text>
        <text x={24} y={16} className="w-tick">
          {env === 'bell' ? 'loudness follows a fixed bell: new components fade in at the bottom as old ones fade out at the top' : 'four octaves at equal loudness: nothing hides the wrap'}
        </text>

        <circle cx={CX} cy={CY} r={CR} className="stroke-grid" fill="none" />
        {NOTE_NAMES.map((n, k) => {
          const q = pos(k);
          const o = { x: r2(CX + (q.x - CX) * 1.22), y: r2(CY + (q.y - CY) * 1.22) };
          return (
            <text key={n} x={o.x} y={o.y + 4} textAnchor="middle" className={k === pc ? 'w-tick key-b' : 'w-tick'}>
              {n}
            </text>
          );
        })}
        <circle cx={pos(pc).x} cy={pos(pc).y} r={7} className="tone-b" />
        <text x={CX} y={CY + 4} textAnchor="middle" className="w-tick">
          {playing ? NOTE_NAMES[pc] : 'pitch class'}
        </text>
      </svg>
    </>
  );
}

// ---------- equal loudness ----------
const LD_FREQS = [63, 125, 250, 500, 2000, 4000, 8000];
// Reference levels (before the master bus). "Louder" is ~16 dB above "quiet".
const LD_REF = { quiet: 0.02, loud: 0.12 };
const LD_MAX = 1.0; // cap on any test tone's gain
// Only the bass gets a big boost range, so a careless slider can't blast the midrange.
const ldMaxBoost = (f: number) => (f <= 250 ? 40 : 20);

function Loudness() {
  const [f, setF] = useState(125);
  const [level, setLevel] = useState<'quiet' | 'loud'>('quiet');
  const [matches, setMatches] = useState<Record<string, number>>({});
  const [reveal, setReveal] = useState(false);
  const [now, setNow] = useState<'ref' | 'test' | ''>('');
  const key = `${level}:${f}`;
  const adj = matches[key] ?? 0;
  const p = useRef({ f, level, adj });
  p.current = { f, level, adj };
  const { playing, stop, start, at } = usePlayer();

  const play = () => {
    if (playing) return stop();
    start((r, t, i) => {
      const c = p.current;
      const ref = LD_REF[c.level];
      if (i % 2 === 0) {
        partial(r, 1000, ref, t, 0.6, 0.03);
        at(r, t, () => setNow('ref'));
        return 0.85;
      }
      partial(r, c.f, Math.min(LD_MAX, ref * Math.pow(10, c.adj / 20)), t, 0.6, 0.03);
      at(r, t, () => setNow('test'));
      return 1.2;
    });
  };
  const clipped = LD_REF[level] * Math.pow(10, adj / 20) > LD_MAX;

  const H = 210;
  const fx = (q: number) => r2(52 + (Math.log(q / 40) / Math.log(12000 / 40)) * (W - 70));
  const dy = scale(-15, 40, H - 30, 14);
  const curve = (phon: number) =>
    Array.from({ length: 60 }, (_, k) => 40 * Math.pow(12000 / 40, k / 59))
      .map((q, k) => `${k ? 'L' : 'M'}${fx(q)},${dy(Math.max(-15, Math.min(40, boostVs1k(q, phon))))}`)
      .join(' ');
  const mine = LD_FREQS.filter((q) => matches[`${level}:${q}`] !== undefined || q === f);
  const phon = level === 'quiet' ? 40 : 80;

  return (
    <>
      <div className="w-controls">
        <PlayButton playing={playing} onClick={play} />
        <Segmented
          label="Test tone"
          value={f}
          options={LD_FREQS.map((q) => ({ value: q, label: q >= 1000 ? `${q / 1000} kHz` : `${q} Hz` }))}
          onChange={setF}
        />
        <Segmented
          label="Overall level"
          value={level}
          options={[
            { value: 'quiet', label: 'Quiet' },
            { value: 'loud', label: 'Louder' },
          ]}
          onChange={setLevel}
        />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Your loudness matches plotted against the equal-loudness contours">
        {[-10, 0, 10, 20, 30, 40].map((d) => (
          <g key={d}>
            <line x1={52} x2={W - 18} y1={dy(d)} y2={dy(d)} className="stroke-grid" />
            <text x={46} y={dy(d) + 4} textAnchor="end" className="w-tick">
              {d > 0 ? `+${d}` : d}
            </text>
          </g>
        ))}
        {[63, 125, 250, 500, 1000, 2000, 4000, 8000].map((q) => (
          <text key={q} x={fx(q)} y={H - 12} textAnchor="middle" className="w-tick">
            {q >= 1000 ? `${q / 1000}k` : q}
          </text>
        ))}
        <circle cx={fx(1000)} cy={dy(0)} r={5} className="tone-b" />
        <text x={fx(1000) + 8} y={dy(0) - 7} className="w-tick key-b">
          reference
        </text>
        {reveal && (
          <>
            <path d={curve(phon)} className="stroke-ink" />
            <text x={fx(45)} y={dy(Math.min(38, boostVs1k(45, phon))) + 14} className="w-tick">
              ISO 226 at {phon} phons
            </text>
          </>
        )}
        {mine.map((q) => {
          const v = matches[`${level}:${q}`] ?? 0;
          return <circle key={q} cx={fx(q)} cy={dy(Math.max(-15, Math.min(40, v)))} r={q === f ? 6 : 4.5} className={q === f ? 'tone-a' : 'tone-a dim'} />;
        })}
        <text x={56} y={12} className="w-tick">
          dB of boost to sound as loud as the 1 kHz reference
        </text>
      </svg>
      <div className="w-controls">
        <Slider
          label={`Boost the ${f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`} tone`}
          min={-20}
          max={ldMaxBoost(f)}
          step={1}
          value={Math.min(adj, ldMaxBoost(f))}
          onChange={(v) => setMatches((m) => ({ ...m, [key]: v }))}
          display={`${adj > 0 ? '+' : ''}${adj} dB${clipped ? ' (at max output)' : ''}`}
        />
        <Readout label="Now playing">{playing ? (now === 'ref' ? '1 kHz reference' : now === 'test' ? 'test tone' : '…') : '…'}</Readout>
        <button type="button" className="w-chip" onClick={() => setReveal((v) => !v)}>
          {reveal ? 'Hide the standard' : 'Compare with the standard'}
        </button>
        {reveal && (
          <Readout label="ISO 226 predicts">
            {`${boostVs1k(f, phon) > 0 ? '+' : ''}${Math.round(boostVs1k(f, phon))} dB at ${phon} phons`}
          </Readout>
        )}
      </div>
    </>
  );
}

// ---------- timbre dials ----------
const TB_F = 220;
const TB_N = 30;
type TbParams = { tilt: number; attack: number; flux: number };
const TB_PRESETS: { id: string; label: string; p: TbParams }[] = [
  { id: 'soft', label: 'Soft, flute-like', p: { tilt: 2.2, attack: 90, flux: 0.05 } },
  { id: 'bowed', label: 'Bowed', p: { tilt: 1.3, attack: 160, flux: 0 } },
  { id: 'brassy', label: 'Bright, brassy', p: { tilt: 0.9, attack: 45, flux: 0.1 } },
  { id: 'pluck', label: 'Plucked', p: { tilt: 1.1, attack: 2, flux: 0.8 } },
  { id: 'mallet', label: 'Soft mallet', p: { tilt: 1.9, attack: 3, flux: 0.55 } },
];
const tbCutoffEnd = (flux: number) => Math.max(TB_F * 1.6, 12000 * Math.pow(2, -flux * 6.5));
const lp = (f: number, fc: number) => 1 / Math.sqrt(1 + Math.pow(f / fc, 4));
function centroid(tilt: number, fc: number) {
  let num = 0;
  let den = 0;
  for (let n = 1; n <= TB_N; n++) {
    const a = Math.pow(n, -tilt) * lp(TB_F * n, fc);
    num += a * TB_F * n;
    den += a;
  }
  return num / den;
}

function TimbreDials() {
  const [prm, setPrm] = useState<TbParams>(TB_PRESETS[1].p);
  const p = useRef(prm);
  p.current = prm;
  const { playing, stop, start } = usePlayer();

  const play = () => {
    if (playing) return stop();
    start((r, t) => {
      const { tilt, attack, flux } = p.current;
      const { ctx } = r;
      const dur = 1.0;
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(harmonicWave(ctx, TB_N, Math.round(tilt * 20) / 20));
      osc.frequency.value = TB_F;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.Q.value = 0.6;
      filt.frequency.setValueAtTime(12000, t);
      if (flux > 0) filt.frequency.setTargetAtTime(tbCutoffEnd(flux), t + attack / 1000, 0.18);
      const g = ctx.createGain();
      const peak = 0.3 * Math.min(1, 0.55 + tilt * 0.25); // darker spectra carry less energy up top
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + attack / 1000);
      g.gain.setTargetAtTime(peak * (flux > 0.4 ? 0.35 : 0.8), t + attack / 1000, 0.25 + (1 - flux) * 0.6);
      g.gain.setTargetAtTime(0, t + dur, 0.05);
      osc.connect(filt).connect(g).connect(r.bus);
      osc.start(t);
      osc.stop(t + dur + 0.4);
      osc.onended = () => g.disconnect();
      return dur + 0.45;
    });
  };

  const c0 = centroid(prm.tilt, 12000);
  const c1 = centroid(prm.tilt, prm.flux > 0 ? tbCutoffEnd(prm.flux) : 12000);
  const H = 190;
  const SX = 400;
  const fx = (f: number) => r2(28 + (Math.log2(f / 150) / Math.log2(8000 / 150)) * (SX - 40));
  const ay = scale(0, 1, H - 34, 20);
  const ends = prm.flux > 0 ? tbCutoffEnd(prm.flux) : 12000;
  // envelope sketch
  const EX0 = SX + 40, EX1 = W - 16, EY0 = H - 34, EY1 = 34;
  const tx = scale(0, 1.3, EX0, EX1);
  const ey = scale(0, 1, EY0, EY1);
  const env: string[] = [];
  const sus = prm.flux > 0.4 ? 0.35 : 0.8;
  const tau = 0.25 + (1 - prm.flux) * 0.6;
  for (let k = 0; k <= 130; k++) {
    const t = k / 100;
    const a = prm.attack / 1000;
    let v = t < a ? t / a : sus + (1 - sus) * Math.exp(-(t - a) / tau);
    if (t > 1) v *= Math.exp(-(t - 1) / 0.05);
    env.push(`${k ? 'L' : 'M'}${tx(t)},${ey(v)}`);
  }
  const setP = (q: Partial<TbParams>) => setPrm((o) => ({ ...o, ...q }));
  const atkSlider = Math.log10(prm.attack);
  return (
    <>
      <div className="w-controls">
        <PlayButton playing={playing} onClick={play} />
        <div className="w-seg">
          <span className="w-label">Start from</span>
          {TB_PRESETS.map((q) => (
            <button key={q.id} type="button" className="w-chip" onClick={() => setPrm(q.p)}>
              {q.label}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Spectrum at the start and end of the note, and the loudness envelope">
        {Array.from({ length: TB_N }, (_, i) => i + 1)
          .filter((n) => TB_F * n <= 8000)
          .map((n) => {
            const a0 = Math.pow(n, -prm.tilt);
            const a1 = a0 * lp(TB_F * n, ends);
            return (
              <g key={n}>
                <line x1={fx(TB_F * n)} x2={fx(TB_F * n)} y1={H - 34} y2={ay(a0)} className="harm-line is-gone" />
                <line x1={fx(TB_F * n)} x2={fx(TB_F * n)} y1={H - 34} y2={ay(a1)} className="harm-line" />
              </g>
            );
          })}
        <line x1={fx(c0)} x2={fx(c0)} y1={16} y2={H - 34} className="stroke-b dashed" />
        {Math.abs(c1 - c0) > 20 && <line x1={fx(c1)} x2={fx(c1)} y1={16} y2={H - 34} className="stroke-b" />}
        <text x={28} y={14} className="w-tick">
          harmonics of 220 Hz: dashed = start, solid = after 1 s; blue = brightness
        </text>
        {[250, 500, 1000, 2000, 4000, 8000].map((f) => (
          <text key={f} x={fx(f)} y={H - 20} textAnchor="middle" className="w-tick">
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        ))}
        <text x={28} y={H - 4} className="w-tick">
          frequency (Hz, log scale)
        </text>
        <line x1={EX0} x2={EX1} y1={EY0} y2={EY0} className="stroke-grid" />
        <path d={env.join(' ')} className="stroke-a" />
        <text x={EX0} y={14} className="w-tick">
          loudness over the note
        </text>
        <text x={EX0} y={H - 4} className="w-tick">
          time → (1.3 s)
        </text>
      </svg>
      <div className="w-controls">
        <Slider label="Brightness" min={0.7} max={2.6} step={0.05} value={r2(3.3 - prm.tilt)} onChange={(v) => setP({ tilt: r2(3.3 - v) })} display={`${Math.round(c0)} Hz`} />
        <Slider
          label="Attack"
          min={0.3}
          max={2.6}
          step={0.05}
          value={atkSlider}
          onChange={(v) => setP({ attack: Math.round(Math.pow(10, v)) })}
          display={`${prm.attack} ms`}
        />
        <Slider
          label="Darkens over the note"
          min={0}
          max={1}
          step={0.05}
          value={prm.flux}
          onChange={(v) => setP({ flux: v })}
          display={prm.flux === 0 ? 'no' : `${Math.round(c0)} → ${Math.round(c1)} Hz`}
        />
      </div>
    </>
  );
}

const CAPTIONS: Record<PerceptMode, ReactNode> = {
  missing: (
    <>
      Left: the twelve harmonics of a 200 Hz tone, with the lowest ones removed (dashed). Right: the waveform those
      remaining harmonics add up to. Remove the fundamental, and even the next several harmonics, and the pitch stays at
      200 Hz. Nothing is playing at 200 Hz, but the sum still repeats 200 times a second, and the remaining harmonics
      are all still spaced 200 Hz apart.
    </>
  ),
  shepard: (
    <>
      Each tone is one note sounded in every octave at once. Loudness follows a fixed bell over frequency, so as the
      whole stack climbs, the top components fade out while new ones fade in at the bottom. After twelve steps the
      sound is exactly where it started, yet every step sounded like a step up. Switch to <em>Plain octaves</em> to hear
      the trick fail.
    </>
  ),
  loudness: (
    <>
      The player alternates a 1 kHz reference with a test tone. Adjust the boost until the two sound equally loud, then
      try other frequencies: your dots trace your own equal-loudness curve. <strong>Not a measurement:</strong> your
      headphones or speakers are not flat (small speakers barely play 63 Hz at all) and the level is not calibrated, so
      expect your curve to differ from the standard. Keep the volume moderate.
    </>
  ),
  timbre: (
    <>
      One note (A3, 220 Hz) with three dials. These line up with the main dimensions listeners use when they judge how
      similar two timbres are: <strong>brightness</strong> (where the spectrum&apos;s balance point sits, shown in Hz),{' '}
      <strong>attack</strong> (how fast the note starts), and <strong>spectral change</strong> (whether the spectrum
      changes as the note sounds). The presets are rough sketches, not imitations.
    </>
  ),
};

export default function PerceptLab(props: { initialMode?: PerceptMode; modes?: PerceptMode[] }) {
  const modes = props.modes ?? (['missing', 'shepard', 'loudness', 'timbre'] as PerceptMode[]);
  const [mode, setMode] = useState<PerceptMode>(props.initialMode ?? modes[0]);
  return (
    <Widget kicker="Lab" title={TITLES[mode]} caption={CAPTIONS[mode]}>
      {modes.length > 1 && (
        <div className="w-controls">
          <Segmented label="Demo" value={mode} options={modes.map((m) => ({ value: m, label: MODE_LABEL[m] }))} onChange={setMode} />
        </div>
      )}
      {mode === 'missing' && <MissingFundamental />}
      {mode === 'shepard' && <Shepard />}
      {mode === 'loudness' && <Loudness />}
      {mode === 'timbre' && <TimbreDials />}
    </Widget>
  );
}

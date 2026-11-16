// WaveLab: the basic vocabulary of vibration (chapter 1.1), and reusable
// wherever a page needs a single sine, two sines added, or a picture of the air.
//
// Modes
//   one  One sine wave: frequency and amplitude, with its period and wavelength.
//   add  Two sine waves added: same frequency (interference and cancellation),
//        or 2x, 3x, 3:2 (a complex but still repeating waveform). Phase slider
//        and a polarity flip.
//   air  Inside a sound wave: air particles jiggling in a tube, the pressure
//        pattern along it, and the pressure over time at one point (the waveform).
//
// Sound: one OscillatorNode with a PeriodicWave built from exactly the
// components drawn, so the phase relationship you see is the one you hear.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAudio } from '../../lib/audio';
import { PlayButton, Readout, Segmented, Slider, Widget, r2, scale, useAudioOwner } from './ui';

type Mode = 'one' | 'add' | 'air';
type Ratio = '1' | '2' | '3' | '1.5';
type Comp = { n: number; a: number; ph: number }; // harmonic of the base frequency, amplitude, phase (radians)

const C = 343; // speed of sound, m/s
const LEVEL = 0.4; // output gain per unit amplitude (master adds its own 0.3)
const W = 640;
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

const MODE_LABEL: Record<Mode, string> = { one: 'One vibration', add: 'Two waves together', air: 'Inside the air' };

export function noteName(f: number) {
  const m = Math.round(69 + 12 * Math.log2(f / 440));
  return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

export function fmtLength(m: number) {
  if (m >= 10) return `${m.toFixed(0)} m`;
  if (m >= 1) return `${m.toFixed(1)} m`;
  return `${Math.round(m * 100)} cm`;
}

function fmtMs(s: number) {
  const ms = s * 1000;
  return ms >= 10 ? `${ms.toFixed(1)} ms` : `${ms.toFixed(2)} ms`;
}

// Log-scale slider helpers.
const toPos = (f: number, lo: number, hi: number) => Math.log(f / lo) / Math.log(hi / lo);
const fromPos = (p: number, lo: number, hi: number) => lo * Math.pow(hi / lo, p);

function useTone() {
  const node = useRef<{ osc: OscillatorNode; gain: GainNode } | null>(null);

  const wave = (ctx: AudioContext, comps: Comp[]) => {
    const N = Math.max(1, ...comps.map((c) => c.n)) + 1;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    // Web Audio: x(t) = sum real[k] cos(k w t) + imag[k] sin(k w t), so a sin(k w t + ph)
    // contributes a sin(ph) to real[k] and a cos(ph) to imag[k].
    for (const c of comps) {
      real[c.n] += c.a * Math.sin(c.ph);
      imag[c.n] += c.a * Math.cos(c.ph);
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
  };

  const start = (base: number, comps: Comp[]) => {
    const { ctx, out } = getAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = base;
    osc.setPeriodicWave(wave(ctx, comps));
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(LEVEL, ctx.currentTime, 0.015);
    osc.connect(gain).connect(out);
    osc.start();
    node.current = { osc, gain };
  };

  const update = (base: number, comps: Comp[]) => {
    const n = node.current;
    if (!n) return;
    const { ctx } = getAudio();
    n.osc.frequency.setTargetAtTime(base, ctx.currentTime, 0.02);
    n.osc.setPeriodicWave(wave(ctx, comps));
  };

  const stop = () => {
    const n = node.current;
    if (!n) return;
    node.current = null;
    const { ctx } = getAudio();
    n.gain.gain.cancelScheduledValues(ctx.currentTime);
    n.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
    n.osc.stop(ctx.currentTime + 0.12);
    setTimeout(() => n.gain.disconnect(), 200);
  };

  return { start, update, stop };
}

export default function WaveLab({
  initialMode = 'one',
  modes = ['one', 'add', 'air'],
  initialFreq = 220,
}: {
  initialMode?: Mode;
  modes?: Mode[];
  initialFreq?: number;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [playing, setPlaying] = useState(false);
  const tone = useTone();

  // mode "one" / "air"
  const [freq, setFreq] = useState(initialFreq);
  const [amp, setAmp] = useState(0.8);
  // mode "add"
  const [baseA, setBaseA] = useState(220);
  const [ratio, setRatio] = useState<Ratio>('1');
  const [phaseDeg, setPhaseDeg] = useState(0);
  const [ampB, setAmpB] = useState(1);
  const [flip, setFlip] = useState(false);

  const sound = useCallback((): { base: number; comps: Comp[] } => {
    if (mode === 'add') {
      const ph = (phaseDeg * Math.PI) / 180 + (flip ? Math.PI : 0);
      if (ratio === '1.5') return { base: baseA / 2, comps: [{ n: 2, a: 0.5, ph: 0 }, { n: 3, a: 0.5 * ampB, ph }] };
      return { base: baseA, comps: [{ n: 1, a: 0.5, ph: 0 }, { n: Number(ratio), a: 0.5 * ampB, ph }] };
    }
    return { base: freq, comps: [{ n: 1, a: mode === 'air' ? 0.6 : amp, ph: 0 }] };
  }, [mode, freq, amp, baseA, ratio, phaseDeg, ampB, flip]);

  const stop = useCallback(() => {
    tone.stop();
    setPlaying(false);
  }, []);
  useAudioOwner(playing, stop);

  const toggle = () => {
    if (playing) return stop();
    const s = sound();
    tone.start(s.base, s.comps);
    setPlaying(true);
  };

  useEffect(() => {
    if (!playing) return;
    const s = sound();
    tone.update(s.base, s.comps);
  }, [playing, sound]);

  return (
    <Widget
      kicker="Lab"
      title="Waves: frequency, amplitude, phase"
      caption={
        mode === 'one' ? (
          <>
            The graph shows 20 milliseconds of the wave: pressure above and below normal air pressure, over time. What you
            hear is generated from the same numbers. Laptop and phone speakers can't reproduce much below about 100 Hz, so
            use headphones for the bottom of the range.
          </>
        ) : mode === 'add' ? (
          <>
            Wave A (blue) and wave B (orange) are added point by point to make the sum (black), which is what you hear.
            The sound comes from exactly these components, with exactly this phase. The graph spans two full repeats of the
            combined waveform.
          </>
        ) : (
          <>
            A tube of air, four meters long, with a sound wave travelling from left to right, slowed down enormously. Each
            dot is a parcel of air; the orange ones show that air only jiggles in place while the pattern moves on. The
            middle strip graphs the pressure along the tube at this instant. The bottom strip records the pressure at the
            microphone over time: that trace is the waveform.
          </>
        )
      }
    >
      {modes.length > 1 && (
        <div className="w-controls">
          <Segmented<Mode> label="View" value={mode} options={modes.map((m) => ({ value: m, label: MODE_LABEL[m] }))} onChange={setMode} />
        </div>
      )}
      <div className="w-controls">
        <PlayButton playing={playing} onClick={toggle} />
        {mode === 'add' && (
          <Segmented<number>
            label="Wave A"
            value={baseA}
            options={[110, 220, 440].map((f) => ({ value: f, label: `${f} Hz` }))}
            onChange={setBaseA}
          />
        )}
      </div>
      {mode === 'one' && <OneView freq={freq} setFreq={setFreq} amp={amp} setAmp={setAmp} />}
      {mode === 'add' && (
        <AddView
          baseA={baseA}
          ratio={ratio}
          setRatio={setRatio}
          phaseDeg={phaseDeg}
          setPhaseDeg={setPhaseDeg}
          ampB={ampB}
          setAmpB={setAmpB}
          flip={flip}
          setFlip={setFlip}
        />
      )}
      {mode === 'air' && <AirView freq={freq} setFreq={setFreq} />}
    </Widget>
  );
}

// ---------- one sine ----------

function OneView(props: { freq: number; setFreq: (f: number) => void; amp: number; setAmp: (a: number) => void }) {
  const { freq, amp } = props;
  const LO = 30;
  const HI = 2000;
  const WIN = 0.02;
  const H = 196;
  const T = 1 / freq;

  const plot = useMemo(() => {
    const x = scale(0, WIN, 30, W - 10);
    const y = scale(-1, 1, H - 58, 26);
    const N = 1400;
    let d = '';
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * WIN;
      d += (i ? 'L' : 'M') + x(t) + ' ' + y(amp * Math.sin(2 * Math.PI * freq * t));
    }
    return { d, x, y };
  }, [freq, amp]);

  const { x, y } = plot;
  const showPeriod = T <= WIN;
  const wl = C / freq;

  return (
    <>
      <Slider
        label="Frequency"
        min={0}
        max={1}
        value={toPos(freq, LO, HI)}
        onChange={(p) => props.setFreq(Math.round(fromPos(p, LO, HI)))}
        display={`${freq} Hz`}
      />
      <Slider label="Amplitude" min={0} max={1} value={amp} onChange={props.setAmp} display={`${Math.round(amp * 100)}%`} />
      <div className="w-readouts">
        <Readout label="Cycles per second">{freq}</Readout>
        <Readout label="Period">{fmtMs(T)}</Readout>
        <Readout label="Wavelength in air">{fmtLength(wl)}</Readout>
        <Readout label="Nearest note">{noteName(freq)}</Readout>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Sine waveform over 20 milliseconds">
        {[0, 0.005, 0.01, 0.015, 0.02].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={10} y2={H - 24} className="stroke-grid" />
            <text x={x(t)} y={H - 14} textAnchor={t === 0 ? 'start' : t === WIN ? 'end' : 'middle'} className="w-tick">
              {t * 1000} ms
            </text>
          </g>
        ))}
        <line x1={x(0)} x2={x(WIN)} y1={y(0)} y2={y(0)} className="stroke-grid" />
        <text x={4} y={y(1) + 4} className="w-tick">+</text>
        <text x={4} y={y(-1) + 4} className="w-tick">−</text>
        <path d={plot.d} className="stroke-a" />
        {showPeriod && (
          <g>
            <line x1={x(0)} x2={x(T)} y1={H - 44} y2={H - 44} className="stroke-b wl-bracket" />
            <line x1={x(0)} x2={x(0)} y1={H - 50} y2={H - 38} className="stroke-b" />
            <line x1={x(T)} x2={x(T)} y1={H - 50} y2={H - 38} className="stroke-b" />
            {x(T) - x(0) > 70 ? (
              <text x={(x(0) + x(T)) / 2} y={H - 28} textAnchor="middle" className="w-tick">
                one period
              </text>
            ) : (
              <text x={x(T) + 6} y={H - 40} className="w-tick">
                one period
              </text>
            )}
          </g>
        )}
        {amp > 0.15 && T / 4 <= WIN && (
          <g>
            <line x1={x(T / 4)} x2={x(T / 4)} y1={y(0)} y2={y(amp)} className="stroke-ink dashed" />
            <text x={Math.max(x(T / 4), 60)} y={y(amp) - 7} textAnchor="middle" className="w-tick halo">
              amplitude
            </text>
          </g>
        )}
        {!showPeriod && (
          <text x={W - 12} y={24} textAnchor="end" className="w-tick">
            one period ({fmtMs(T)}) is longer than this window
          </text>
        )}
      </svg>
    </>
  );
}

// ---------- two waves added ----------

function AddView(props: {
  baseA: number;
  ratio: Ratio;
  setRatio: (r: Ratio) => void;
  phaseDeg: number;
  setPhaseDeg: (p: number) => void;
  ampB: number;
  setAmpB: (a: number) => void;
  flip: boolean;
  setFlip: (f: boolean) => void;
}) {
  const { baseA, ratio, phaseDeg, ampB, flip } = props;
  const H = 190;
  const rb = Number(ratio);
  const ph = (phaseDeg * Math.PI) / 180 + (flip ? Math.PI : 0);
  const repeat = ratio === '1.5' ? 2 / baseA : 1 / baseA; // common period of the sum
  const WIN = 2 * repeat;

  const plot = useMemo(() => {
    const x = scale(0, WIN, 10, W - 10);
    const y = scale(-2, 2, H - 24, 10);
    const N = 900;
    let a = '';
    let b = '';
    let s = '';
    let peak = 0;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * WIN;
      const va = Math.sin(2 * Math.PI * baseA * t);
      const vb = ampB * Math.sin(2 * Math.PI * baseA * rb * t + ph);
      const sum = va + vb;
      peak = Math.max(peak, Math.abs(sum));
      const X = x(t);
      a += (i ? 'L' : 'M') + X + ' ' + y(va);
      b += (i ? 'L' : 'M') + X + ' ' + y(vb);
      s += (i ? 'L' : 'M') + X + ' ' + y(sum);
    }
    return { a, b, s, peak, x, y };
  }, [baseA, rb, ph, ampB, WIN]);

  const fB = baseA * rb;
  let verdict: string;
  if (ratio === '1') {
    const p = plot.peak;
    if (p < 0.03) verdict = 'Silence. The two waves cancel completely: every peak of A meets an equal trough of B.';
    else if (p < 0.75) verdict = `Quieter than A alone (sum peaks at ${r2(p)}): the waves partly cancel.`;
    else if (p > 1.25) verdict = `Louder than A alone (sum peaks at ${r2(p)}): the waves reinforce.`;
    else verdict = `About as strong as A alone (sum peaks at ${r2(p)}).`;
  } else {
    verdict =
      'Two different frequencies make a new, more complex shape that still repeats. Changing the phase reshapes the picture much more than the sound.';
  }

  return (
    <>
      <div className="w-controls">
        <Segmented<Ratio>
          label="Wave B"
          value={ratio}
          options={[
            { value: '1', label: 'Same frequency' },
            { value: '2', label: '2×' },
            { value: '3', label: '3×' },
            { value: '1.5', label: '3:2' },
          ]}
          onChange={props.setRatio}
        />
        <button type="button" className={'w-chip' + (flip ? ' is-on' : '')} aria-pressed={flip} onClick={() => props.setFlip(!flip)}>
          Flip B's polarity
        </button>
      </div>
      <Slider
        label="B's phase"
        min={0}
        max={360}
        step={1}
        value={phaseDeg}
        onChange={props.setPhaseDeg}
        display={`${phaseDeg}°`}
      />
      <Slider label="B's amplitude" min={0} max={1} value={ampB} onChange={props.setAmpB} display={`${Math.round(ampB * 100)}%`} />
      <div className="w-readouts">
        <Readout label="Frequencies">
          A {baseA} Hz + B {r2(fB)} Hz
        </Readout>
        <Readout label="Sum repeats every">{fmtMs(repeat)}</Readout>
        <Readout label="You should hear">{verdict}</Readout>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Two sine waves and their sum">
        <line x1={10} x2={W - 10} y1={plot.y(0)} y2={plot.y(0)} className="stroke-grid" />
        <line x1={plot.x(repeat)} x2={plot.x(repeat)} y1={8} y2={H - 20} className="stroke-grid" />
        <path d={plot.a} className="stroke-a thin-wave" />
        <path d={plot.b} className="stroke-b thin-wave" />
        <path d={plot.s} className="stroke-ink wave-sum" />
        <text x={14} y={H - 6} className="w-tick">
          0
        </text>
        <text x={plot.x(repeat)} y={H - 6} textAnchor="middle" className="w-tick">
          one repeat
        </text>
        <text x={W - 12} y={H - 6} textAnchor="end" className="w-tick">
          {fmtMs(WIN)}
        </text>
      </svg>
    </>
  );
}

// ---------- inside the air ----------

const TUBE = 4; // meters shown
const COLS = 170;
const ROWS = 9;
const VIS_HZ = 0.6; // visual vibrations per second (the real wave is slowed to this)

function AirView(props: { freq: number; setFreq: (f: number) => void }) {
  const { freq } = props;
  const LO = 40;
  const HI = 1000;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [running, setRunning] = useState(true);
  const fRef = useRef(freq);
  fRef.current = freq;

  // Fixed jitter so the dots look like air, not a lattice.
  const jitter = useMemo(() => {
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
    return Array.from({ length: COLS * ROWS }, () => [rnd() * 0.35, rnd() * 0.35]);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setRunning(false);
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    let raf = 0;
    let t = 0;
    let last = performance.now();
    const trace: number[] = []; // pressure at the microphone, newest last
    const TRACE_LEN = 300;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (running) t += dt;
      draw(t, running);
      if (running) raf = requestAnimationFrame(frame);
    };

    const draw = (time: number, advance: boolean) => {
      const dpr = window.devicePixelRatio || 1;
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
        c.width = Math.round(cw * dpr);
        c.height = Math.round(ch * dpr);
      }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, cw, ch);
      const css = getComputedStyle(c);
      const colA = css.getPropertyValue('--tone-a').trim() || '#2f6db5';
      const colB = css.getPropertyValue('--tone-b').trim() || '#d0681c';
      const ink = css.getPropertyValue('--ink').trim() || '#222';
      const muted = css.getPropertyValue('--muted').trim() || '#888';
      const grid = css.getPropertyValue('--grid').trim() || '#ddd';
      const font = `11px ${css.getPropertyValue('--sans').trim() || 'sans-serif'}`;

      const f = fRef.current;
      const L = 12;
      const R = cw - 12;
      const span = R - L;
      const lamPx = (C / f / TUBE) * span;
      const k = (2 * Math.PI) / lamPx;
      const w = 2 * Math.PI * VIS_HZ;
      const A = Math.min(0.45 / k, 16); // visual displacement: compression ratio kA <= 0.45
      const phase = (xpx: number) => k * xpx - w * time;

      // --- tube of air ---
      const top = 50;
      const tubeH = 92;
      g.strokeStyle = grid;
      g.lineWidth = 1;
      g.strokeRect(L - 4, top - 6, span + 8, tubeH + 12);
      const dx = span / COLS;
      const dy = tubeH / (ROWS - 1);
      for (let r = 0; r < ROWS; r++) {
        for (let i = 0; i < COLS; i++) {
          const [jx, jy] = jitter[r * COLS + i];
          const x0 = L + (i + 0.5 + jx) * dx;
          const xx = x0 + A * Math.sin(phase(x0 - L));
          if (xx < L - 3 || xx > R + 3) continue;
          const marked = r === Math.floor(ROWS / 2) && i % 40 === 20;
          g.fillStyle = marked ? colB : ink;
          g.globalAlpha = marked ? 1 : 0.55;
          g.beginPath();
          g.arc(xx, top + r * dy + jy * dy * 0.8, marked ? 3.2 : 1.4, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.globalAlpha = 1;

      // ruler
      g.fillStyle = muted;
      g.font = font;
      g.textAlign = 'center';
      for (let m = 0; m <= TUBE; m += 0.5) {
        const X = L + (m / TUBE) * span;
        g.fillRect(X - 0.5, top + tubeH + 7, 1, m % 1 === 0 ? 6 : 3);
        if (m % 1 === 0) g.fillText(`${m} m`, Math.min(Math.max(X, L + 10), R - 10), top + tubeH + 24);
      }

      // wavelength bracket between two neighbouring compressions (pressure maxima: phase = pi mod 2pi)
      const mic = L + 0.78 * span;
      if (lamPx < span * 0.9) {
        const first = (((Math.PI + w * time) / k) % lamPx + lamPx) % lamPx;
        const x1 = L + first;
        const x2 = x1 + lamPx;
        if (x2 <= R) {
          g.strokeStyle = colB;
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(x1, 20);
          g.lineTo(x2, 20);
          g.moveTo(x1, 15);
          g.lineTo(x1, 25);
          g.moveTo(x2, 15);
          g.lineTo(x2, 25);
          g.stroke();
          if (lamPx > 80) {
            g.fillStyle = colB;
            g.textAlign = 'center';
            g.fillText('one wavelength', (x1 + x2) / 2, 11);
          }
        }
      }

      // --- pressure along the tube, now ---
      const pTop = top + tubeH + 40;
      const pH = 48;
      const pMid = pTop + pH / 2;
      g.strokeStyle = grid;
      g.beginPath();
      g.moveTo(L, pMid);
      g.lineTo(R, pMid);
      g.stroke();
      g.strokeStyle = colA;
      g.lineWidth = 1.6;
      g.beginPath();
      for (let X = L; X <= R; X += 2) {
        const p = -Math.cos(phase(X - L)); // compression (+) where dots bunch up
        const Y = pMid - p * (pH / 2 - 3);
        X === L ? g.moveTo(X, Y) : g.lineTo(X, Y);
      }
      g.stroke();
      g.fillStyle = muted;
      g.textAlign = 'left';
      g.fillText('pressure along the tube, at this instant (up = squeezed, down = stretched)', L, pTop - 4);

      // microphone marker
      g.strokeStyle = colB;
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(mic, top - 6);
      g.lineTo(mic, pTop + pH);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = colB;
      g.beginPath();
      g.arc(mic, top - 14, 4, 0, Math.PI * 2);
      g.fill();
      g.textAlign = 'left';
      g.fillText('microphone', mic + 8, top - 10);

      // --- pressure over time at the microphone ---
      const pm = -Math.cos(phase(mic - L));
      if (advance) {
        trace.push(pm);
        if (trace.length > TRACE_LEN) trace.shift();
      }
      const tTop = pTop + pH + 30;
      const tH = 48;
      const tMid = tTop + tH / 2;
      g.strokeStyle = grid;
      g.beginPath();
      g.moveTo(L, tMid);
      g.lineTo(R, tMid);
      g.stroke();
      g.strokeStyle = colB;
      g.lineWidth = 1.6;
      g.beginPath();
      trace.forEach((p, i) => {
        const X = R - (trace.length - 1 - i) * (span / TRACE_LEN);
        const Y = tMid - p * (tH / 2 - 3);
        i ? g.lineTo(X, Y) : g.moveTo(X, Y);
      });
      g.stroke();
      g.fillStyle = muted;
      g.textAlign = 'left';
      g.fillText('pressure at the microphone, over time (newest at the right): the waveform', L, tTop - 4);
    };

    raf = requestAnimationFrame(frame);
    const onResize = () => draw(t, false);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [running, jitter]);

  const wl = C / freq;
  const slow = freq / VIS_HZ;

  return (
    <>
      <Slider
        label="Frequency"
        min={0}
        max={1}
        value={toPos(freq, LO, HI)}
        onChange={(p) => props.setFreq(Math.round(fromPos(Math.min(1, Math.max(0, p)), LO, HI)))}
        display={`${freq} Hz`}
      />
      <div className="w-controls">
        <button type="button" className={'w-chip' + (running ? ' is-on' : '')} aria-pressed={running} onClick={() => setRunning(!running)}>
          {running ? 'Pause the motion' : 'Animate'}
        </button>
      </div>
      <div className="w-readouts">
        <Readout label="Wavelength">{fmtLength(wl)}</Readout>
        <Readout label="Wavelengths in the tube">{r2(TUBE / wl)}</Readout>
        <Readout label="Slowed down">about {Math.round(slow).toLocaleString('en-US')}×</Readout>
      </div>
      <canvas ref={canvas} className="w-canvas wave-air" aria-label="Animated air particles in a tube, with pressure graphs" />
    </>
  );
}

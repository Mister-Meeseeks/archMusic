// A playable synthesizer with a live oscilloscope and spectrum. Three
// methods (subtractive, FM, plucked-string physical model), presets that
// demonstrate each idea, an on-screen keyboard (or the computer keyboard),
// and a repeating pattern for tweaking knobs while it plays. The displays
// analyze the actual output, so they always show what you hear.

import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { loop, startRun, type Run } from '../../lib/sequence';
import { DEFAULT_SYNTH, SYNTH_PRESETS, estimateEnv, synthVoice, type Method, type SynthParams, type Voice, type Wave } from '../../lib/synth';
import { midiName, midiToHz } from '../../lib/tuning';
import { Segmented, Slider, Widget, r2, scale, useAudioOwner } from './ui';

const KEYS = 'awsedftgyhujk'; // C to C, white and black keys like a piano
const PATTERN = [0, 0, 12, 0, 3, 0, 10, 0, 0, 0, 12, 0, 7, 5, 3, -2];
const W = 680;
const H = 170;

const fmtHz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`);
const logSlider = (lo: number, hi: number) => ({
  to: (v: number) => Math.log(v / lo) / Math.log(hi / lo), // value → 0..1
  from: (x: number) => lo * Math.pow(hi / lo, x),
});
const CUT = logSlider(60, 12000);

export default function SynthLab(props: { preset?: string; presets?: string[]; methods?: Method[]; title?: string }) {
  const presetList = props.presets ? SYNTH_PRESETS.filter((p) => props.presets!.includes(p.id)) : SYNTH_PRESETS;
  const first = SYNTH_PRESETS.find((p) => p.id === props.preset) ?? presetList[0];
  const [p, setP] = useState<SynthParams>({ ...DEFAULT_SYNTH, ...first.p });
  const [presetId, setPresetId] = useState<string | null>(first.id);
  const [octave, setOctave] = useState(first.pattern ? 2 : 3);
  const [pattern, setPattern] = useState(false);
  const [active, setActive] = useState(false);
  const [down, setDown] = useState<Set<number>>(new Set());
  const params = useRef(p);
  params.current = p;
  const octRef = useRef(octave);
  octRef.current = octave;
  const run = useRef<Run | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const voices = useRef(new Map<number, Voice>());
  const cancelPattern = useRef<(() => void) | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const methods = props.methods ?? ['subtractive', 'fm', 'string'];

  const stop = useCallback(() => {
    cancelPattern.current?.();
    cancelPattern.current = null;
    voices.current.clear();
    run.current?.stop(0.08);
    run.current = null;
    analyser.current = null;
    cancelAnimationFrame(raf.current);
    setActive(false);
    setPattern(false);
    setDown(new Set());
  }, []);
  useAudioOwner(active, stop);

  const ensure = (): Run => {
    if (run.current && !run.current.stopped()) return run.current;
    const r = startRun(0.02);
    const an = r.ctx.createAnalyser();
    an.fftSize = 4096;
    an.smoothingTimeConstant = 0.6;
    r.bus.connect(an);
    run.current = r;
    analyser.current = an;
    setActive(true);
    raf.current = requestAnimationFrame(draw);
    return r;
  };

  const noteOn = (m: number) => {
    const r = ensure();
    voices.current.get(m)?.release(r.ctx.currentTime);
    voices.current.set(m, synthVoice(r.ctx, r.bus, params.current, midiToHz(m), r.ctx.currentTime + 0.005));
    setDown((d) => new Set(d).add(m));
  };
  const noteOff = (m: number) => {
    const r = run.current;
    const v = voices.current.get(m);
    if (r && v) v.release(r.ctx.currentTime);
    voices.current.delete(m);
    setDown((d) => {
      const n = new Set(d);
      n.delete(m);
      return n;
    });
  };

  const togglePattern = () => {
    if (pattern) {
      cancelPattern.current?.();
      cancelPattern.current = null;
      setPattern(false);
      return;
    }
    const r = ensure();
    const step = 60 / 120 / 4;
    let patVoices: Voice[] = [];
    cancelPattern.current = loop(r, (t, i) => {
      const m = 12 * (octRef.current + 1) + PATTERN[i % PATTERN.length];
      // Voice stealing: long releases would otherwise pile up and get loud.
      const live = patVoices.filter((v) => v.end > t);
      while (live.length >= 3) live.shift()!.release(t, 0.04);
      live.push(synthVoice(r.ctx, r.bus, params.current, midiToHz(m), t, step * 0.8));
      patVoices = live;
      return step;
    });
    setPattern(true);
  };

  // computer keyboard
  useEffect(() => {
    const held = new Set<string>();
    const kd = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const i = KEYS.indexOf(e.key.toLowerCase());
      if (i < 0 || !root.current?.matches(':hover, :focus-within')) return;
      held.add(e.key.toLowerCase());
      noteOn(12 * (octRef.current + 1) + i);
      e.preventDefault();
    };
    const ku = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const i = KEYS.indexOf(k);
      if (i < 0 || !held.has(k)) return;
      held.delete(k);
      noteOff(12 * (octRef.current + 1) + i);
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  });

  // ---- live display ----
  const draw = () => {
    const an = analyser.current;
    const c = canvas.current;
    if (!an || !c) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = c.clientWidth;
    const ch = c.clientHeight;
    if (c.width !== Math.round(cw * dpr)) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const css = getComputedStyle(c);
    const ink = css.getPropertyValue('--tone-a').trim() || '#2f6db5';
    const grid = css.getPropertyValue('--grid').trim() || '#ddd';
    const muted = css.getPropertyValue('--muted').trim() || '#888';
    const split = cw * 0.38;

    // scope: find a rising zero crossing so the picture holds still
    const td = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(td);
    let start = 0;
    for (let i = 1; i < td.length / 2; i++) {
      if (td[i - 1] < 0 && td[i] >= 0) {
        start = i;
        break;
      }
    }
    const span = 1200;
    g.strokeStyle = grid;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(6, ch / 2);
    g.lineTo(split - 10, ch / 2);
    g.stroke();
    g.strokeStyle = ink;
    g.lineWidth = 1.6;
    g.beginPath();
    for (let i = 0; i < span; i++) {
      const x = 6 + (i / span) * (split - 16);
      const y = ch / 2 - td[start + i] * (ch * 0.42) * 2.2;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();

    // spectrum: log frequency, dB
    const fd = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(fd);
    const sr = an.context.sampleRate;
    const fLo = 40;
    const fHi = 12000;
    const x0 = split + 10;
    const x1 = cw - 6;
    const fx = (f: number) => x0 + (Math.log(f / fLo) / Math.log(fHi / fLo)) * (x1 - x0);
    const dy = (db: number) => ch - 18 - ((Math.max(-110, Math.min(-10, db)) + 110) / 100) * (ch - 26);
    g.fillStyle = muted;
    g.font = '10px system-ui, sans-serif';
    g.strokeStyle = grid;
    g.lineWidth = 1;
    for (const f of [100, 1000, 10000]) {
      g.beginPath();
      g.moveTo(fx(f), 6);
      g.lineTo(fx(f), ch - 16);
      g.stroke();
      g.fillText(fmtHz(f), fx(f) + 3, ch - 5);
    }
    g.strokeStyle = ink;
    g.lineWidth = 1.4;
    g.beginPath();
    let started = false;
    for (let i = 1; i < fd.length; i++) {
      const f = (i * sr) / an.fftSize;
      if (f < fLo || f > fHi) continue;
      const x = fx(f);
      const y = dy(fd[i]);
      if (started) g.lineTo(x, y);
      else {
        g.moveTo(x, y);
        started = true;
      }
    }
    g.stroke();
    g.fillStyle = muted;
    g.fillText('waveform', 8, 12);
    g.fillText('spectrum (log frequency)', x0 + 2, 12);
    raf.current = requestAnimationFrame(draw);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const set = (patch: Partial<SynthParams>) => {
    setP((q) => ({ ...q, ...patch }));
    setPresetId(null);
  };
  const choose = (id: string) => {
    const pr = SYNTH_PRESETS.find((x) => x.id === id)!;
    setP({ ...DEFAULT_SYNTH, ...pr.p });
    setPresetId(id);
    if (pr.pattern) setOctave(2);
  };
  const preset = SYNTH_PRESETS.find((x) => x.id === presetId);
  const base = 12 * (octave + 1);

  return (
    <div ref={root}>
      <Widget
        kicker="Lab"
        title={props.title ?? 'A synthesizer'}
        caption={
          <>
            Play with the keys below (or your computer keyboard, A to K, while the pointer is over the lab). Left display:
            the waveform coming out. Right: its spectrum, the harmonics as peaks, on a log scale so each octave gets the
            same width. Both analyze the actual sound. {preset && <em>{preset.blurb}</em>}
          </>
        }
      >
        <div className="w-controls">
          <Segmented
            label="Preset"
            value={presetId ?? ''}
            options={presetList.filter((x) => methods.includes(x.p.method ?? 'subtractive')).map((x) => ({ value: x.id, label: x.label }))}
            onChange={choose}
          />
        </div>
        <canvas ref={canvas} className="w-canvas synth-canvas" style={{ height: H }} aria-label="Live waveform and spectrum" />
        <Keyboard base={base} down={down} onOn={noteOn} onOff={noteOff} />
        <div className="w-controls">
          <button type="button" className={'w-chip' + (pattern ? ' is-on' : '')} aria-pressed={pattern} onClick={togglePattern}>
            {pattern ? '■ Stop pattern' : '▶ Play a repeating pattern'}
          </button>
          <Segmented label="Octave" value={octave} options={[1, 2, 3, 4].map((o) => ({ value: o, label: String(o) }))} onChange={setOctave} />
          {active && (
            <button type="button" className="w-chip" onClick={stop}>
              Silence
            </button>
          )}
        </div>

        {methods.length > 1 && (
          <div className="w-controls">
            <Segmented
              label="Method"
              value={p.method}
              options={methods.map((m) => ({ value: m, label: m === 'subtractive' ? 'Subtractive' : m === 'fm' ? 'FM' : 'Plucked string' }))}
              onChange={(m) => set({ method: m })}
            />
          </div>
        )}

        {p.method === 'subtractive' && (
          <>
            <div className="w-controls">
              <Segmented
                label="Oscillator"
                value={p.wave}
                options={(['sine', 'triangle', 'square', 'sawtooth'] as Wave[]).map((w) => ({ value: w, label: w === 'sawtooth' ? 'saw' : w }))}
                onChange={(w) => set({ wave: w })}
              />
            </div>
            <div className="synth-knobs">
              <Slider label="Cutoff" min={0} max={1} step={0.001} value={CUT.to(p.cutoff)} onChange={(x) => set({ cutoff: CUT.from(x) })} display={fmtHz(p.cutoff)} />
              <Slider label="Resonance" min={0.5} max={20} step={0.1} value={p.resonance} onChange={(v) => set({ resonance: v })} display={p.resonance.toFixed(1)} />
              <Slider label="Filter env" min={0} max={6} step={0.1} value={p.envAmount} onChange={(v) => set({ envAmount: v })} display={`${p.envAmount.toFixed(1)} oct`} />
              <Slider label="Filter decay" min={0.02} max={2} step={0.01} value={p.filterDecay} onChange={(v) => set({ filterDecay: v })} display={`${p.filterDecay.toFixed(2)} s`} />
              <Slider label="Detune" min={0} max={30} step={1} value={p.detune} onChange={(v) => set({ detune: v })} display={p.detune ? `±${p.detune} cents` : 'one osc'} />
            </div>
          </>
        )}
        {p.method === 'fm' && (
          <div className="synth-knobs">
            <Slider label="Ratio" min={0.5} max={8} step={0.25} value={p.ratio} onChange={(v) => set({ ratio: v })} display={`${p.ratio} : 1`} />
            <Slider label="Index" min={0} max={10} step={0.1} value={p.index} onChange={(v) => set({ index: v })} display={p.index.toFixed(1)} />
            <Slider label="Index decay" min={0.02} max={4} step={0.01} value={p.indexDecay} onChange={(v) => set({ indexDecay: v })} display={`${p.indexDecay.toFixed(2)} s`} />
          </div>
        )}
        {p.method === 'string' && (
          <div className="synth-knobs">
            <Slider label="Brightness" min={0} max={1} step={0.01} value={p.brightness} onChange={(v) => set({ brightness: v })} display={p.brightness.toFixed(2)} />
            <Slider label="Damping" min={0} max={1} step={0.01} value={p.damping} onChange={(v) => set({ damping: v })} display={p.damping.toFixed(2)} />
          </div>
        )}
        {p.method !== 'string' && (
          <>
            <Envelope p={p} />
            <div className="synth-knobs">
              <Slider label="Attack" min={0.001} max={2} step={0.001} value={p.attack} onChange={(v) => set({ attack: v })} display={`${p.attack < 0.1 ? Math.round(p.attack * 1000) + ' ms' : p.attack.toFixed(2) + ' s'}`} />
              <Slider label="Decay" min={0.02} max={4} step={0.01} value={p.decay} onChange={(v) => set({ decay: v })} display={`${p.decay.toFixed(2)} s`} />
              <Slider label="Sustain" min={0} max={1} step={0.01} value={p.sustain} onChange={(v) => set({ sustain: v })} display={`${Math.round(p.sustain * 100)}%`} />
              <Slider label="Release" min={0.02} max={4} step={0.01} value={p.release} onChange={(v) => set({ release: v })} display={`${p.release.toFixed(2)} s`} />
            </div>
          </>
        )}
      </Widget>
    </div>
  );
}

function Keyboard({ base, down, onOn, onOff }: { base: number; down: Set<number>; onOn: (m: number) => void; onOff: (m: number) => void }) {
  const whites = [0, 2, 4, 5, 7, 9, 11, 12];
  const blacks = [1, 3, 6, 8, 10];
  const ww = 100 / whites.length;
  const pos: Record<number, number> = { 1: 1, 3: 2, 6: 4, 8: 5, 10: 6 };
  const handlers = (m: number) => ({
    onPointerDown: (e: RPointerEvent) => {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      onOn(m);
    },
    onPointerUp: () => onOff(m),
    onPointerCancel: () => onOff(m),
    onLostPointerCapture: () => down.has(m) && onOff(m),
  });
  return (
    <div className="synth-keys" role="group" aria-label="Keyboard">
      {whites.map((s, i) => (
        <button
          key={s}
          type="button"
          className={'synth-white' + (down.has(base + s) ? ' is-down' : '')}
          style={{ left: `${i * ww}%`, width: `${ww}%` }}
          aria-label={midiName(base + s)}
          {...handlers(base + s)}
        >
          <span>{midiName(base + s)}</span>
        </button>
      ))}
      {blacks.map((s) => (
        <button
          key={s}
          type="button"
          className={'synth-black' + (down.has(base + s) ? ' is-down' : '')}
          style={{ left: `${pos[s] * ww - ww * 0.3}%`, width: `${ww * 0.6}%` }}
          aria-label={midiName(base + s)}
          {...handlers(base + s)}
        />
      ))}
    </div>
  );
}

function Envelope({ p }: { p: SynthParams }) {
  const EW = 680;
  const EH = 70;
  const hold = 0.6; // seconds the key is held, for the drawing
  const keyUp = Math.max(p.attack, 0) + hold;
  const total = keyUp + p.release * 1.6;
  const x = scale(0, Math.max(total, 1), 10, EW - 10);
  const y = scale(0, 1, EH - 14, 8);
  const pts: string[] = [];
  const N = 120;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * keyUp;
    pts.push(`${x(t)},${y(estimateEnv(p, t))}`);
  }
  const vUp = estimateEnv(p, keyUp);
  for (let i = 1; i <= 40; i++) {
    const t = (i / 40) * p.release * 1.6;
    pts.push(`${x(keyUp + t)},${y(vUp * Math.exp(-t / Math.max(0.005, p.release / 4)))}`);
  }
  return (
    <svg viewBox={`0 0 ${EW} ${EH}`} className="w-plot" role="img" aria-label="Amplitude envelope">
      <polyline points={pts.join(' ')} className="env-line" />
      <line x1={x(keyUp)} x2={x(keyUp)} y1={6} y2={EH - 14} className="stroke-grid" strokeDasharray="3 3" />
      <text x={x(0)} y={EH - 2} className="w-tick">
        key down
      </text>
      <text x={r2(x(keyUp) + 4)} y={EH - 2} className="w-tick">
        key up
      </text>
      <text x={EW - 10} y={12} textAnchor="end" className="w-tick">
        amplitude envelope (A, D, S, R)
      </text>
    </svg>
  );
}

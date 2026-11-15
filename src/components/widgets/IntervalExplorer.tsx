// Two tones at any interval. Shows (1) the roughness curve across all
// intervals for the chosen timbre and register, and (2) the partials of both
// tones, with rough pairs and coinciding pairs highlighted.
// This is the core "see the mechanism" widget for consonance; reused in
// Vol III (tuning) and Vol IV (timbre).

import { useCallback, useMemo, useRef, useState } from 'react';
import { AdditiveVoice } from '../../lib/audio';
import {
  type Partial,
  dissonanceCurve,
  harmonic,
  intervalRoughness,
  pairRoughness,
  sine,
  stretched,
} from '../../lib/dissonance';
import { INTERVALS, midiName, midiToHz, nearestInterval, ratioToCents } from '../../lib/tuning';
import { PlayButton, Readout, Segmented, Slider, Widget, r2, scale, useAudioOwner } from './ui';

type Timbre = 'sine' | 'harmonic' | 'stretched';
const W = 680;

function spectrumFor(t: Timbre, n: number, stretch: number): Partial[] {
  if (t === 'sine') return sine;
  if (t === 'harmonic') return harmonic(n);
  return stretched(n, stretch);
}

export default function IntervalExplorer(props: {
  initialTimbre?: Timbre;
  initialCents?: number;
  initialMidi?: number;
  /** Which timbre options to offer (default: all). */
  timbres?: Timbre[];
  /** Show the base-pitch slider (default true). */
  showRegister?: boolean;
}) {
  const [timbre, setTimbre] = useState<Timbre>(props.initialTimbre ?? 'harmonic');
  const [cents, setCents] = useState(props.initialCents ?? 700);
  const [midi, setMidi] = useState(props.initialMidi ?? 60);
  const [nPartials, setNPartials] = useState(8);
  const [stretch, setStretch] = useState(2.1);
  const [playing, setPlaying] = useState(false);
  const voices = useRef<AdditiveVoice[] | null>(null);

  const f0 = midiToHz(midi);
  const ratio = 2 ** (cents / 1200);
  const spectrum = useMemo(() => spectrumFor(timbre, nPartials, stretch), [timbre, nPartials, stretch]);
  const maxCents = timbre === 'stretched' ? Math.max(1250, ratioToCents(stretch) + 100) : 1250;

  // ---- audio ----
  const stop = useCallback(() => {
    voices.current?.forEach((v) => v.stop());
    voices.current = null;
    setPlaying(false);
  }, []);
  useAudioOwner(playing, stop);

  const toggle = () => {
    if (playing) return stop();
    voices.current = [new AdditiveVoice(spectrum, f0, 0.6), new AdditiveVoice(spectrum, f0 * ratio, 0.6)];
    voices.current.forEach((v) => v.start());
    setPlaying(true);
  };

  const apply = (next: { cents?: number; midi?: number; spectrum?: Partial[] }) => {
    const c = next.cents ?? cents;
    const m = next.midi ?? midi;
    const sp = next.spectrum ?? spectrum;
    if (!voices.current) return;
    const [a, b] = voices.current;
    if (next.spectrum) {
      a.setSpectrum(sp);
      b.setSpectrum(sp);
    }
    a.setF0(midiToHz(m));
    b.setF0(midiToHz(m) * 2 ** (c / 1200));
  };

  const changeCents = (c: number) => {
    setCents(c);
    apply({ cents: c });
  };
  const changeMidi = (m: number) => {
    setMidi(m);
    apply({ midi: m });
  };
  const changeTimbre = (t: Timbre) => {
    setTimbre(t);
    const sp = spectrumFor(t, nPartials, stretch);
    const c = t !== 'stretched' && cents > 1250 ? 1200 : cents;
    setCents(c);
    apply({ spectrum: sp, cents: c });
  };
  const changeN = (n: number) => {
    setNPartials(n);
    apply({ spectrum: spectrumFor(timbre, n, stretch) });
  };
  const changeStretch = (s: number) => {
    setStretch(s);
    apply({ spectrum: spectrumFor(timbre, nPartials, s) });
  };

  // ---- curve ----
  const curve = useMemo(() => dissonanceCurve(spectrum, f0, maxCents, 600), [spectrum, f0, maxCents]);
  const curveMax = useMemo(() => Math.max(...curve.map((p) => p.d)) || 1, [curve]);
  const cx = scale(0, maxCents, 8, W - 8);
  const cy = scale(0, curveMax, 150, 16);
  const curvePath = curve.map((p, i) => (i ? 'L' : 'M') + cx(p.cents).toFixed(1) + ' ' + cy(p.d).toFixed(1)).join('');
  const current = intervalRoughness(spectrum, f0, ratio);

  const svgRef = useRef<SVGSVGElement>(null);
  const pickFromCurve = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.type === 'pointermove' && e.buttons !== 1) return;
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    changeCents(Math.max(0, Math.min(maxCents, ((px - 8) / (W - 16)) * maxCents)));
  };

  // ---- partials ----
  const parts = useMemo(() => {
    const a = spectrum.map((p) => ({ f: p.f * f0, a: p.a }));
    const b = spectrum.map((p) => ({ f: p.f * f0 * ratio, a: p.a }));
    const all = [...a, ...b];
    const lo = Math.min(...all.map((p) => p.f)) / 1.15;
    const hi = Math.max(...all.map((p) => p.f)) * 1.1;
    // Strongest possible pair roughness here, for normalizing line opacity.
    const ref = pairRoughness(f0, 1, f0 * 1.06, 1);
    const pairs: { pa: number; pb: number; kind: 'rough' | 'match'; w: number }[] = [];
    a.forEach((p, i) =>
      b.forEach((q, j) => {
        const c = Math.abs(ratioToCents(q.f / p.f));
        if (c < 4) pairs.push({ pa: i, pb: j, kind: 'match', w: 1 });
        else {
          const r = pairRoughness(p.f, p.a, q.f, q.a) / ref;
          if (r > 0.04) pairs.push({ pa: i, pb: j, kind: 'rough', w: Math.min(1, r * 1.6) });
        }
      }),
    );
    return { a, b, lo, hi, pairs };
  }, [spectrum, f0, ratio]);
  const px = (f: number) => r2(8 + (Math.log(f / parts.lo) / Math.log(parts.hi / parts.lo)) * (W - 16));
  const ROW_A = 40;
  const ROW_B = 118;

  const near = nearestInterval(cents);
  const timbres = props.timbres ?? ['sine', 'harmonic', 'stretched'];

  return (
    <Widget
      kicker="Lab"
      title="Interval explorer"
      caption={
        <>
          Top: modeled roughness for every interval from unison to {maxCents > 1250 ? 'past' : 'just above'} an octave,
          for this timbre and register. Click or drag on it to set the interval. Bottom: the partials of the lower tone
          (top row) and upper tone (bottom row) on a log-frequency axis. <span className="key-rough">Red links</span>{' '}
          are pairs close enough to clash (more opaque means rougher). <span className="key-match">Green links</span>{' '}
          are partials that coincide exactly.
        </>
      }
    >
      <div className="w-controls">
        <PlayButton playing={playing} onClick={toggle} />
        {timbres.length > 1 && (
          <Segmented
            label="Timbre"
            value={timbre}
            options={timbres.map((t) => ({
              value: t,
              label: t === 'sine' ? 'Pure (sine)' : t === 'harmonic' ? 'Harmonic' : 'Stretched',
            }))}
            onChange={changeTimbre}
          />
        )}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} 178`}
        className="w-plot is-clickable"
        role="img"
        aria-label="Roughness by interval"
        onPointerDown={pickFromCurve}
        onPointerMove={pickFromCurve}
      >
        {INTERVALS.map((iv) => {
          const c = ratioToCents(iv.just[0] / iv.just[1]);
          return (
            <g key={iv.short}>
              <line x1={cx(c)} x2={cx(c)} y1={14} y2={152} className="stroke-grid" />
              <text x={cx(c)} y={170} textAnchor="middle" className="w-tick">
                {iv.short}
              </text>
            </g>
          );
        })}
        {timbre === 'stretched' && (
          <g>
            <line x1={cx(ratioToCents(stretch))} x2={cx(ratioToCents(stretch))} y1={14} y2={152} className="stroke-match dashed" />
            <text
              x={cx(ratioToCents(stretch)) - 6}
              y={12}
              textAnchor={cx(ratioToCents(stretch)) > W * 0.75 ? 'end' : 'middle'}
              className="w-tick key-match"
            >
              stretched “octave”
            </text>
          </g>
        )}
        <path d={curvePath} className="stroke-rough" />
        <line x1={cx(cents)} x2={cx(cents)} y1={10} y2={152} className="stroke-ink" />
        <circle cx={cx(cents)} cy={cy(current)} r={5.5} className="fill-ink" />
      </svg>

      <Slider
        label="Interval"
        min={0}
        max={maxCents}
        step={1}
        value={cents}
        onChange={changeCents}
        display={`${cents.toFixed(0)}¢`}
      />
      <div className="w-chips">
        {INTERVALS.map((iv) => (
          <button type="button" key={iv.short} className="w-chip" onClick={() => changeCents(iv.semis * 100)} title={`${iv.name} (equal-tempered)`}>
            {iv.short}
          </button>
        ))}
      </div>

      <div className="w-readouts">
        <Readout label="Nearest">
          {near.iv.name}{' '}
          {Math.abs(near.offset) >= 1 && (
            <span className="muted">
              ({near.offset > 0 ? '+' : ''}
              {near.offset.toFixed(0)}¢)
            </span>
          )}
        </Readout>
        <Readout label="Ratio">
          {ratio.toFixed(4)} <span className="muted">(just {near.iv.just.join(':')})</span>
        </Readout>
        <Readout label="Roughness">{((current / curveMax) * 100).toFixed(0)} / 100</Readout>
      </div>

      <svg viewBox={`0 0 ${W} 150`} className="w-plot" role="img" aria-label="Partials of both tones">
        {parts.pairs.map((p, i) => (
          <line
            key={i}
            x1={px(parts.a[p.pa].f)}
            y1={ROW_A + 4}
            x2={px(parts.b[p.pb].f)}
            y2={ROW_B - 4}
            className={p.kind === 'match' ? 'stroke-match' : 'stroke-rough'}
            style={{ opacity: p.kind === 'match' ? 0.9 : r2(0.15 + 0.85 * p.w) }}
          />
        ))}
        {parts.a.map((p, i) => (
          <line key={'a' + i} x1={px(p.f)} x2={px(p.f)} y1={ROW_A} y2={r2(ROW_A - 6 - 26 * p.a)} className="stroke-a thick" />
        ))}
        {parts.b.map((p, i) => (
          <line key={'b' + i} x1={px(p.f)} x2={px(p.f)} y1={ROW_B} y2={r2(ROW_B + 6 + 26 * p.a)} className="stroke-b thick" />
        ))}
        <text x={W - 8} y={14} textAnchor="end" className="w-tick key-a">
          lower tone · {midiName(midi)} {f0.toFixed(0)} Hz
        </text>
        <text x={W - 8} y={146} textAnchor="end" className="w-tick key-b">
          upper tone · {(f0 * ratio).toFixed(0)} Hz
        </text>
      </svg>

      <div className="w-controls">
        {props.showRegister !== false && (
          <Slider
            label="Register"
            min={36}
            max={76}
            step={1}
            value={midi}
            onChange={changeMidi}
            display={`${midiName(midi)} · ${f0.toFixed(0)} Hz`}
          />
        )}
        {timbre !== 'sine' && (
          <Slider label="Partials" min={2} max={16} step={1} value={nPartials} onChange={changeN} display={nPartials} />
        )}
        {timbre === 'stretched' && (
          <Slider
            label="Stretch"
            min={1.8}
            max={2.3}
            step={0.01}
            value={stretch}
            onChange={changeStretch}
            display={`2nd partial at ×${stretch.toFixed(2)}`}
          />
        )}
      </div>
    </Widget>
  );
}

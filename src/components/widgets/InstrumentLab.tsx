// InstrumentLab (chapter 4.1): the resonators inside acoustic instruments.
//
// Pick a resonator (string, open or closed pipe, drumhead, timpani, tabla,
// bar, marimba bar, bell). The picture shows one mode of vibration (or, for
// the one-dimensional resonators, all of them together); the spectrum shows
// every mode's frequency against a grid of harmonics, so you can see at a
// glance whether the instrument is harmonic. Play sounds the modes with the
// amplitudes the chosen exciter gives them (pluck, bow, breath, strike).
//
// The model lives in src/lib/instruments.ts. Sound is additive: one sine per
// mode at its own frequency and decay. Bowed and blown tones are sustained,
// and they're exactly harmonic: the exciter locks the modes together, which is
// why the bowed stiff string sounds at whole-number ratios even though its
// free modes don't.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BAR_NODES, BESSEL_ZEROS, RESONATORS, amplitudes, harmonicity, resonator, shape1d, type Excite, type Mode, type ResonatorId } from '../../lib/instruments';
import { noiseSource, startRun, type Run } from '../../lib/sequence';
import { Readout, Segmented, Slider, Widget, r2, useAudioOwner } from './ui';

const W = 640;
const H = 190;
const PAD = 34;
const SPEC_H = 144;
const LEVEL = 0.5;

const EXCITE_LABEL: Record<Excite, string> = { pluck: 'Pluck', bow: 'Bow', blow: 'Blow', strike: 'Strike' };

function fmtRatio(r: number) {
  return Math.abs(r - Math.round(r)) < 0.005 ? `${Math.round(r)}` : r.toFixed(2);
}

export default function InstrumentLab({
  resonators = RESONATORS.map((r) => r.id),
  initial,
  title = 'Inside the instrument',
}: {
  resonators?: ResonatorId[];
  initial?: ResonatorId;
  title?: string;
}) {
  const [id, setId] = useState<ResonatorId>(initial ?? resonators[0]);
  const res = resonator(id);
  const [excite, setExcite] = useState<Excite>(res.excitations[0]);
  const [pos, setPos] = useState(res.position?.[2] ?? 0.5);
  const [stiff, setStiff] = useState(0);
  const [view, setView] = useState<number>(res.shape === '1d' ? -1 : res.id === 'timpani' ? 1 : 0); // -1 = all modes together
  const [t, setT] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [playing, setPlaying] = useState<null | 'all' | number>(null);
  const run = useRef<Run | null>(null);
  const timer = useRef<number | null>(null);

  // switching resonator resets its controls
  const choose = (next: ResonatorId) => {
    const r = resonator(next);
    setId(next);
    setExcite(r.excitations[0]);
    setPos(r.position?.[2] ?? 0.5);
    setView(r.shape === '1d' ? -1 : r.id === 'timpani' ? 1 : 0);
  };

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setAnimate(false);
  }, []);
  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    const t0 = performance.now() - t * 1000;
    const frame = (now: number) => {
      setT((now - t0) / 1000);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate]);

  const free = useMemo(() => res.modes(id === 'string' ? stiff : 0), [res, id, stiff]);
  // A bow (and breath) locks the modes into exact harmonics.
  const sustained = excite === 'bow' || excite === 'blow';
  const sounding: Mode[] = useMemo(
    () => (excite === 'bow' ? free.map((m, k) => ({ ...m, r: k + 1 })) : free),
    [free, excite],
  );
  const amps = useMemo(() => amplitudes(res, sounding, excite, pos), [res, sounding, excite, pos]);
  const weights = useMemo(
    () => amps.map((a, k) => (sustained ? a : a * Math.min(1, res.tau(k, sounding[k]) / 0.5))),
    [amps, sustained, res, sounding],
  );
  const verdict = useMemo(() => harmonicity(sounding, weights), [sounding, weights]);

  // ---------- sound ----------
  const stop = useCallback(() => {
    run.current?.stop(0.08);
    run.current = null;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setPlaying(null);
  }, []);
  useAudioOwner(playing !== null, stop);

  const play = (which: 'all' | number) => {
    run.current?.stop(0.03);
    if (timer.current) window.clearTimeout(timer.current);
    const r = startRun(0.05, 1);
    run.current = r;
    const { ctx } = r;
    const t0 = r.t0;
    const idx = which === 'all' ? sounding.map((_, k) => k) : [which];
    const a = which === 'all' ? amps : sounding.map((_, k) => (k === which ? 1 : 0));
    const total = idx.reduce((s, k) => s + a[k], 0) || 1;
    let end = 0;
    const SUSTAIN = 1.8;
    for (const k of idx) {
      if (a[k] <= 0) continue;
      const f = res.f1 * sounding[k].r;
      if (f > 15000) continue;
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      const g = ctx.createGain();
      const peak = (LEVEL * a[k]) / total;
      g.gain.setValueAtTime(0, t0);
      let stopAt: number;
      if (sustained) {
        const att = excite === 'bow' ? 0.12 : 0.07;
        g.gain.linearRampToValueAtTime(peak, t0 + att + 0.01 * k);
        g.gain.setValueAtTime(peak, t0 + SUSTAIN);
        g.gain.setTargetAtTime(0, t0 + SUSTAIN, 0.06);
        stopAt = t0 + SUSTAIN + 0.5;
      } else {
        const tau = res.tau(k, sounding[k]) * (which === 'all' ? 1 : 1.3);
        g.gain.linearRampToValueAtTime(peak, t0 + (excite === 'pluck' ? 0.004 : 0.003));
        g.gain.setTargetAtTime(0, t0 + 0.004, tau);
        stopAt = t0 + Math.min(6, tau * 5) + 0.1;
      }
      end = Math.max(end, stopAt);
      osc.connect(g).connect(r.bus);
      osc.start(t0);
      osc.stop(stopAt);
      osc.onended = () => g.disconnect();
    }
    // A little breath noise for blown tones; a short scrape for the bow.
    if (sustained && which === 'all') {
      const n = noiseSource(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = excite === 'blow' ? 2400 : 3200;
      bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(excite === 'blow' ? 0.05 : 0.03, t0 + 0.03);
      g.gain.setTargetAtTime(excite === 'blow' ? 0.012 : 0.004, t0 + 0.05, 0.08);
      g.gain.setTargetAtTime(0, t0 + SUSTAIN, 0.05);
      n.connect(bp).connect(g).connect(r.bus);
      n.start(t0);
      n.stop(t0 + SUSTAIN + 0.4);
      n.onended = () => g.disconnect();
    }
    setPlaying(which);
    timer.current = window.setTimeout(() => {
      if (run.current === r) {
        run.current = null;
        setPlaying(null);
      }
    }, (end - ctx.currentTime + 0.1) * 1000);
  };

  // ---------- picture ----------
  const VIS = 0.35; // on-screen cycles per second for mode 1
  const phase = (k: number, single: boolean) => {
    const r = sounding[k]?.r ?? 1;
    const speed = single ? VIS * Math.sqrt(Math.min(r, 4)) : VIS * r;
    return Math.cos(2 * Math.PI * speed * t);
  };

  const L = W - 2 * PAD;
  const y0 = H / 2;
  const isPipe = id === 'open' || id === 'closed';
  const isBar = id === 'bar' || id === 'marimba';

  const path1d = useMemo(() => {
    if (res.shape !== '1d') return { d: '', env: '', nodes: [] as number[] };
    const amp = isPipe ? 30 : isBar ? 34 : 52;
    const ks = view < 0 ? sounding.map((_, k) => k) : [view];
    const w = view < 0 ? amps : sounding.map((_, k) => (k === view ? 1 : 0));
    const sample = (x: number, withTime: boolean) =>
      ks.reduce((s, k) => s + w[k] * shape1d(id, k, x) * (withTime ? phase(k, view >= 0) : 1), 0);
    let norm = 1;
    if (view < 0) {
      // normalize the composite by its largest possible excursion
      norm = 0;
      for (let i = 0; i <= 100; i++) norm = Math.max(norm, Math.abs(ks.reduce((s, k) => s + w[k] * Math.abs(shape1d(id, k, i / 100)), 0)));
      norm = norm || 1;
    }
    const pts: string[] = [];
    const env: string[] = [];
    for (let i = 0; i <= 200; i++) {
      const x = i / 200;
      pts.push((i ? 'L' : 'M') + r2(PAD + x * L) + ' ' + r2(y0 - (sample(x, true) / norm) * amp));
    }
    const nodes: number[] = [];
    if (view >= 0) {
      for (let i = 0; i <= 200; i++) env.push((i ? 'L' : 'M') + r2(PAD + (i / 200) * L) + ' ' + r2(y0 - Math.abs(shape1d(id, view, i / 200)) * amp));
      for (let i = 200; i >= 0; i--) env.push('L' + r2(PAD + (i / 200) * L) + ' ' + r2(y0 + Math.abs(shape1d(id, view, i / 200)) * amp));
      let prev = shape1d(id, view, 0);
      if (Math.abs(prev) < 1e-6) nodes.push(0);
      for (let i = 1; i <= 400; i++) {
        const x = i / 400;
        const v = shape1d(id, view, x);
        if (Math.abs(v) < 1e-6) nodes.push(x);
        else if (prev * v < 0 && Math.abs(prev) > 1e-6) nodes.push(x - 1 / 800);
        prev = v;
      }
    }
    return { d: pts.join(''), env: env.length ? env.join('') + 'Z' : '', nodes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, id, view, sounding, amps, t]);

  const CX = W / 2;
  const CY = H / 2;
  const R = 78;
  const disk = useMemo(() => {
    if (res.shape === '1d') return null;
    const md = sounding[Math.max(0, view)];
    const m = md.m ?? 0;
    const n = md.n ?? 1;
    let radii: number[];
    if (res.shape === 'disk') {
      const z = BESSEL_ZEROS[m];
      radii = [1];
      for (let k = n - 1; k >= 1; k--) radii.push(z[k - 1] / z[n - 1]);
    } else {
      radii = n === 0 ? [1] : n === 1 ? [1, 0.55] : [1, 0.7, 0.4];
    }
    const sectors = m === 0 ? 1 : 2 * m;
    const c = phase(Math.max(0, view), true);
    const regions: { d: string; cls: string; op: number }[] = [];
    radii.forEach((rr, ring) => {
      const rad = rr * R;
      for (let s = 0; s < sectors; s++) {
        const sign = (ring + s) % 2 === 0 ? 1 : -1;
        const cls = sign * c >= 0 ? 'ins-pos' : 'ins-neg';
        const op = r2(0.12 + 0.78 * Math.abs(c));
        let d: string;
        if (sectors === 1) {
          d = `M${r2(CX - rad)} ${CY} A${r2(rad)} ${r2(rad)} 0 1 0 ${r2(CX + rad)} ${CY} A${r2(rad)} ${r2(rad)} 0 1 0 ${r2(CX - rad)} ${CY}Z`;
        } else {
          const a0 = (s * Math.PI) / m - Math.PI / 2;
          const a1 = ((s + 1) * Math.PI) / m - Math.PI / 2;
          d = `M${CX} ${CY} L${r2(CX + rad * Math.cos(a0))} ${r2(CY + rad * Math.sin(a0))} A${r2(rad)} ${r2(rad)} 0 0 1 ${r2(CX + rad * Math.cos(a1))} ${r2(CY + rad * Math.sin(a1))}Z`;
        }
        regions.push({ d, cls, op });
      }
    });
    const lines = Array.from({ length: m }, (_, k) => {
      const a = (k * Math.PI) / m - Math.PI / 2;
      return { x1: r2(CX + R * Math.cos(a)), y1: r2(CY + R * Math.sin(a)), x2: r2(CX - R * Math.cos(a)), y2: r2(CY - R * Math.sin(a)) };
    });
    return { regions, lines, circles: radii.slice(1).map((x) => r2(x * R)), m, n };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, view, sounding, t]);

  // ---------- spectrum ----------
  const maxR = Math.max(...sounding.map((m) => m.r)) * 1.06;
  // Inharmonic: draw the harmonics of the lowest mode, to show how far off the others land.
  const gridRef = verdict.label === 'inharmonic' ? sounding[0].r : verdict.ref;
  const sx = (r: number) => r2(PAD + (r / maxR) * L);
  const grid = useMemo(() => {
    const out: { x: number; h: number }[] = [];
    for (let h = 1; h * gridRef <= maxR; h++) out.push({ x: sx(h * gridRef), h });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridRef, maxR]);
  let lastLabel = -1e9;
  const heardHz = Math.round(res.f1 * verdict.ref);

  const shown = resonators.map((r) => resonator(r));
  const singleIdx = view >= 0 ? view : null;

  return (
    <Widget
      kicker="Lab"
      title={title}
      caption={
        <>
          Motion is slowed down enormously and exaggerated. The top picture shows the resonator vibrating in one mode
          (choose it below) or, for strings, pipes, and bars, in all its modes at once. For drums and bells you see the
          surface from above: the two colors move in opposite directions, and the lines between them (nodal lines) stay
          still. The bars underneath are the modes&rsquo; frequencies; the dashed lines mark whole-number multiples
          (of the implied fundamental, or of the lowest mode when there isn&rsquo;t one), so you can see whether the
          modes land on them. <strong>Play</strong> sounds every
          mode with the strengths the exciter gives it; one sine wave per mode.
        </>
      }
    >
      <div className="w-chips ins-res" role="radiogroup" aria-label="Resonator">
        {shown.map((r) => (
          <button key={r.id} type="button" role="radio" aria-checked={r.id === id} className={'w-chip' + (r.id === id ? ' is-on' : '')} onClick={() => { stop(); choose(r.id); }}>
            {r.label}
          </button>
        ))}
      </div>
      <p className="ins-blurb">
        <span className="ins-family">{res.family}.</span> {res.blurb}
      </p>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label={`${res.label}: mode shape`}>
        {res.shape === '1d' && (
          <g>
            {isPipe && (
              <g>
                <line x1={PAD} x2={W - PAD} y1={y0 - 40} y2={y0 - 40} className="ins-tube" />
                <line x1={PAD} x2={W - PAD} y1={y0 + 40} y2={y0 + 40} className="ins-tube" />
                {id === 'closed' && <rect x={PAD - 7} y={y0 - 44} width={7} height={88} className="fill-ink" />}
                <text x={PAD} y={y0 + 60} className="w-tick">
                  {id === 'closed' ? 'closed end: the air can’t move' : 'open end'}
                </text>
                <text x={W - PAD} y={y0 + 60} textAnchor="end" className="w-tick">
                  open end
                </text>
                <text x={W / 2} y={18} textAnchor="middle" className="w-tick">
                  how far the air sways back and forth along the tube
                </text>
              </g>
            )}
            {id === 'string' && (
              <g>
                <line x1={PAD} x2={W - PAD} y1={y0} y2={y0} className="stroke-grid" />
                <rect x={PAD - 8} y={y0 - 30} width={6} height={60} className="fill-ink" />
                <rect x={W - PAD + 2} y={y0 - 30} width={6} height={60} className="fill-ink" />
              </g>
            )}
            {isBar && (
              <g>
                <line x1={PAD} x2={W - PAD} y1={y0} y2={y0} className="stroke-grid" />
                {BAR_NODES.map((x) => (
                  <path key={x} d={`M${r2(PAD + x * L)} ${y0 + 44} l-7 12 h14 Z`} className="ins-support" />
                ))}
                <text x={r2(PAD + BAR_NODES[1] * L) + 12} y={y0 + 58} className="w-tick">
                  supports, at mode 1&rsquo;s nodes
                </text>
              </g>
            )}
            {path1d.env && <path d={path1d.env} className="ins-env" />}
            <path d={path1d.d} className={isBar ? 'ins-bar' : 'string-line'} />
            {path1d.nodes.map((x, i) => (
              <circle key={i} cx={r2(PAD + x * L)} cy={y0} r={4} className="fill-rough" />
            ))}
            {res.position && view < 0 && (
              <g>
                <line x1={r2(PAD + pos * L)} x2={r2(PAD + pos * L)} y1={26} y2={H - 14} className="stroke-b dashed" />
                <text x={r2(PAD + pos * L) + 5} y={32} className="w-tick key-b">
                  {excite === 'strike' ? 'strike point' : 'pluck point'}
                </text>
              </g>
            )}
          </g>
        )}
        {disk && (
          <g>
            {disk.regions.map((g, i) => (
              <path key={i} d={g.d} className={g.cls} style={{ fillOpacity: g.op }} />
            ))}
            <circle cx={CX} cy={CY} r={R} className="ins-rim" />
            {disk.lines.map((l, i) => (
              <line key={i} {...l} className="ins-node" />
            ))}
            {disk.circles.map((rr, i) => (
              <circle key={i} cx={CX} cy={CY} r={rr} className="ins-node" />
            ))}
            {res.position && (
              <g>
                <circle cx={r2(CX + pos * R * Math.cos(-0.35))} cy={r2(CY + pos * R * Math.sin(-0.35))} r={4.5} className="ins-strike" />
              </g>
            )}
            <text x={PAD - 20} y={30} className="w-tick">
              {res.shape === 'bell' ? 'seen from above' : 'the drumhead from above'}
            </text>
            <text x={PAD - 20} y={48} className="w-tick">
              {disk.m} nodal {res.shape === 'bell' ? 'meridian line' : 'diameter'}
              {disk.m === 1 ? '' : 's'}
            </text>
            <text x={PAD - 20} y={64} className="w-tick">
              {res.shape === 'bell' ? (disk.n === 0 ? 'no nodal circle' : `${disk.n} nodal circle${disk.n > 1 ? 's' : ''}`) : `${disk.n - 1} nodal circle${disk.n - 1 === 1 ? '' : 's'}`}
            </text>
            {res.position && (
              <text x={W - PAD + 20} y={30} textAnchor="end" className="w-tick key-b">
                ● strike point
              </text>
            )}
          </g>
        )}
      </svg>

      <div className="w-chips ins-modes" role="radiogroup" aria-label="Mode to show">
        <span className="w-label">Show</span>
        {res.shape === '1d' && (
          <button type="button" role="radio" aria-checked={view < 0} className={'w-chip' + (view < 0 ? ' is-on' : '')} onClick={() => setView(-1)}>
            All together
          </button>
        )}
        {sounding.map((m, k) => (
          <button key={k} type="button" role="radio" aria-checked={view === k} className={'w-chip' + (view === k ? ' is-on' : '')} onClick={() => setView(k)}>
            {res.shape === '1d' ? `Mode ${m.label}` : m.label} <span className="ins-x">×{fmtRatio(m.r)}</span>
          </button>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${SPEC_H}`} className="w-plot" role="img" aria-label="Frequencies of the modes against a grid of harmonics">
        {grid.map((g) => (
          <g key={g.h}>
            <line x1={g.x} x2={g.x} y1={16} y2={SPEC_H - 38} className="stroke-grid dashed" />
            {(grid.length < 20 || g.h % 2 === 1) && (
              <text x={g.x} y={12} textAnchor="middle" className="w-tick">
                {g.h}
              </text>
            )}
          </g>
        ))}
        <line x1={PAD} x2={W - PAD} y1={SPEC_H - 38} y2={SPEC_H - 38} className="stroke-ink" />
        {sounding.map((m, k) => {
          const x = sx(m.r);
          const h = (SPEC_H - 60) * amps[k];
          const showLabel = x - lastLabel > 30;
          if (showLabel) lastLabel = x;
          return (
            <g key={k} onClick={() => setView(k)} className="ins-specbar">
              <rect x={r2(x - 4)} y={r2(SPEC_H - 38 - Math.max(1, h))} width={8} height={r2(Math.max(1, h))} className={singleIdx === k ? 'ins-bar-sel' : 'harm-bar'} />
              {showLabel && (
                <text x={x} y={SPEC_H - 24} textAnchor="middle" className="w-tick">
                  {fmtRatio(m.r)}
                </text>
              )}
            </g>
          );
        })}
        <text x={PAD} y={SPEC_H - 4} className="w-tick">
          frequency, as a multiple of the lowest mode ({res.f1} Hz)
        </text>
      </svg>

      <div className="w-controls">
        <button type="button" className={'w-play' + (playing === 'all' ? ' is-playing' : '')} onClick={() => (playing === 'all' ? stop() : play('all'))}>
          <span className="w-play-icon" aria-hidden>
            {playing === 'all' ? '■' : '▶'}
          </span>
          {playing === 'all' ? 'Stop' : EXCITE_LABEL[excite]}
        </button>
        {singleIdx !== null && (
          <button type="button" className={'w-chip' + (playing === singleIdx ? ' is-on' : '')} onClick={() => (playing === singleIdx ? stop() : play(singleIdx))}>
            {playing === singleIdx ? '■ Stop' : `▶ This mode alone`}
          </button>
        )}
        {res.excitations.length > 1 && (
          <Segmented label="Exciter" value={excite} options={res.excitations.map((e) => ({ value: e, label: EXCITE_LABEL[e] }))} onChange={(e) => { stop(); setExcite(e); }} />
        )}
        <button type="button" className="w-chip" onClick={() => setAnimate((a) => !a)}>
          {animate ? 'Pause motion' : 'Animate'}
        </button>
      </div>
      {res.position && excite !== 'bow' && (
        <Slider
          label={res.position[3]}
          min={res.position[0]}
          max={res.position[1]}
          step={0.01}
          value={pos}
          onChange={setPos}
          display={res.shape === 'disk' ? (pos < 0.05 ? 'dead center' : `${Math.round(pos * 100)}% of the way out`) : pos > 0.48 ? 'middle' : `${Math.round(pos * 100)}% along`}
        />
      )}
      {id === 'string' && (
        <Slider
          label="Stiffness (thick steel wire)"
          min={0}
          max={0.004}
          step={0.0001}
          value={stiff}
          onChange={setStiff}
          display={stiff === 0 ? 'none (ideal string)' : `B = ${stiff.toFixed(4)}`}
        />
      )}

      <div className="w-readouts">
        <Readout label="Lowest mode">{Math.round(res.f1 * sounding[0].r)} Hz</Readout>
        <Readout label="Pattern">
          <span className={verdict.label === 'inharmonic' ? 'key-rough' : verdict.label === 'harmonic' ? 'key-match' : 'key-b'}>{verdict.label}</span>
          {verdict.label === 'nearly harmonic' && ` (typical miss ${Math.round(verdict.rms)} cents)`}
        </Readout>
        <Readout label="Implied fundamental">
          {verdict.label === 'inharmonic'
            ? 'none: the modes don\u2019t share one'
            : `${heardHz} Hz${verdict.ref < sounding[0].r - 0.01 ? ' (below the lowest mode)' : ''}`}
        </Readout>
        {singleIdx !== null && (
          <Readout label={`Mode ${sounding[singleIdx].label}`}>
            {Math.round(res.f1 * sounding[singleIdx].r)} Hz
            {verdict.label !== 'inharmonic' &&
              ` · harmonic ${verdict.fit[singleIdx].h}${Math.abs(verdict.fit[singleIdx].cents) >= 1 ? ` ${verdict.fit[singleIdx].cents > 0 ? '+' : ''}${Math.round(verdict.fit[singleIdx].cents)} cents` : ''}`}
          </Readout>
        )}
      </div>
      {id === 'string' && stiff > 0 && excite === 'bow' && (
        <p className="ins-note">
          Bowed: the bow locks the string&rsquo;s motion into one repeating pattern, so the partials sound at exact
          whole-number ratios even though the stiff string&rsquo;s own modes are stretched. Switch to Pluck to hear them
          stretched.
        </p>
      )}
    </Widget>
  );
}

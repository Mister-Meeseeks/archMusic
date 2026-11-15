// An EDM-style build and drop, assembled from switchable ingredients:
// an accelerating snare roll, a noise riser, a rising synth line, cutting the
// bass and kick (a high-pass sweep), and a beat of silence before the drop.
// The lanes show the actual schedule of each ingredient, so what you see is
// what is being played.

import { useCallback, useEffect, useRef, useState } from 'react';
import { playDrum } from '../../lib/rhythm';
import { harmonicWave, noiseSource, note, startRun, type Run } from '../../lib/sequence';
import { midiToHz } from '../../lib/tuning';
import { PlayButton, Widget, r2, useAudioOwner } from './ui';

const BPM = 126;
const BEAT = 60 / BPM;
const BAR = 4 * BEAT;
const GROOVE_BARS = 2;
const BUILD_BARS = 8;
const DROP_BARS = 4;
const TOTAL_BARS = GROOVE_BARS + BUILD_BARS + DROP_BARS;
const B0 = GROOVE_BARS; // first build bar
const D0 = GROOVE_BARS + BUILD_BARS; // first drop bar

// One chord per bar, looping: Am F C G (as offbeat stabs) with the bass on the roots.
const PROG = [
  { notes: [57, 60, 64], bass: 33 },
  { notes: [53, 57, 60], bass: 29 },
  { notes: [55, 60, 64], bass: 36 },
  { notes: [55, 59, 62], bass: 31 },
];

type Ing = 'roll' | 'riser' | 'pitch' | 'cut' | 'gap';
const INGREDIENTS: { id: Ing; label: string; lane: string }[] = [
  { id: 'roll', label: 'Snare roll', lane: 'Snare hits per beat' },
  { id: 'riser', label: 'Noise riser', lane: 'Riser (loudness & brightness)' },
  { id: 'pitch', label: 'Rising synth', lane: 'Synth pitch' },
  { id: 'cut', label: 'Cut the bass & kick', lane: 'Low end removed' },
  { id: 'gap', label: 'Silent beat before the drop', lane: 'Silence' },
];

/** Snare hits per beat during the build: 1, 2, 4, 8 in two-bar steps. */
const rollRate = (buildBar: number) => [1, 2, 4, 8][Math.min(3, Math.floor(buildBar / 2))];

export default function BuildLab() {
  const [on, setOn] = useState<Record<Ing, boolean>>({ roll: true, riser: true, pitch: false, cut: true, gap: true });
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState<number | null>(null); // position in bars
  const run = useRef<Run | null>(null);
  const raf = useRef(0);

  const stop = useCallback(() => {
    run.current?.stop(0.15);
    run.current = null;
    cancelAnimationFrame(raf.current);
    setPlaying(false);
    setPos(null);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const play = () => {
    if (playing) return stop();
    const r = startRun(0.15, 1);
    run.current = r;
    const { ctx, t0 } = r;
    const T = (bar: number, beat = 0) => t0 + bar * BAR + beat * BEAT;
    const gapStart = T(D0 - 1, 3);
    const dropT = T(D0);
    const silent = (t: number) => on.gap && t >= gapStart - 0.001 && t < dropT - 0.001;

    // Buses: music (chords + bass) goes through a high-pass filter that sweeps up during the build if "cut" is on.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.Q.value = 0.9;
    hp.frequency.setValueAtTime(20, t0);
    if (on.cut) {
      hp.frequency.setValueAtTime(20, T(B0));
      hp.frequency.exponentialRampToValueAtTime(900, T(D0 - 1, 3));
      hp.frequency.setValueAtTime(20, dropT);
    }
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    hp.connect(lp).connect(r.bus);
    const drumBus = r.bus;

    const stab = harmonicWave(ctx, 14, 1.0);
    const bassWave = harmonicWave(ctx, 8, 1.3);

    for (let bar = 0; bar < TOTAL_BARS; bar++) {
      const inBuild = bar >= B0 && bar < D0;
      const inDrop = bar >= D0;
      const ch = PROG[bar % 4];
      for (let beat = 0; beat < 4; beat++) {
        const t = T(bar, beat);
        const off = T(bar, beat + 0.5);
        // kick: four on the floor, except during the build if cut
        if (!(inBuild && on.cut) && !silent(t)) kickAt(t, inDrop ? 1 : 0.8);
        // hats on the offbeats (groove and drop)
        if (!inBuild && !silent(off)) playDrumAt(drumBus, 'hat', off, inDrop ? 0.9 : 0.6);
        // chord stabs on the offbeats
        if (!silent(off))
          ch.notes.forEach((m) => {
            note(r, { f: midiToHz(m), t: off, dur: 0.09, gain: inDrop ? 0.07 : 0.05, attack: 0.005, release: 0.18, wave: stab, dest: hp });
            note(r, { f: midiToHz(m), t: off, dur: 0.09, gain: inDrop ? 0.05 : 0.035, attack: 0.005, release: 0.18, wave: stab, detune: 14, dest: hp });
          });
        // bass: only in the drop (that's the payoff), on every eighth
        if (inDrop) {
          note(r, { f: midiToHz(ch.bass), t, dur: BEAT * 0.4, gain: 0.32, attack: 0.005, release: 0.06, wave: bassWave, dest: hp });
          note(r, { f: midiToHz(ch.bass + 12), t: off, dur: BEAT * 0.35, gain: 0.22, attack: 0.005, release: 0.06, wave: bassWave, dest: hp });
        }
      }
      // snare: backbeat in groove and drop
      if (!inBuild) [1, 3].forEach((b) => !silent(T(bar, b)) && playDrumAt(drumBus, 'snare', T(bar, b), inDrop ? 0.9 : 0.7));
      // snare roll in the build
      if (inBuild && on.roll) {
        const rate = rollRate(bar - B0);
        for (let i = 0; i < 4 * rate; i++) {
          const t = T(bar, i / rate);
          if (silent(t)) continue;
          const prog = (bar - B0 + i / (4 * rate)) / BUILD_BARS; // 0..1 through the build
          playDrumAt(drumBus, 'snare', t, 0.35 + 0.6 * prog);
        }
      }
    }

    // crash on the drop
    crashAt(dropT);

    // riser: noise through a band-pass sweeping up, getting louder
    if (on.riser) {
      const n = noiseSource(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(300, T(B0));
      bp.frequency.exponentialRampToValueAtTime(9000, T(D0 - 1, on.gap ? 3 : 4));
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, T(B0));
      g.gain.linearRampToValueAtTime(0.5, T(D0 - 1, on.gap ? 3 : 4));
      g.gain.setValueAtTime(0, on.gap ? gapStart : dropT);
      n.connect(bp).connect(g).connect(r.bus);
      n.start(T(B0));
      n.stop(dropT + 0.05);
    }

    // rising synth: eighth-note pulses whose pitch rises an octave over the build
    if (on.pitch) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(midiToHz(57), T(B0));
      osc.frequency.exponentialRampToValueAtTime(midiToHz(81), T(D0));
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      for (let i = 0; i < BUILD_BARS * 8; i++) {
        const t = T(B0, i / 2);
        if (silent(t)) continue;
        const lvl = 0.035 + 0.05 * (i / (BUILD_BARS * 8));
        g.gain.setValueAtTime(lvl, t);
        g.gain.setTargetAtTime(0, t + BEAT * 0.25, 0.03);
      }
      osc.connect(f).connect(g).connect(r.bus);
      osc.start(T(B0));
      osc.stop(dropT);
    }

    function kickAt(t: number, v: number) {
      playDrumAt(drumBus, 'kick', t, v);
    }
    function crashAt(t: number) {
      const n = noiseSource(ctx);
      const hpC = ctx.createBiquadFilter();
      hpC.type = 'highpass';
      hpC.frequency.value = 5000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.25, t + 0.005);
      g.gain.setTargetAtTime(0, t + 0.01, 0.6);
      n.connect(hpC).connect(g).connect(r.bus);
      n.start(t);
      n.stop(t + 3);
    }

    // playhead
    const startedAt = t0;
    const totalT = TOTAL_BARS * BAR;
    const tick = () => {
      if (run.current !== r) return;
      const el = ctx.currentTime - startedAt;
      if (el > totalT + 1.5) {
        run.current = null;
        setPlaying(false);
        setPos(null);
        return;
      }
      setPos(Math.max(0, el / BAR));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    setPlaying(true);
  };

  // ---- lanes ----
  const W = 680;
  const LX = 150; // label column
  const PW = W - LX - 10;
  const bx = (bar: number) => r2(LX + (bar / TOTAL_BARS) * PW);
  const LANE_H = 30;
  const lanes = INGREDIENTS;
  const H = 26 + lanes.length * LANE_H + 8;
  const laneTop = (i: number) => 26 + i * LANE_H;

  const lanePath = (id: Ing, i: number) => {
    const y0 = laneTop(i) + LANE_H - 6;
    const hgt = LANE_H - 10;
    const gapX = on.gap ? D0 - 0.25 : D0;
    if (id === 'roll') {
      let d = `M${bx(B0)} ${y0}`;
      for (let k = 0; k < 4; k++) {
        const h = y0 - (hgt * Math.log2(rollRate(2 * k)) + hgt / 4) / (3 + 0.25);
        const xa = bx(B0 + 2 * k);
        const xb = bx(Math.min(B0 + 2 * k + 2, gapX));
        d += `L${xa} ${r2(h)}L${xb} ${r2(h)}`;
      }
      return d + `L${bx(gapX)} ${y0}Z`;
    }
    if (id === 'riser' || id === 'pitch') return `M${bx(B0)} ${y0}L${bx(gapX)} ${y0 - hgt}L${bx(gapX)} ${y0}Z`;
    if (id === 'cut') return `M${bx(B0)} ${y0}L${bx(D0 - 0.25)} ${y0 - hgt}L${bx(D0)} ${y0 - hgt}L${bx(D0)} ${y0}Z`;
    return `M${bx(D0 - 0.25)} ${y0}L${bx(D0 - 0.25)} ${y0 - hgt}L${bx(D0)} ${y0 - hgt}L${bx(D0)} ${y0}Z`;
  };

  return (
    <Widget
      kicker="Lab"
      title="Build and drop"
      caption={
        <>
          Two bars of groove, an eight-bar <strong>build</strong>, then the <strong>drop</strong> at {BPM} BPM. Switch
          ingredients on and off and listen to how hard the drop lands. The lanes show exactly what each ingredient does
          over time. The drop itself never changes: the bass line enters, the kick and hi-hats come back, and a crash
          cymbal marks beat one. Try it first with everything off.
        </>
      }
    >
      <div className="w-controls">
        <PlayButton playing={playing} onClick={play} />
        <div className="w-chips">
          {INGREDIENTS.map((g) => (
            <button
              key={g.id}
              type="button"
              className={'w-chip' + (on[g.id] ? ' is-on' : '')}
              aria-pressed={on[g.id]}
              disabled={playing}
              onClick={() => setOn((o) => ({ ...o, [g.id]: !o[g.id] }))}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Timeline of the build ingredients">
        {/* section bands */}
        {[
          { a: 0, b: B0, label: 'Groove' },
          { a: B0, b: D0, label: 'Build' },
          { a: D0, b: TOTAL_BARS, label: 'Drop' },
        ].map((s) => (
          <g key={s.label}>
            <rect x={bx(s.a)} y={4} width={r2(bx(s.b) - bx(s.a) - 2)} height={16} rx={3} className={'sect-band sect-' + s.label.toLowerCase()} />
            <text x={r2((bx(s.a) + bx(s.b)) / 2)} y={16} textAnchor="middle" className="w-tick sect-label">
              {s.label}
            </text>
          </g>
        ))}
        {Array.from({ length: TOTAL_BARS + 1 }, (_, b) => (
          <line key={b} x1={bx(b)} x2={bx(b)} y1={24} y2={H - 6} className="stroke-grid" />
        ))}
        {lanes.map((g, i) => (
          <g key={g.id} opacity={on[g.id] ? 1 : 0.25}>
            <text x={4} y={laneTop(i) + LANE_H / 2 + 4} className="w-tick">
              {g.lane}
            </text>
            <path d={lanePath(g.id, i)} className={'lane-fill lane-' + g.id} />
          </g>
        ))}
        {pos !== null && <line x1={bx(Math.min(pos, TOTAL_BARS))} x2={bx(Math.min(pos, TOTAL_BARS))} y1={2} y2={H - 2} className="playhead" />}
      </svg>
    </Widget>
  );
}

function playDrumAt(dest: AudioNode, id: 'kick' | 'snare' | 'hat' | 'ride', t: number, vel: number) {
  playDrum(id, t, vel, dest);
}

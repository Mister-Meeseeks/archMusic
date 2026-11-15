// Build a tone from harmonics. Drag the bars to set each harmonic's
// strength; hear it live and see the waveform. "Scramble phases" changes the
// waveform's shape without changing the harmonic amounts, and the sound
// barely changes. That's Ohm's acoustic law: the ear mostly cares about the
// recipe, not the shape.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAudio } from '../../lib/audio';
import { N_HARM, RECIPES, type Recipe, padRecipe, periodicWave, recipeGain, waveform } from '../../lib/spectrum';
import { midiName, midiToHz } from '../../lib/tuning';
import { PlayButton, Segmented, Widget, r2, useAudioOwner } from './ui';

const W = 680;

export default function HarmonicBuilder(props: { recipe?: string; recipes?: string[]; midi?: number }) {
  const list = props.recipes ? RECIPES.filter((r) => props.recipes!.includes(r.id)) : RECIPES;
  const initial = RECIPES.find((r) => r.id === props.recipe) ?? list[0];
  const [recipeId, setRecipeId] = useState<string>(initial.id);
  const [amps, setAmps] = useState<Recipe>(padRecipe(initial.amps));
  const [phases, setPhases] = useState<number[]>(Array(N_HARM).fill(0));
  const [midi, setMidi] = useState(props.midi ?? 45); // A2 = 110 Hz
  const [playing, setPlaying] = useState(false);
  const nodes = useRef<{ osc: OscillatorNode; gain: GainNode } | null>(null);

  const stop = useCallback(() => {
    const n = nodes.current;
    if (n) {
      const { ctx } = getAudio();
      n.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      n.osc.stop(ctx.currentTime + 0.2);
      nodes.current = null;
    }
    setPlaying(false);
  }, []);
  useAudioOwner(playing, stop);

  // Keep the sound in sync with the recipe while playing.
  useEffect(() => {
    const n = nodes.current;
    if (!n) return;
    const { ctx } = getAudio();
    n.osc.setPeriodicWave(periodicWave(amps, phases));
    n.osc.frequency.setTargetAtTime(midiToHz(midi), ctx.currentTime, 0.01);
    n.gain.gain.setTargetAtTime(recipeGain(amps), ctx.currentTime, 0.02);
  }, [amps, phases, midi]);

  const toggle = () => {
    if (playing) return stop();
    const { ctx, out } = getAudio();
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(periodicWave(amps, phases));
    osc.frequency.value = midiToHz(midi);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(recipeGain(amps), ctx.currentTime, 0.02);
    osc.connect(gain).connect(out);
    osc.start();
    nodes.current = { osc, gain };
    setPlaying(true);
  };

  const loadRecipe = (id: string) => {
    setRecipeId(id);
    setAmps(padRecipe(RECIPES.find((r) => r.id === id)!.amps));
  };

  // ---- bar editor ----
  const BAR_H = 120;
  const barW = (W - 40) / N_HARM;
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const setFromPointer = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W - 30;
    const y = ((e.clientY - r.top) / r.height) * (BAR_H + 34) - 8;
    const k = Math.floor(x / barW);
    if (k < 0 || k >= N_HARM) return;
    const v = Math.max(0, Math.min(1, 1 - y / BAR_H));
    setAmps((a) => a.map((old, i) => (i === k ? (v < 0.03 ? 0 : v) : old)));
    setRecipeId('custom');
  };

  const wave = useMemo(() => waveform(amps, phases, 500, 2), [amps, phases]);
  const wavePath = wave.map((v, i) => (i ? 'L' : 'M') + r2((i / (wave.length - 1)) * W) + ' ' + r2(60 - v * 50)).join('');
  const recipe = RECIPES.find((r) => r.id === recipeId);
  const scrambled = phases.some((p) => p !== 0);

  return (
    <Widget
      kicker="Lab"
      title="Harmonic builder"
      caption={
        <>
          Top: drag up and down on the bars to set the strength of each harmonic (1 is the fundamental). Bottom: two
          cycles of the resulting waveform. <strong>Scramble phases</strong> shifts each harmonic in time by a random
          amount, so the strengths stay the same but the waveform's shape changes.
        </>
      }
    >
      <div className="w-controls">
        <PlayButton playing={playing} onClick={toggle} />
        <Segmented
          label="Recipe"
          value={recipeId}
          options={[...list.map((r) => ({ value: r.id, label: r.label })), ...(recipeId === 'custom' ? [{ value: 'custom', label: 'Custom' }] : [])]}
          onChange={(id) => id !== 'custom' && loadRecipe(id)}
        />
      </div>
      {recipe && <p className="w-note muted">{recipe.blurb}</p>}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${BAR_H + 34}`}
        className="w-plot is-clickable"
        role="img"
        aria-label="Harmonic strengths (drag to edit)"
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setFromPointer(e);
        }}
        onPointerMove={(e) => dragging.current && setFromPointer(e)}
        onPointerUp={() => (dragging.current = false)}
      >
        {amps.map((a, k) => (
          <g key={k}>
            <rect x={r2(30 + k * barW + 3)} y={8} width={r2(barW - 6)} height={BAR_H} className="harm-slot" />
            <rect x={r2(30 + k * barW + 3)} y={r2(8 + BAR_H * (1 - a))} width={r2(barW - 6)} height={r2(BAR_H * a)} className="harm-bar" />
            <text x={r2(30 + k * barW + barW / 2)} y={BAR_H + 26} textAnchor="middle" className="w-tick">
              {k + 1}
            </text>
          </g>
        ))}
      </svg>

      <svg viewBox={`0 0 ${W} 120`} className="w-plot" role="img" aria-label="Waveform">
        <line x1={0} x2={W} y1={60} y2={60} className="stroke-grid" />
        <line x1={W / 2} x2={W / 2} y1={6} y2={114} className="stroke-grid" />
        <path d={wavePath} className="stroke-a" />
      </svg>

      <div className="w-controls">
        <button type="button" className="w-play small" onClick={() => setPhases(Array.from({ length: N_HARM }, () => Math.random() * 2 * Math.PI))}>
          Scramble phases
        </button>
        {scrambled && (
          <button type="button" className="w-chip" onClick={() => setPhases(Array(N_HARM).fill(0))}>
            Reset phases
          </button>
        )}
        <Segmented
          label="Note"
          value={midi}
          options={[
            { value: 45, label: `${midiName(45)} · 110 Hz` },
            { value: 57, label: `${midiName(57)} · 220 Hz` },
          ]}
          onChange={setMidi}
        />
      </div>
    </Widget>
  );
}

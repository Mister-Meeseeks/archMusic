// Step sequencer with swing, per-instrument timing offsets, and humanization.
// The "timing map" below the grid shows where each hit actually lands
// relative to the straight sixteenth-note grid. That's the mechanism
// behind swing and "laid back" feel, made visible.
// Reused across Vol II (rhythm), Vol V (loops/process), and the Atlas.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DRUMS,
  DRUM_LABELS,
  type DrumId,
  type GrooveParams,
  GroovePlayer,
  type Pattern,
  PRESETS,
  STEPS,
  type StepState,
  barDuration,
  presetParams,
  stepTime,
  swingRatio,
} from '../../lib/rhythm';
import { PlayButton, Segmented, Slider, Widget, r2, useAudioOwner } from './ui';

type Control = 'presets' | 'tempo' | 'swing' | 'offsets' | 'humanize';
const ALL_CONTROLS: Control[] = ['presets', 'tempo', 'swing', 'offsets', 'humanize'];
const NEXT_STATE: Record<StepState, StepState> = { 0: 1, 1: 2, 2: 3, 3: 0 };
const STATE_LABEL: Record<StepState, string> = { 0: 'off', 1: 'on', 2: 'accent', 3: 'ghost' };

const W = 680;
const LABEL_W = 56;

export default function GrooveLab(props: {
  preset?: string;
  /** Which presets to offer (ids). Default: all. */
  presets?: string[];
  controls?: Control[];
  /** Which instrument rows get timing-offset sliders. Default: all used in the pattern. */
  offsetTracks?: DrumId[];
  editable?: boolean;
  title?: string;
}) {
  const presetList = props.presets ? PRESETS.filter((p) => props.presets!.includes(p.id)) : PRESETS;
  const initial = PRESETS.find((p) => p.id === props.preset) ?? presetList[0];
  const controls = props.controls ?? ALL_CONTROLS;
  const editable = props.editable ?? true;

  const [presetId, setPresetId] = useState(initial.id);
  const [pattern, setPattern] = useState<Pattern>(initial.pattern);
  const [params, setParams] = useState<GrooveParams>(presetParams(initial));
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(-1);

  // The player reads the latest state through this ref on every tick.
  const live = useRef({ pattern, params });
  live.current = { pattern, params };
  const player = useRef<GroovePlayer | null>(null);

  const stop = useCallback(() => {
    player.current?.stop();
    setPlaying(false);
  }, []);
  useAudioOwner(playing, stop);

  const toggle = () => {
    if (playing) return stop();
    if (!player.current) {
      player.current = new GroovePlayer(() => live.current);
      player.current.onStep = setStep;
    }
    player.current.start();
    setPlaying(true);
  };
  useEffect(() => () => player.current?.stop(), []);

  const loadPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setPresetId(id);
    setPattern(p.pattern);
    setParams(presetParams(p));
  };

  const cycle = (id: DrumId, i: number) => {
    if (!editable) return;
    setPattern((p) => ({ ...p, [id]: p[id].map((s, k) => (k === i ? NEXT_STATE[s] : s)) }));
  };

  const set = <K extends keyof GrooveParams>(k: K, v: GrooveParams[K]) => setParams((p) => ({ ...p, [k]: v }));
  const setOffset = (id: DrumId, v: number) => setParams((p) => ({ ...p, offsets: { ...p.offsets, [id]: v } }));

  const usedTracks = DRUMS.filter((id) => pattern[id].some((s) => s > 0));
  const offsetTracks = props.offsetTracks ?? usedTracks;

  // ---- timing map geometry ----
  const bar = barDuration(params.bpm);
  const gx = (t: number) => r2(LABEL_W + (t / bar) * (W - LABEL_W - 8));
  const ROW_H = 22;
  const TOP = 30;
  const mapH = TOP + usedTracks.length * ROW_H + 22;
  const hits = useMemo(
    () =>
      usedTracks.flatMap((id, row) =>
        pattern[id]
          .map((s, i) => ({ s, i }))
          .filter((h) => h.s > 0)
          .map((h) => ({
            id,
            row,
            s: h.s,
            i: h.i,
            // Early hits on beat 1 stay just left of the first line (not wrapped to the bar's end).
            t: (() => {
              const t = stepTime(h.i, params) + params.offsets[id] / 1000;
              return t >= bar ? t - bar : t;
            })(),
          })),
      ),
    [pattern, params, usedTracks.join(), bar],
  );

  const preset = PRESETS.find((p) => p.id === presetId)!;

  // Which grid positions does swing move? 8th swing: the "&" of each beat;
  // 16th swing: every "e" and "a". (Positions are 0-based steps.)
  const swungSteps = Array.from({ length: STEPS }, (_, i) => i).filter((i) =>
    params.swingUnit === '8th' ? i % 4 === 2 : i % 2 === 1,
  );
  const isSwung = new Set(swungSteps);
  const swingOn = controls.includes('swing') && params.swing > 0.505;
  const nothingToSwing = swingOn && !usedTracks.some((id) => swungSteps.some((i) => pattern[id][i] > 0));
  const swingPct = Math.round(params.swing * 100);

  return (
    <Widget
      kicker="Lab"
      title={props.title ?? 'Groove lab'}
      caption={
        <>
          Top: one bar of 4/4 as sixteen steps (four per beat).{' '}
          {editable && <>Click a cell to cycle it: on → accent → ghost (very soft) → off. </>}
          {controls.includes('swing') && (
            <>
              When swing is on, the orange-tinted columns are the positions it moves, and the orange arrows on the
              timing map show where those positions now fall (even when they're empty).{' '}
            </>
          )}
          Bottom: the <strong>timing map</strong>. Thin lines are the straight sixteenth-note grid, heavier lines
          are beats, and each dot is where a hit actually lands after swing and timing offsets (bigger dots are louder).
          Random humanization isn't drawn, because it changes on every hit.
        </>
      }
    >
      <div className="w-controls">
        <PlayButton playing={playing} onClick={toggle} />
        {controls.includes('presets') && presetList.length > 1 && (
          <Segmented
            label="Pattern"
            value={presetId}
            options={presetList.map((p) => ({ value: p.id, label: p.label }))}
            onChange={loadPreset}
          />
        )}
      </div>
      <p className="w-note muted">{preset.blurb}</p>
      {nothingToSwing && (
        <p className="w-note w-warn">
          Nothing in this pattern falls on the {params.swingUnit === '8th' ? 'eighth-note offbeats (the “&”s)' : 'sixteenth-note offbeats (the “e”s and “a”s)'},
          the tinted columns, so {params.swingUnit === '8th' ? 'eighth' : 'sixteenth'}-note swing has nothing to move.
          {editable ? ' Add a hit in a tinted column, or switch what gets swung.' : ' Try swinging the other note value.'}
        </p>
      )}

      <div className="w-grid" role="grid" aria-label="Step sequencer">
        <div className="w-grid-row w-grid-head" aria-hidden>
          <span className="w-grid-label" />
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={'w-grid-count' + (i % 4 === 0 ? ' is-beat' : '')}>
              {i % 4 === 0 ? i / 4 + 1 : i % 4 === 2 ? '&' : i % 4 === 1 ? 'e' : 'a'}
            </span>
          ))}
        </div>
        {DRUMS.map((id) => (
          <div key={id} className="w-grid-row" role="row">
            <span className="w-grid-label">{DRUM_LABELS[id]}</span>
            {pattern[id].map((s, i) => (
              <button
                type="button"
                key={i}
                role="gridcell"
                aria-label={`${DRUM_LABELS[id]} step ${i + 1}: ${STATE_LABEL[s]}`}
                className={
                  'w-cell s' +
                  s +
                  (i % 4 === 0 ? ' is-beat' : '') +
                  (swingOn && isSwung.has(i) ? ' is-swung' : '') +
                  (i === step ? ' is-now' : '') +
                  (editable ? '' : ' is-locked')
                }
                onClick={() => cycle(id, i)}
              />
            ))}
          </div>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${mapH}`} className="w-plot" role="img" aria-label="Timing map">
        {Array.from({ length: STEPS + 1 }, (_, i) => {
          const x = gx((i / STEPS) * bar);
          return <line key={i} x1={x} x2={x} y1={TOP - 6} y2={mapH - 18} className={i % 4 === 0 ? 'stroke-ink thin-beat' : 'stroke-grid'} />;
        })}
        {usedTracks.map((id, row) => (
          <text key={id} x={4} y={TOP + row * ROW_H + 8} className="w-tick">
            {DRUM_LABELS[id]}
          </text>
        ))}
        {swingOn &&
          swungSteps.map((i) => {
            const straight = gx((i / STEPS) * bar);
            const swung = gx(stepTime(i, params));
            return (
              <g key={'sw' + i} className="swing-mark">
                <line x1={straight} x2={swung} y1={TOP - 12} y2={TOP - 12} />
                <path d={`M${swung - 4} ${TOP - 17} L${swung + 4} ${TOP - 17} L${swung} ${TOP - 10} Z`} />
              </g>
            );
          })}
        {hits.map((h, k) => (
          <circle
            key={k}
            cx={gx(h.t)}
            cy={TOP + h.row * ROW_H + 4}
            r={h.s === 2 ? 5.5 : h.s === 1 ? 4.2 : 2.6}
            className={'groove-dot d-' + h.id}
          />
        ))}
        {[0, 1, 2, 3].map((b) => (
          <text key={b} x={gx((b / 4) * bar) + 3} y={mapH - 5} className="w-tick">
            beat {b + 1}
          </text>
        ))}
        
      </svg>

      <div className="w-controls w-stack">
        {controls.includes('tempo') && (
          <Slider label="Tempo" min={60} max={180} step={1} value={params.bpm} onChange={(v) => set('bpm', v)} display={`${params.bpm} BPM · 16th = ${((bar / 16) * 1000).toFixed(0)} ms`} />
        )}
        {controls.includes('swing') && (
          <>
            <Slider
              label="Swing"
              min={0.5}
              max={0.75}
              step={0.005}
              value={params.swing}
              onChange={(v) => set('swing', v)}
              display={
                <>
                  {swingPct}% · {swingRatio(params.swing).toFixed(2)}:1
                  {Math.abs(params.swing - 0.5) < 0.003 ? ' (straight)' : Math.abs(params.swing - 0.667) < 0.006 ? ' (triplet)' : ''}
                </>
              }
            />
            <Segmented
              label="Swing what"
              value={params.swingUnit}
              options={[
                { value: '8th', label: 'Eighth notes' },
                { value: '16th', label: 'Sixteenth notes' },
              ]}
              onChange={(v) => set('swingUnit', v)}
            />
          </>
        )}
        {controls.includes('offsets') &&
          offsetTracks.map((id) => (
            <Slider
              key={id}
              label={`${DRUM_LABELS[id]} timing`}
              min={-40}
              max={40}
              step={1}
              value={params.offsets[id]}
              onChange={(v) => setOffset(id, v)}
              display={
                params.offsets[id] === 0
                  ? 'on the grid'
                  : `${Math.abs(params.offsets[id])} ms ${params.offsets[id] > 0 ? 'late' : 'early'}`
              }
            />
          ))}
        {controls.includes('humanize') && (
          <Slider
            label="Humanize"
            min={0}
            max={30}
            step={1}
            value={params.humanize}
            onChange={(v) => set('humanize', v)}
            display={params.humanize === 0 ? 'off (quantized)' : `±${params.humanize} ms scatter`}
          />
        )}
      </div>
    </Widget>
  );
}

// Accents, grouping, and pushed notes (chapter 2.3; reusable in 2.4 and 3.3).
//
// Two halves:
//  - "accents": an even stream of eighth notes, grouped by accents of one
//    kind (louder, longer, or higher). With a steady beat underneath, the
//    groups either line up with the beat or cut across it.
//  - "push": a familiar tune over a drum loop. Click a note to push it a
//    sixteenth or an eighth ahead of its beat (an anticipation) and watch the
//    syncopation score change. Backbeat placement, half-/double-time feel,
//    shuffle, and drums on/off are all switchable.
//
// The syncopation score is the simplified Longuet-Higgins & Lee measure used
// by the groove labs (rhythm.ts weights), applied to the tune's onsets.
// What you see is what plays: the grid is drawn from the same arrays that
// schedule the sound.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { METRIC_WEIGHTS, type DrumId, barDuration, playDrum, stepTime } from '../../lib/rhythm';
import { harmonicWave, loop, note, startRun, type Run } from '../../lib/sequence';
import { PlayButton, Readout, Segmented, Slider, Widget, r2, useAudioOwner } from './ui';

type Mode = 'accents' | 'push';
type AccentKind = 'none' | 'dynamic' | 'agogic' | 'tonal';
type BeatMode = 'none' | 'steady' | 'groups';
type Feel = 'normal' | 'half' | 'double';
type SnareAt = 'backbeat' | 'onbeat' | 'off';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// ---------- accents and grouping ----------

type Grouping = { id: string; label: string; groups: number[]; bar?: number; blurb: string };
export const GROUPINGS: Grouping[] = [
  { id: '4444', label: '4 + 4 + 4 + 4', groups: [4, 4, 4, 4], bar: 8, blurb: 'Groups of four eighth notes: every group starts on a beat. The accents confirm the meter.' },
  { id: '332', label: '3 + 3 + 2', groups: [3, 3, 2, 3, 3, 2], bar: 8, blurb: 'The tresillo grouping, twice. Same eight-eighth bar, but the middle group of each three starts between beats.' },
  { id: '33334', label: '3 + 3 + 3 + 3 + 4', groups: [3, 3, 3, 3, 4], bar: 8, blurb: 'Groups of three drift across the beat, then a group of four puts things right before the loop restarts.' },
  { id: '3333', label: '3 + 3 + 3 + 3', groups: [3, 3, 3, 3], bar: 6, blurb: 'Groups of three against a beat every two eighths: the hemiola from chapter 2.2, built from accents alone.' },
  { id: '223', label: '2 + 2 + 3', groups: [2, 2, 3, 2, 2, 3], blurb: 'A Balkan-style additive grouping. No steady beat fits it: the beat itself is uneven (short, short, long), so choose "On each group".' },
];

function starts(groups: number[]) {
  const out: number[] = [];
  let p = 0;
  for (const g of groups) {
    out.push(p);
    p += g;
  }
  return out;
}

// ---------- pushed notes ----------

const STEPS2 = 32; // two bars of sixteenths
type TuneNote = { at: number; m: number };
// "Mary Had a Little Lamb", first phrase (public domain): E D C D | E E E—
const TUNE: TuneNote[] = [
  { at: 0, m: 76 },
  { at: 4, m: 74 },
  { at: 8, m: 72 },
  { at: 12, m: 74 },
  { at: 16, m: 76 },
  { at: 20, m: 76 },
  { at: 24, m: 76 },
];
const BASS: TuneNote[] = [
  { at: 0, m: 48 },
  { at: 8, m: 48 },
  { at: 16, m: 48 },
  { at: 24, m: 43 },
];

type PushPreset = { id: string; label: string; push: number[]; blurb: string };
export const PUSH_PRESETS: PushPreset[] = [
  { id: 'square', label: 'On the beat', push: [0, 0, 0, 0, 0, 0, 0], blurb: 'Every note on a beat. Clear, and a little square.' },
  { id: 'pop', label: 'Two pushes', push: [0, 0, 2, 0, 2, 0, 0], blurb: 'The notes on beat 3 and on the next downbeat arrive an eighth early and are held through the beat. Pop singers do this constantly.' },
  { id: 'sixteenth', label: 'Sixteenth pushes', push: [0, 1, 0, 1, 2, 0, 1], blurb: 'Smaller pushes, a sixteenth early: tighter, funkier anticipations.' },
  { id: 'all', label: 'Everything early', push: [2, 2, 2, 2, 2, 2, 2], blurb: 'Every note pushed an eighth. With drums, it is all syncopation. Turn the drums off and it may stop sounding pushed at all.' },
];

/** Metrical weight of a position in a looping two-bar 16th grid (each bar's downbeat strongest). */
const weight = (i: number) => METRIC_WEIGHTS[((i % 16) + 16) % 16];

/**
 * Simplified Longuet-Higgins & Lee: for each note, the strongest position
 * passed in silence before the next onset; if stronger than the note's own
 * position, it's a syncopation worth the difference. Returns the total and
 * the "felt but not played" positions that caused it.
 */
function syncopation(onsets: number[]) {
  const n = STEPS2;
  const on = Array(n).fill(false);
  onsets.forEach((o) => (on[((o % n) + n) % n] = true));
  const idx = on.map((o, i) => (o ? i : -1)).filter((i) => i >= 0);
  let total = 0;
  const silent: number[] = [];
  for (let a = 0; a < idx.length; a++) {
    const i = idx[a];
    const j = idx[(a + 1) % idx.length] + (a + 1 === idx.length ? n : 0);
    let best = -Infinity;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      if (weight(k) > best) {
        best = weight(k);
        at = k % n;
      }
    }
    if (best > weight(i)) {
      total += best - weight(i);
      silent.push(at);
    }
  }
  return { total, silent };
}

function drumHits(feel: Feel, snare: SnareAt): Record<DrumId, number[]> {
  const kick = feel === 'double' ? [0, 4, 8, 12] : feel === 'half' ? [0, 14] : [0, 8, 10];
  const snareAt: Record<Feel, Record<SnareAt, number[]>> = {
    normal: { backbeat: [4, 12], onbeat: [0, 8], off: [] },
    half: { backbeat: [8], onbeat: [0], off: [] },
    double: { backbeat: [2, 6, 10, 14], onbeat: [0, 4, 8, 12], off: [] },
  };
  const hat = feel === 'double' ? Array.from({ length: 16 }, (_, i) => i) : [0, 2, 4, 6, 8, 10, 12, 14];
  return { kick, snare: snareAt[feel][snare], hat, ride: [] };
}

// ---------- component ----------

export default function SyncopationLab(props: {
  initialMode?: Mode;
  /** Restrict to one half; the mode switch is hidden when only one is offered. */
  modes?: Mode[];
  grouping?: string;
  groupings?: string[];
  accent?: AccentKind;
  preset?: string;
  presets?: string[];
  /** Which push-mode controls to show. Default: all. */
  controls?: ('snare' | 'feel' | 'shuffle' | 'drums' | 'tempo')[];
  title?: string;
}) {
  const modes = props.modes ?? ['accents', 'push'];
  const [mode, setMode] = useState<Mode>(props.initialMode ?? modes[0]);
  const controls = props.controls ?? ['snare', 'feel', 'shuffle', 'drums', 'tempo'];

  // accents state
  const offeredG = props.groupings ? GROUPINGS.filter((g) => props.groupings!.includes(g.id)) : GROUPINGS;
  const [gid, setGid] = useState(props.grouping ?? offeredG[0].id);
  const G = GROUPINGS.find((g) => g.id === gid) ?? offeredG[0];
  const [accent, setAccent] = useState<AccentKind>(props.accent ?? 'dynamic');
  const [beatMode, setBeatMode] = useState<BeatMode>('none');

  // push state
  const offeredP = props.presets ? PUSH_PRESETS.filter((p) => props.presets!.includes(p.id)) : PUSH_PRESETS;
  const firstP = PUSH_PRESETS.find((p) => p.id === props.preset) ?? offeredP[0];
  const [pid, setPid] = useState(firstP.id);
  const [push, setPush] = useState<number[]>(firstP.push);
  const [snare, setSnare] = useState<SnareAt>('backbeat');
  const [feel, setFeel] = useState<Feel>('normal');
  const [shuffle, setShuffle] = useState(false);
  const [drums, setDrums] = useState(true);
  const [bpm, setBpm] = useState(100);

  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(-1);

  const live = useRef({ mode, G, accent, beatMode, push, snare, feel, shuffle, drums, bpm });
  live.current = { mode, G, accent, beatMode, push, snare, feel, shuffle, drums, bpm };

  const run = useRef<Run | null>(null);
  const raf = useRef(0);
  const queue = useRef<{ t: number; s: number }[]>([]);

  const stop = useCallback(() => {
    run.current?.stop();
    run.current = null;
    cancelAnimationFrame(raf.current);
    queue.current = [];
    setPlaying(false);
    setNow(-1);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => () => stop(), [stop]);

  const start = () => {
    const r = startRun(0.1, 0.9);
    run.current = r;
    const wave = harmonicWave(r.ctx, 8, 1.4);
    const bassWave = harmonicWave(r.ctx, 6, 1.1);
    queue.current = [];
    let step = 0;
    loop(r, (t) => {
      const L = live.current;
      if (L.mode === 'accents') {
        const n = L.G.groups.reduce((a, b) => a + b, 0);
        const s = step % n;
        step = s + 1;
        const eighth = 30 / L.bpm;
        const st = starts(L.G.groups);
        const isAcc = st.includes(s);
        const k = L.accent;
        const loud = k === 'dynamic' && isAcc;
        const high = k === 'tonal' && isAcc;
        const long = k === 'agogic' ? (isAcc ? 0.95 : 0.3) : 0.45;
        note(r, {
          f: mtof(high ? 83 : 76),
          t,
          dur: eighth * long,
          gain: k === 'dynamic' ? (loud ? 0.5 : 0.13) : 0.22,
          attack: 0.005,
          release: 0.05,
          wave,
        });
        const beatHere =
          L.beatMode === 'steady' ? s % 2 === 0 : L.beatMode === 'groups' ? isAcc : false;
        if (beatHere) {
          const down = s === 0 || (L.beatMode === 'steady' && L.G.bar !== undefined && s % L.G.bar === 0);
          playDrum('kick', t, down ? 0.75 : 0.45, r.bus);
        }
        queue.current.push({ t, s });
        return eighth;
      }
      // push mode: 16th steps over two bars
      const s = step % STEPS2;
      step = s + 1;
      const bs = s % 16;
      const params = { bpm: L.bpm, swing: L.shuffle ? 0.667 : 0.5, swingUnit: '8th' as const };
      const dur = (bs === 15 ? barDuration(L.bpm) : stepTime(bs + 1, params)) - stepTime(bs, params);
      if (L.drums) {
        const hits = drumHits(L.feel, L.snare);
        for (const id of ['kick', 'snare', 'hat'] as DrumId[]) {
          if (hits[id].includes(bs)) playDrum(id, t, id === 'hat' ? (bs % 4 === 0 ? 0.7 : 0.45) : 0.8, r.bus);
        }
        for (const b of BASS) {
          if (b.at === s) note(r, { f: mtof(b.m), t, dur: (60 / L.bpm) * 1.7, gain: 0.2, attack: 0.01, release: 0.12, wave: bassWave });
        }
      }
      const ons = TUNE.map((n, i) => (n.at - L.push[i] + STEPS2) % STEPS2);
      ons.forEach((o, i) => {
        if (o !== s) return;
        const next = ons[(i + 1) % ons.length];
        const len = ((next - o + STEPS2) % STEPS2 || STEPS2) * (15 / L.bpm);
        note(r, { f: mtof(TUNE[i].m), t, dur: Math.min(len * 0.92, 1.6), gain: 0.2, attack: 0.012, release: 0.12, wave });
      });
      queue.current.push({ t, s });
      return dur;
    });
    const frame = () => {
      const tNow = r.ctx.currentTime;
      let s: number | null = null;
      while (queue.current.length && queue.current[0].t <= tNow) s = queue.current.shift()!.s;
      if (s !== null) setNow(s);
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    setPlaying(true);
  };

  const toggle = () => (playing ? stop() : start());

  const switchMode = (m: Mode) => {
    if (playing) stop();
    setMode(m);
  };

  // ----- derived: accents -----
  const n = G.groups.reduce((a, b) => a + b, 0);
  const st = starts(G.groups);
  const onBeat = st.filter((s) => s % 2 === 0).length;

  // ----- derived: push -----
  const onsets = useMemo(() => TUNE.map((t, i) => (t.at - push[i] + STEPS2) % STEPS2), [push]);
  const sync = useMemo(() => syncopation(onsets), [onsets]);
  const pushedCount = push.filter((p) => p > 0).length;
  const cycle = (i: number) => {
    setPush((p) => p.map((v, k) => (k === i ? (v + 1) % 3 : v)));
  };

  const title = props.title ?? (mode === 'accents' ? 'Accents and grouping' : 'Pushing the beat');

  return (
    <Widget
      title={title}
      kicker="Lab"
      caption={
        mode === 'accents' ? (
          <>
            One tone, repeated in even eighth notes. Accents (circled, and drawn the way they sound: bigger, longer, or higher) mark the start of each group; the brackets show the groups. With a beat on, the drum ticks show where it falls: a group that starts on a tick confirms the meter, one that starts between ticks cuts across it. The <em>longer</em> accent here is made by holding the accented tone and clipping the others, so the onsets stay perfectly even.
          </>
        ) : (
          <>
            The first phrase of "Mary Had a Little Lamb" over a drum loop, on a grid of sixteenth notes (two bars). Click a note to push it ahead of its beat: once for a sixteenth early, twice for an eighth, a third time to put it back. A dashed line and arrow show the beat a pushed note came from; red rings mark strong positions that pass in silence because a note arrived early and is held through them. The score is the simplified Longuet-Higgins and Lee measure from chapter 2.5, applied to the tune only.
          </>
        )
      }
    >
      <div className="w-controls">
        <PlayButton playing={playing} onClick={toggle} />
        {modes.length > 1 && (
          <Segmented
            label="Lab"
            value={mode}
            options={[
              { value: 'accents', label: 'Accents' },
              { value: 'push', label: 'Pushed notes' },
            ]}
            onChange={switchMode}
          />
        )}
      </div>

      {mode === 'accents' ? (
        <>
          <div className="w-controls">
            <Segmented label="Groups" value={gid} options={offeredG.map((g) => ({ value: g.id, label: g.label }))} onChange={setGid} />
          </div>
          <div className="w-controls">
            <Segmented
              label="Accent"
              value={accent}
              options={[
                { value: 'none', label: 'None' },
                { value: 'dynamic', label: 'Louder' },
                { value: 'agogic', label: 'Longer' },
                { value: 'tonal', label: 'Higher' },
              ]}
              onChange={setAccent}
            />
            <Segmented
              label="Beat"
              value={beatMode}
              options={[
                { value: 'none', label: 'Off' },
                { value: 'steady', label: 'Steady' },
                { value: 'groups', label: 'On each group' },
              ]}
              onChange={setBeatMode}
            />
          </div>
          <p className="w-note">{G.blurb}</p>
          <AccentGrid groups={G.groups} accent={accent} beatMode={beatMode} bar={G.bar} now={now} />
          <div className="w-controls">
            <Slider label="Tempo" min={50} max={150} step={1} value={bpm} onChange={setBpm} display={`${bpm} beats per minute`} />
          </div>
          <div className="w-readouts">
            <Readout label="Groups starting on a steady beat">
              {onBeat} of {st.length}
            </Readout>
            <Readout label="Loop">{n} eighth notes</Readout>
          </div>
        </>
      ) : (
        <>
          {offeredP.length > 1 && (
          <div className="w-controls">
            <Segmented
              label="Tune"
              value={pid}
              options={offeredP.map((p) => ({ value: p.id, label: p.label }))}
              onChange={(id) => {
                setPid(id);
                setPush(PUSH_PRESETS.find((p) => p.id === id)!.push);
              }}
            />
          </div>
          )}
          <div className="w-controls">
            {controls.includes('snare') && (
              <Segmented
                label="Snare"
                value={snare}
                options={[
                  { value: 'backbeat', label: feel === 'half' ? 'Beat 3' : feel === 'double' ? 'Every "&"' : '2 and 4' },
                  { value: 'onbeat', label: feel === 'half' ? 'Beat 1' : feel === 'double' ? 'Every beat' : '1 and 3' },
                  { value: 'off', label: 'Off' },
                ]}
                onChange={setSnare}
              />
            )}
            {controls.includes('feel') && (
              <Segmented
                label="Feel"
                value={feel}
                options={[
                  { value: 'half', label: 'Half-time' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'double', label: 'Double-time' },
                ]}
                onChange={setFeel}
              />
            )}
          </div>
          <div className="w-controls">
            {controls.includes('shuffle') && (
              <Segmented
                label="Eighths"
                value={shuffle ? 'swung' : 'straight'}
                options={[
                  { value: 'straight', label: 'Straight' },
                  { value: 'swung', label: 'Shuffle' },
                ]}
                onChange={(v) => setShuffle(v === 'swung')}
              />
            )}
            {controls.includes('drums') && (
              <Segmented
                label="Drums and bass"
                value={drums ? 'on' : 'off'}
                options={[
                  { value: 'on', label: 'On' },
                  { value: 'off', label: 'Off' },
                ]}
                onChange={(v) => setDrums(v === 'on')}
              />
            )}
          </div>
          <p className="w-note">{PUSH_PRESETS.find((p) => p.id === pid)?.blurb}</p>
          <PushGrid push={push} onsets={onsets} silent={sync.silent} hits={drums ? drumHits(feel, snare) : null} shuffle={shuffle} now={now} onNote={cycle} />
          {controls.includes('tempo') && (
            <div className="w-controls">
              <Slider label="Tempo" min={60} max={140} step={1} value={bpm} onChange={setBpm} display={`${bpm} beats per minute`} />
            </div>
          )}
          <div className="w-readouts">
            <Readout label="Syncopation score">{sync.total}</Readout>
            <Readout label="Pushed notes">
              {pushedCount} of {TUNE.length}
            </Readout>
          </div>
        </>
      )}
    </Widget>
  );
}

// ---------- drawings ----------

function AccentGrid(props: { groups: number[]; accent: AccentKind; beatMode: BeatMode; bar?: number; now: number }) {
  const { groups, accent, beatMode, bar, now } = props;
  const n = groups.reduce((a, b) => a + b, 0);
  const st = starts(groups);
  const W = 680;
  const X0 = 20;
  const cw = (W - 2 * X0) / n;
  const cx = (i: number) => r2(X0 + (i + 0.5) * cw);
  const H = 176;
  const yBeat = 30;
  const yTone = 92;
  const yBr = 140;
  const beats = Array.from({ length: n }, (_, i) =>
    beatMode === 'steady' ? i % 2 === 0 : beatMode === 'groups' ? st.includes(i) : false,
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="An even stream of tones with accents marking groups, and the beat above">
      <text x={X0} y={14} className="w-tick">
        beat
      </text>
      {Array.from({ length: n }, (_, i) => {
        const acc = st.includes(i) && accent !== 'none';
        const isNow = now === i;
        const down = i === 0 || (beatMode === 'steady' && bar !== undefined && i % bar === 0);
        const rx = accent === 'agogic' ? (acc ? cw * 0.42 : cw * 0.14) : acc && accent === 'dynamic' ? 11 : 7;
        const y = accent === 'tonal' && acc ? yTone - 22 : yTone;
        return (
          <g key={i}>
            <rect x={r2(X0 + i * cw + 1)} y={22} width={r2(cw - 2)} height={H - 50} rx={4} className={isNow ? 'meter-now' : 'meter-cell'} />
            {beats[i] && <circle cx={cx(i)} cy={yBeat} r={down ? 7 : 5} className="fill-ink" />}
            {!beats[i] && beatMode !== 'none' && <circle cx={cx(i)} cy={yBeat} r={1.5} className="fill-ink" opacity={0.25} />}
            {accent === 'agogic' ? (
              <rect x={r2(X0 + i * cw + cw * 0.5 - (acc ? cw * 0.06 : rx))} y={y - 6} width={r2(acc ? cw * 0.9 : rx * 2)} height={12} rx={6} className="tone-a" />
            ) : (
              <circle cx={cx(i)} cy={y} r={rx} className="tone-a" />
            )}
            {acc && <circle cx={cx(i)} cy={y} r={accent === 'dynamic' ? 16 : 12} className="stroke-ink" fill="none" />}
          </g>
        );
      })}
      {st.map((s, k) => {
        const x0 = X0 + s * cw + 4;
        const x1 = X0 + (s + groups[k]) * cw - 4;
        return (
          <g key={k}>
            <path d={`M${r2(x0)},${yBr - 8} L${r2(x0)},${yBr} L${r2(x1)},${yBr} L${r2(x1)},${yBr - 8}`} className="stroke-ink" />
            <text x={r2((x0 + x1) / 2)} y={yBr + 16} textAnchor="middle" className="w-tick">
              {groups[k]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const COUNT = ['1', 'e', '&', 'a', '2', 'e', '&', 'a', '3', 'e', '&', 'a', '4', 'e', '&', 'a'];

function PushGrid(props: {
  push: number[];
  onsets: number[];
  silent: number[];
  hits: Record<DrumId, number[]> | null;
  shuffle: boolean;
  now: number;
  onNote: (i: number) => void;
}) {
  const { push, onsets, silent, hits, now } = props;
  const W = 680;
  const X0 = 50;
  const cw = (W - X0 - 10) / STEPS2;
  const x = (i: number) => r2(X0 + i * cw);
  const H = 214;
  const rowY: Record<string, number> = { hat: 44, snare: 60, kick: 76 };
  const pitchY = (m: number) => r2(178 - (m - 70) * 9);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot is-clickable" role="img" aria-label="Two bars of drums and a tune on a sixteenth-note grid; pushed notes start before their beats">
      {Array.from({ length: STEPS2 }, (_, i) => {
        const strong = i % 4 === 0;
        return (
          <g key={i}>
            <rect x={x(i) + 0.5} y={20} width={r2(cw - 1)} height={H - 26} rx={3} className={now === i ? 'meter-now' : 'meter-cell'} />
            <line x1={x(i)} x2={x(i)} y1={20} y2={H - 6} className="stroke-grid" opacity={strong ? (i % 16 === 0 ? 1 : 0.8) : 0.3} strokeWidth={i % 16 === 0 ? 2 : 1} />
            <text x={r2(x(i) + cw / 2)} y={14} textAnchor="middle" className="w-tick" fontWeight={strong ? 700 : 400} opacity={strong ? 1 : 0.6}>
              {COUNT[i % 16]}
            </text>
          </g>
        );
      })}
      {hits &&
        (['hat', 'snare', 'kick'] as DrumId[]).map((id) => (
          <g key={id}>
            <text x={4} y={rowY[id] + 4} className="w-tick">
              {id === 'hat' ? 'hi-hat' : id}
            </text>
            {[0, 16].flatMap((b) =>
              hits[id].map((s) => <circle key={`${id}${b}${s}`} cx={r2(x(b + s) + cw / 2)} cy={rowY[id]} r={id === 'hat' ? 2.5 : 4.5} className={id === 'snare' ? 'tone-b' : 'fill-ink'} />),
            )}
          </g>
        ))}
      {!hits && (
        <text x={4} y={64} className="w-tick">
          no drums: nothing marks the beat
        </text>
      )}
      <text x={4} y={pitchY(74) + 4} className="w-tick">
        tune
      </text>
      {silent.map((s) => (
        <circle key={`sil${s}`} cx={r2(x(s) + cw / 2)} cy={98} r={6} fill="none" className="stroke-rough" />
      ))}
      {onsets.map((o, i) => {
        const next = onsets[(i + 1) % onsets.length];
        const len = (next - o + STEPS2) % STEPS2 || STEPS2;
        const y = pitchY(TUNE[i].m);
        const home = TUNE[i].at;
        const segs: [number, number][] = o + len <= STEPS2 ? [[o, len]] : [[o, STEPS2 - o], [0, o + len - STEPS2]];
        return (
          <g key={i} onClick={() => props.onNote(i)} style={{ cursor: 'pointer' }}>
            {push[i] > 0 && (
              <g opacity={0.75}>
                <line x1={x(home)} x2={x(home)} y1={y - 12} y2={y + 14} className="stroke-ink" strokeDasharray="2 2" />
                <path d={`M${x(home) - 1},${y + 13} L${r2(x(o < home ? o : o - STEPS2) + 4)},${y + 13}`} className="stroke-ink" />
                <path d={`M${r2(x(o < home ? o : o - STEPS2) + 8)},${y + 10} L${r2(x(o < home ? o : o - STEPS2) + 3)},${y + 13} L${r2(x(o < home ? o : o - STEPS2) + 8)},${y + 16}`} className="stroke-ink" />
              </g>
            )}
            {segs.map(([s, l], k) => (
              <rect key={k} x={r2(x(s) + 1)} y={y - 6} width={r2(l * cw - 2)} height={12} rx={4} className={push[i] > 0 ? 'tone-b' : 'tone-a'} opacity={0.9} />
            ))}
            <rect x={r2(x(Math.min(o, home)))} y={y - 12} width={r2(cw * (Math.abs(home - o) + 3))} height={24} fill="transparent" />
          </g>
        );
      })}
    </svg>
  );
}

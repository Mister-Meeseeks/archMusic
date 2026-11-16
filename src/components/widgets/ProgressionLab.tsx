// Chord progressions in C major, colored by harmonic function, with the path
// their roots take around the circle of fifths. Build a progression from
// Roman-numeral buttons (or pick a preset), hear it voiced with smooth voice
// leading (the same search as VoicingLab, src/lib/harmony.ts), and read off
// the root motions and how the progression ends (its cadence).
//
// Functions follow the usual textbook grouping: tonic (I, vi, iii), predominant
// (IV, ii), dominant (V, V7, vii°), plus secondary dominants (V of something
// other than I) and chords borrowed from C minor or Mixolydian.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { leadVoices, type ChordSpec, type Quality } from '../../lib/harmony';
import { harmonicWave, note, startRun, type Run } from '../../lib/sequence';
import { midiToHz } from '../../lib/tuning';
import { PlayButton, Readout, Slider, Widget, r2, useAudioOwner } from './ui';

type Fn = 'T' | 'PD' | 'D' | 'X' | 'B';
type PChord = { id: string; roman: string; symbol: string; rootName: string; rootPc: number; q: Quality; fn: Fn; target?: string };

const C = (id: string, roman: string, symbol: string, rootName: string, rootPc: number, q: Quality, fn: Fn, target?: string): PChord => ({
  id,
  roman,
  symbol,
  rootName,
  rootPc,
  q,
  fn,
  target,
});

const CHORDS: PChord[] = [
  C('I', 'I', 'C', 'C', 0, 'maj', 'T'),
  C('vi', 'vi', 'Am', 'A', 9, 'min', 'T'),
  C('iii', 'iii', 'Em', 'E', 4, 'min', 'T'),
  C('IV', 'IV', 'F', 'F', 5, 'maj', 'PD'),
  C('ii', 'ii', 'Dm', 'D', 2, 'min', 'PD'),
  C('ii7', 'ii7', 'Dm7', 'D', 2, 'm7', 'PD'),
  C('V', 'V', 'G', 'G', 7, 'maj', 'D'),
  C('V7', 'V7', 'G7', 'G', 7, '7', 'D'),
  C('vii', 'vii°', 'B°', 'B', 11, 'dim', 'D'),
  C('V/V', 'V7/V', 'D7', 'D', 2, '7', 'X', 'V'),
  C('V/vi', 'V7/vi', 'E7', 'E', 4, '7', 'X', 'vi'),
  C('V/ii', 'V7/ii', 'A7', 'A', 9, '7', 'X', 'ii'),
  C('V/IV', 'V7/IV', 'C7', 'C', 0, '7', 'X', 'IV'),
  C('bVII', '♭VII', 'B♭', 'B♭', 10, 'maj', 'B'),
  C('bVI', '♭VI', 'A♭', 'A♭', 8, 'maj', 'B'),
  C('iv', 'iv', 'Fm', 'F', 5, 'min', 'B'),
];
const BY_ID = new Map(CHORDS.map((c) => [c.id, c]));

const FN_LABEL: Record<Fn, string> = { T: 'Tonic', PD: 'Predominant', D: 'Dominant', X: 'Secondary dominant', B: 'Borrowed' };
const FN_SHORT: Record<Fn, string> = { T: 'T', PD: 'PD', D: 'D', X: 'V/x', B: '♭' };
const GROUPS: { fn: Fn; ids: string[] }[] = [
  { fn: 'T', ids: ['I', 'vi', 'iii'] },
  { fn: 'PD', ids: ['IV', 'ii', 'ii7'] },
  { fn: 'D', ids: ['V', 'V7', 'vii'] },
  { fn: 'X', ids: ['V/V', 'V/vi', 'V/ii', 'V/IV'] },
  { fn: 'B', ids: ['bVII', 'bVI', 'iv'] },
];

export const PRESETS: Record<string, { label: string; chords: string[]; note: string }> = {
  phrase: { label: 'I IV V7 I', chords: ['I', 'IV', 'V7', 'I'], note: 'The basic phrase: tonic, predominant, dominant, tonic' },
  turnaround: { label: 'I vi ii V7 I', chords: ['I', 'vi', 'ii7', 'V7', 'I'], note: 'From vi on, every root falls a fifth: A, D, G, C' },
  circle: { label: 'Round the circle', chords: ['I', 'IV', 'vii', 'iii', 'vi', 'ii', 'V7', 'I'], note: 'Every root falls a fifth (F to B is the one diminished fifth), all the way home' },
  half: { label: 'Half cadence', chords: ['I', 'vi', 'IV', 'V'], note: 'Stopping on the dominant: a comma, not a full stop' },
  deceptive: { label: 'Deceptive', chords: ['I', 'IV', 'V7', 'vi'], note: 'The dominant goes to vi instead of I: the expected home is swapped for a near neighbor' },
  plagal: { label: 'Plagal (Amen)', chords: ['I', 'IV', 'I', 'IV', 'I'], note: 'IV to I: the gentler "Amen" ending at the end of hymns' },
  secondary: { label: 'Secondary dominants', chords: ['I', 'V/vi', 'vi', 'V/V', 'V7', 'I'], note: 'E7 points at A minor, D7 points at G: each a dominant of a chord other than I' },
  ragtime: { label: 'Ragtime chain', chords: ['V/vi', 'V/ii', 'V/V', 'V7', 'I'], note: 'A chain of dominant sevenths, each one the dominant of the next: E7, A7, D7, G7, C' },
  rock: { label: 'I ♭VII IV I', chords: ['I', 'bVII', 'IV', 'I'], note: 'The rock (Mixolydian) cadence: no dominant and no leading tone, just roots falling by fourths into home' },
  axis: { label: 'I V vi IV loop', chords: ['I', 'V', 'vi', 'IV', 'I', 'V', 'vi', 'IV'], note: 'The pop loop. The V usually goes to vi, not I, and IV goes back to I: function is softened' },
  backwards: { label: 'I V IV I', chords: ['I', 'V', 'IV', 'I'], note: 'Dominant to predominant: "backwards" in classical terms, everyday in rock and blues' },
  minor: { label: 'Borrowed from minor', chords: ['I', 'IV', 'iv', 'I'], note: 'IV turning into iv: the A in F major sinks to A♭, a borrowed, bittersweet color' },
};

const DEFAULT_PRESETS = ['phrase', 'turnaround', 'circle', 'half', 'deceptive', 'plagal', 'secondary', 'ragtime', 'rock', 'axis', 'backwards', 'minor'];
const MAX = 8;

// circle of fifths: C at the top, clockwise in rising fifths
const CIRCLE = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const CIRCLE_NAMES = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'D♭', 'A♭', 'E♭', 'B♭', 'F'];
const CX = 130;
const CY = 128;
const RAD = 92;
const pos = (pc: number, rad = RAD) => {
  const i = CIRCLE.indexOf(pc);
  const a = -Math.PI / 2 + (i * Math.PI) / 6;
  return { x: r2(CX + rad * Math.cos(a)), y: r2(CY + rad * Math.sin(a)) };
};

function motionKind(a: number, b: number): 'fall5' | 'rise5' | 'step' | 'third' | 'same' | 'tritone' {
  const d = (b - a + 12) % 12;
  if (d === 0) return 'same';
  if (d === 5) return 'fall5';
  if (d === 7) return 'rise5';
  if (d === 6) return 'tritone';
  if (d === 1 || d === 2 || d === 10 || d === 11) return 'step';
  return 'third';
}

function cadenceOf(seq: PChord[]): { name: string; note: string } {
  if (seq.length < 2) return { name: '—', note: '' };
  const a = seq[seq.length - 2];
  const b = seq[seq.length - 1];
  if (b.fn === 'D') return { name: 'Half cadence', note: 'ends on the dominant: open, a question' };
  if (a.fn === 'D' && b.id === 'I') return { name: 'Authentic cadence', note: 'dominant to tonic: a full stop' };
  if (a.fn === 'D' && b.id === 'vi') return { name: 'Deceptive cadence', note: 'dominant to vi: home swapped for a neighbor' };
  if ((a.id === 'IV' || a.id === 'iv') && b.id === 'I') return { name: 'Plagal cadence', note: 'IV to I: the "Amen" ending' };
  if (a.id === 'bVII' && b.id === 'I') return { name: '♭VII–I', note: 'the rock cadence: home without a dominant' };
  if (b.id === 'I') return { name: 'Ends at home', note: 'but not by a standard cadence' };
  return { name: 'No cadence', note: 'ends away from home' };
}

export default function ProgressionLab(props: { preset?: string; presets?: string[]; build?: boolean; title?: string }) {
  const presetKeys = props.presets ?? DEFAULT_PRESETS;
  const build = props.build ?? true;
  const [preset, setPreset] = useState<string>(props.preset ?? presetKeys[0]);
  const [ids, setIds] = useState<string[]>(PRESETS[props.preset ?? presetKeys[0]].chords);
  const [secs, setSecs] = useState(1.1);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const run = useRef<Run | null>(null);
  const timers = useRef<number[]>([]);

  const stop = useCallback(() => {
    run.current?.stop(0.2);
    run.current = null;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPlaying(false);
    setNow(null);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => stop, [stop]);

  const seq = useMemo(() => ids.map((id) => BY_ID.get(id)!), [ids]);
  const specs: ChordSpec[] = useMemo(() => seq.map((c) => ({ rootPc: c.rootPc, q: c.q, symbol: c.symbol, roman: c.roman, rootName: c.rootName })), [seq]);
  const voices = useMemo(() => (specs.length ? leadVoices(specs, { style: 'smooth', bass: 'root' }) : []), [specs]);

  const choosePreset = (k: string) => {
    stop();
    setPreset(k);
    setIds(PRESETS[k].chords);
  };
  const edit = (next: string[]) => {
    stop();
    setPreset('custom');
    setIds(next);
  };

  const play = () => {
    if (playing) return stop();
    if (!voices.length) return;
    const r = startRun(0.1);
    run.current = r;
    const wave = harmonicWave(r.ctx, 10, 1.5);
    const lead = (r.t0 - r.ctx.currentTime) * 1000;
    voices.forEach((ch, i) => {
      const last = i === voices.length - 1;
      const t = i * secs;
      const dur = last ? secs * 1.6 : secs - 0.05;
      ch.forEach((m, k) => {
        note(r, { f: midiToHz(m), t: r.t0 + t, dur, gain: k === 0 ? 0.17 : 0.12, attack: 0.03, release: last ? 1 : 0.12, wave });
      });
      timers.current.push(window.setTimeout(() => setNow(i), lead + t * 1000));
    });
    timers.current.push(
      window.setTimeout(() => {
        run.current = null;
        setPlaying(false);
        setNow(null);
      }, lead + (voices.length * secs + secs * 1.6 + 1) * 1000),
    );
    setPlaying(true);
  };

  // root motions
  const moves = seq.slice(1).map((c, i) => motionKind(seq[i].rootPc, c.rootPc));
  const count = (k: string) => moves.filter((m) => m === k).length;
  const cad = cadenceOf(seq);
  const resolved = seq.map((c, i) => (c.target ? seq[i + 1]?.id === c.target || (c.target === 'V' && seq[i + 1]?.id === 'V7') : null));

  // circle path, skipping repeated roots
  const path: { a: number; b: number; i: number }[] = [];
  seq.forEach((c, i) => {
    if (i && seq[i - 1].rootPc !== c.rootPc) path.push({ a: seq[i - 1].rootPc, b: c.rootPc, i });
  });
  const usedFn = new Map<number, Fn>();
  seq.forEach((c) => usedFn.set(c.rootPc, usedFn.get(c.rootPc) ?? c.fn));
  const current = now !== null ? seq[now] : null;

  const caption = (
    <>
      {preset !== 'custom' && PRESETS[preset] ? <>{PRESETS[preset].note}. </> : null}
      Each chord is colored by its function: <span className="pl-k pl-T">tonic</span>,{' '}
      <span className="pl-k pl-PD">predominant</span>, <span className="pl-k pl-D">dominant</span>,{' '}
      <span className="pl-k pl-X">secondary dominant</span>, <span className="pl-k pl-B">borrowed</span>. The circle
      shows the twelve roots a fifth apart, with the seven chords of C major on the shaded arc. Arrows trace the
      progression's roots: a short counterclockwise step is a root <strong>falling a fifth</strong>, the commonest move
      in tonal harmony. The four voices are arranged by the same smooth voice-leading search as the voicing lab.
      {build ? ' Click chords below to build your own (up to eight).' : ''}
    </>
  );

  return (
    <Widget kicker="Lab" title={props.title ?? 'Chord progressions and function'} caption={caption}>
      <div className="w-controls">
        <PlayButton playing={playing} onClick={play} />
        <Slider label="Seconds per chord" value={secs} min={0.5} max={2} step={0.1} onChange={setSecs} display={secs.toFixed(1)} />
      </div>
      <div className="w-chips pl-presets" role="group" aria-label="Presets">
        {presetKeys.map((k) => (
          <button type="button" key={k} className={'w-chip' + (preset === k ? ' is-on' : '')} onClick={() => choosePreset(k)}>
            {PRESETS[k].label}
          </button>
        ))}
      </div>

      <div className="pl-strip" aria-label="The progression">
        {seq.map((c, i) => (
          <div key={i} className={`pl-card pl-${c.fn}` + (now === i ? ' is-now' : '')}>
            <span className="pl-fn">{c.fn === 'X' ? 'sec. dom.' : FN_LABEL[c.fn].toLowerCase()}</span>
            <span className="pl-roman">{c.roman}</span>
            <span className="pl-sym">{c.symbol}</span>
            {c.target && <span className={'pl-to' + (resolved[i] ? ' is-ok' : '')}>→ {BY_ID.get(c.target)!.roman}</span>}
          </div>
        ))}
        {!seq.length && <div className="pl-empty muted">Click chords below to start a progression.</div>}
      </div>

      <div className="pl-main">
        <svg viewBox="0 0 260 256" className="w-plot pl-circle" role="img" aria-label="Circle of fifths with the progression's root motion">
          <defs>
            <marker id="pl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="pl-head" />
            </marker>
          </defs>
          {/* the key's seven roots: F C G D A E B, i.e. circle positions 11, 0..5 */}
          <path
            d={(() => {
              const a0 = -Math.PI / 2 + (-1.5 * Math.PI) / 6;
              const a1 = -Math.PI / 2 + (5.5 * Math.PI) / 6;
              const ro = RAD + 16;
              const ri = RAD - 16;
              const p = (rr: number, a: number) => `${r2(CX + rr * Math.cos(a))},${r2(CY + rr * Math.sin(a))}`;
              return `M${p(ro, a0)} A${ro},${ro} 0 1 1 ${p(ro, a1)} L${p(ri, a1)} A${ri},${ri} 0 1 0 ${p(ri, a0)} Z`;
            })()}
            className="pl-arc"
          />
          <text x={CX} y={CY + RAD + 30} textAnchor="middle" className="w-tick">
            shaded: roots of the chords of C major
          </text>
          {path.map((s, k) => {
            const a = pos(s.a, RAD - 14);
            const b = pos(s.b, RAD - 14);
            const isNow = now === s.i;
            const kind = motionKind(s.a, s.b);
            // bend each line a little toward the center so back-and-forth moves don't overlap
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            const qx = r2(mx + (CX - mx) * 0.25);
            const qy = r2(my + (CY - my) * 0.25);
            return (
              <path
                key={k}
                d={`M${a.x},${a.y} Q${qx},${qy} ${b.x},${b.y}`}
                className={'pl-move' + (kind === 'fall5' ? ' is-fall' : '') + (isNow ? ' is-now' : '')}
                markerEnd="url(#pl-arrow)"
              />
            );
          })}
          {CIRCLE.map((pc, i) => {
            const p = pos(pc);
            const fn = usedFn.get(pc);
            const isNow = current?.rootPc === pc;
            return (
              <g key={pc}>
                <circle cx={p.x} cy={p.y} r={isNow ? 13 : 11} className={'pl-node' + (fn ? ` pl-fill-${fn}` : '') + (isNow ? ' is-now' : '')} />
                <text x={p.x} y={p.y + 4} textAnchor="middle" className={'pl-node-t' + (fn ? ' is-used' : '')}>
                  {CIRCLE_NAMES[i]}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="w-readouts pl-readouts">
          <Readout label="Ending">
            {cad.name} {cad.note && <span className="muted">({cad.note})</span>}
          </Readout>
          <Readout label="Functions">{seq.map((c) => FN_SHORT[c.fn]).join(' → ') || '—'}</Readout>
          <Readout label="Root falls a fifth">
            <span className="key-match">{count('fall5')}</span> of {moves.length} moves
            {count('tritone') ? <span className="muted"> (+{count('tritone')} diminished fifth)</span> : null}
          </Readout>
          <Readout label="Other moves">
            {count('rise5')} up a fifth (clockwise) · {count('step')} by step · {count('third')} by a third
          </Readout>
        </div>
      </div>

      {build && (
        <div className="pl-palette">
          {GROUPS.map((g) => (
            <div key={g.fn} className="pl-group">
              <span className={`pl-glabel pl-k pl-${g.fn}`}>{FN_LABEL[g.fn]}</span>
              <div className="pl-gbtns">
                {g.ids.map((id) => {
                  const c = BY_ID.get(id)!;
                  return (
                    <button type="button" key={id} className={`pl-btn pl-${c.fn}`} disabled={ids.length >= MAX} onClick={() => edit([...ids, id])}>
                      <span className="pl-roman">{c.roman}</span>
                      <span className="pl-sym">{c.symbol}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="pl-group">
            <span className="pl-glabel">Edit</span>
            <div className="pl-gbtns">
              <button type="button" className="w-chip" disabled={!ids.length} onClick={() => edit(ids.slice(0, -1))}>
                Undo
              </button>
              <button type="button" className="w-chip" disabled={!ids.length} onClick={() => edit([])}>
                Clear
              </button>
              {ids.length >= MAX && <span className="muted pl-full">Full: undo or clear to add more.</span>}
            </div>
          </div>
        </div>
      )}
    </Widget>
  );
}

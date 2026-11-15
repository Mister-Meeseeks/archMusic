// Harmonic tension and release in C major. Play a short progression and
// choose how it ends: home (G7 → C), a fake-out (G7 → Am), or hanging on the
// dominant. Each chord's roughness (the chapter 1.5 model) is shown beneath it,
// to make the point that "pull" toward home is not the same thing as roughness.
// A second mode plays the *same* C major chord at the end of two different
// contexts: home in C, away from home in G.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chordRoughness, harmonic } from '../../lib/dissonance';
import { harmonicWave, note, startRun, type Run } from '../../lib/sequence';
import { midiToHz } from '../../lib/tuning';
import { PlayButton, Segmented, Slider, Widget, r2, useAudioOwner } from './ui';

type Chord = { id: string; name: string; notes: number[]; spell: string; role?: string };

const CH: Record<string, Chord> = {
  C: { id: 'C', name: 'C', notes: [48, 60, 64, 67], spell: 'C E G', role: 'home' },
  F: { id: 'F', name: 'F', notes: [53, 60, 65, 69], spell: 'F A C' },
  G: { id: 'G', name: 'G', notes: [43, 59, 62, 67], spell: 'G B D', role: 'dominant' },
  G7: { id: 'G7', name: 'G7', notes: [43, 59, 65, 67], spell: 'G B D F', role: 'dominant' },
  Gsus: { id: 'Gsus', name: 'Gsus4', notes: [43, 60, 62, 67], spell: 'G C D' },
  Am: { id: 'Am', name: 'Am', notes: [45, 60, 64, 69], spell: 'A C E' },
  // for the G-major context
  Gh: { id: 'Gh', name: 'G', notes: [43, 59, 62, 67], spell: 'G B D', role: 'home' },
  D7: { id: 'D7', name: 'D7', notes: [50, 57, 60, 66], spell: 'D F♯ A C', role: 'dominant' },
  Cx: { id: 'Cx', name: 'C', notes: [48, 60, 64, 67], spell: 'C E G' },
  Calone: { id: 'Calone', name: 'C', notes: [48, 60, 64, 67], spell: 'C E G' },
};

type Ending = 'home' | 'fake' | 'hang';
type Mode = 'endings' | 'context';
type Context = 'inC' | 'inG' | 'alone';
type Step = { chord: Chord; beats: number };

const BPM = 84;
const SPEC = harmonic(8, 0.85);
const ROUGH_MAX = Math.max(...Object.values(CH).map((c) => chordRoughness(SPEC, c.notes.map(midiToHz))));

export default function CadenceLab({ initialMode = 'endings' as Mode }: { initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [ending, setEnding] = useState<Ending>('home');
  const [seventh, setSeventh] = useState(true);
  const [sus, setSus] = useState(false);
  const [hold, setHold] = useState(2);
  const [ctxSel, setCtxSel] = useState<Context>('inC');
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const run = useRef<Run | null>(null);
  const timers = useRef<number[]>([]);

  const steps: Step[] = useMemo(() => {
    if (mode === 'context') {
      if (ctxSel === 'inC') return [{ chord: CH.C, beats: 2 }, { chord: CH.F, beats: 2 }, { chord: CH.G7, beats: 2 }, { chord: CH.C, beats: 4 }];
      if (ctxSel === 'inG') return [{ chord: CH.Gh, beats: 2 }, { chord: CH.D7, beats: 2 }, { chord: CH.Gh, beats: 2 }, { chord: CH.Cx, beats: 4 }];
      return [{ chord: CH.Calone, beats: 4 }];
    }
    const dom = seventh ? CH.G7 : CH.G;
    const s: Step[] = [{ chord: CH.C, beats: 2 }, { chord: CH.F, beats: 2 }];
    if (sus) s.push({ chord: CH.Gsus, beats: 2 });
    s.push({ chord: dom, beats: hold });
    if (ending === 'home') s.push({ chord: CH.C, beats: 4 });
    if (ending === 'fake') s.push({ chord: CH.Am, beats: 4 });
    return s;
  }, [mode, ending, seventh, sus, hold, ctxSel]);

  const stop = useCallback(() => {
    run.current?.stop(0.25);
    run.current = null;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPlaying(false);
    setNow(null);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => stop, [mode, stop]);

  const play = () => {
    if (playing) return stop();
    const r = startRun(0.12);
    run.current = r;
    const beat = 60 / BPM;
    const wave = harmonicWave(r.ctx, 10, 1.6);
    let b = 0;
    const lead = (r.t0 - r.ctx.currentTime) * 1000;
    steps.forEach((st, i) => {
      const t = r.t0 + b * beat;
      const dur = st.beats * beat - 0.04;
      const last = i === steps.length - 1;
      st.chord.notes.forEach((m, k) =>
        note(r, { f: midiToHz(m), t, dur: last ? dur * 0.85 : dur, gain: k === 0 ? 0.2 : 0.15, attack: 0.03, release: last ? 1.2 : 0.12, wave }),
      );
      timers.current.push(window.setTimeout(() => setNow(i), lead + b * beat * 1000));
      b += st.beats;
    });
    timers.current.push(
      window.setTimeout(() => {
        run.current = null;
        setPlaying(false);
        setNow(null);
      }, lead + (b * beat + 1.2) * 1000),
    );
    setPlaying(true);
  };

  // ---- layout ----
  const W = 680;
  const totalBeats = steps.reduce((s, x) => s + x.beats, 0);
  const pxPerBeat = Math.min(60, (W - 20) / Math.max(totalBeats, 10));
  let x = 10;

  return (
    <Widget
      kicker="Lab"
      title={mode === 'endings' ? 'Home, away, and the fake-out' : 'Same chord, different meaning'}
      caption={
        mode === 'endings' ? (
          <>
            A progression in C major: C (home), F, then the <strong>dominant</strong> G or G7, and an ending of your
            choice. Box widths show how long each chord lasts. The bars under each chord are its{' '}
            <strong>roughness</strong>, computed with the model from chapter 1.5: notice that the pull toward home is not
            the same as roughness.
          </>
        ) : (
          <>
            All three end on <strong>exactly the same C major chord</strong>: same notes, same register, same sound. Only
            what comes before it differs. In C it sounds finished. After a passage in G it sounds like a step away from
            home.
          </>
        )
      }
    >
      <div className="w-controls">
        <PlayButton playing={playing} onClick={play} />
        <Segmented
          label="Lab"
          value={mode}
          options={[
            { value: 'endings', label: 'Endings' },
            { value: 'context', label: 'Context' },
          ]}
          onChange={setMode}
        />
      </div>
      {mode === 'endings' ? (
        <div className="w-controls">
          <Segmented
            label="Ending"
            value={ending}
            options={[
              { value: 'home', label: '→ C (home)' },
              { value: 'fake', label: '→ Am (fake-out)' },
              { value: 'hang', label: 'Stop on G' },
            ]}
            onChange={setEnding}
          />
          <button type="button" className={'w-chip' + (seventh ? ' is-on' : '')} aria-pressed={seventh} onClick={() => setSeventh((s) => !s)}>
            Add the seventh (G7)
          </button>
          <button type="button" className={'w-chip' + (sus ? ' is-on' : '')} aria-pressed={sus} onClick={() => setSus((s) => !s)}>
            Delay with Gsus4
          </button>
        </div>
      ) : (
        <div className="w-controls">
          <Segmented
            label="Context"
            value={ctxSel}
            options={[
              { value: 'inC', label: 'In C' },
              { value: 'inG', label: 'In G' },
              { value: 'alone', label: 'C alone' },
            ]}
            onChange={setCtxSel}
          />
        </div>
      )}

      <svg viewBox={`0 0 ${W} 112`} className="w-plot" role="img" aria-label="Chord sequence with roughness of each chord">
        {steps.map((st, i) => {
          const w = st.beats * pxPerBeat;
          const x0 = x;
          x += w;
          const rough = chordRoughness(SPEC, st.chord.notes.map(midiToHz)) / ROUGH_MAX;
          const finalSame = mode === 'context' && i === steps.length - 1;
          return (
            <g key={i}>
              <rect
                x={r2(x0 + 2)}
                y={8}
                width={r2(w - 4)}
                height={48}
                rx={6}
                className={'chord-box' + (now === i ? ' is-now' : '') + (st.chord.role === 'home' ? ' is-home' : '') + (st.chord.role === 'dominant' ? ' is-dom' : '') + (finalSame ? ' is-same' : '')}
              />
              <text x={r2(x0 + w / 2)} y={30} textAnchor="middle" className="chord-name">
                {st.chord.name}
              </text>
              <text x={r2(x0 + w / 2)} y={47} textAnchor="middle" className="w-tick">
                {st.chord.role ?? st.chord.spell}
              </text>
              <rect x={r2(x0 + 8)} y={70} width={r2(Math.max(1, Math.min(w - 16, 64) * rough))} height={8} className="fill-rough" />
              <rect x={r2(x0 + 8)} y={70} width={r2(Math.min(w - 16, 64))} height={8} className="rough-track" />
            </g>
          );
        })}
        <text x={10} y={96} className="w-tick">
          roughness of each chord (chapter 1.5 model) · {totalBeats} beats at {BPM} BPM
        </text>
      </svg>

      {mode === 'endings' && (
        <Slider
          label="Hold the dominant"
          min={1}
          max={8}
          step={1}
          value={hold}
          onChange={setHold}
          display={`${hold} beat${hold > 1 ? 's' : ''}`}
        />
      )}
    </Widget>
  );
}

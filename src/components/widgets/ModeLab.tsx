// Tonal centers, three ways.
//   modes    — the seven diatonic modes: keep the white keys and move home
//              ("same notes, new home"), or keep home on C and change the
//              notes ("same home, new notes"). A drone sounds the home note.
//              Switching while it plays takes effect on the next note.
//   probe    — a do-it-yourself probe-tone experiment: a cadence sets up a
//              key, then one tone; rate how well it fits, and compare your 12
//              ratings with Krumhansl & Kessler's (1982) published profile.
//   keyfind  — Krumhansl–Schmuckler key finding: total each pitch class's
//              duration in a tune, correlate with the 24 key profiles, and see
//              where pure statistics guess right and wrong.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TUNES, type Note } from '../../lib/melodies';
import { harmonicWave, loop, note, startRun, type Run } from '../../lib/sequence';
import {
  KK_MAJOR,
  KK_MINOR,
  MODAL_PHRASE,
  MODES,
  SAILOR,
  correlation,
  degreeMidi,
  findKeys,
  letterPc,
  modeById,
  pcDurations,
  rotated,
  spellScale,
  type ModeId,
} from '../../lib/tonality';
import { midiToHz, NOTE_NAMES } from '../../lib/tuning';
import { PlayButton, Readout, Segmented, Widget, r2, useAudioOwner } from './ui';

type LabMode = 'modes' | 'probe' | 'keyfind';
type Compare = 'relative' | 'parallel';
type Line = 'scale' | 'tune' | 'drone';

const LAB_LABELS: Record<LabMode, string> = { modes: 'Modes', probe: 'Probe tones', keyfind: 'Key finding' };

// ---------- keyboard geometry (A3..C6) ----------
const K0 = 57, K1 = 84;
const BLACK = new Set([1, 3, 6, 8, 10]);
const whites = Array.from({ length: K1 - K0 + 1 }, (_, i) => K0 + i).filter((m) => !BLACK.has(m % 12));
const KW = 680 / whites.length;
const whiteX = (m: number) => whites.indexOf(m) * KW;
const keyX = (m: number) => (BLACK.has(m % 12) ? whiteX(m - 1) + KW * 0.68 : whiteX(m));
const keyCenter = (m: number) => (BLACK.has(m % 12) ? whiteX(m - 1) + KW : whiteX(m) + KW / 2);

// ---------- key-finding corpus ----------
type KfTune = { id: string; name: string; notes: Note[]; actual: string; bpm: number };
const KF_TUNES: KfTune[] = [
  ...['twinkle', 'ode', 'birthday', 'mary', 'jingle', 'beethoven5'].map((id) => {
    const t = TUNES.find((x) => x.id === id)!;
    return { id, name: t.name, notes: t.notes, actual: id === 'beethoven5' ? 'C minor' : 'C major', bpm: t.bpm ?? 112 };
  }),
  { id: 'sailor', name: 'Drunken Sailor', notes: SAILOR, actual: 'D Dorian', bpm: 132 },
];

const CONTEXT = {
  major: [[48, 60, 64, 67], [53, 60, 65, 69], [55, 59, 62, 67], [48, 60, 64, 67]],
  minor: [[48, 60, 63, 67], [53, 60, 65, 68], [55, 59, 62, 67], [48, 60, 63, 67]],
};
const PC_LABEL = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'];

export default function ModeLab({
  initialMode = 'modes' as LabMode,
  modes = ['modes', 'probe', 'keyfind'] as LabMode[],
  mode: initialModal = 'dorian' as ModeId,
  compare: initialCompare = 'relative' as Compare,
  tune: initialTune = 'twinkle',
}: {
  initialMode?: LabMode;
  modes?: LabMode[];
  mode?: ModeId;
  compare?: Compare;
  tune?: string;
}) {
  const [lab, setLab] = useState<LabMode>(initialMode);
  const [playing, setPlaying] = useState(false);
  const run = useRef<Run | null>(null);
  const cancels = useRef<(() => void)[]>([]);
  const timers = useRef<number[]>([]);

  // modes
  const [modal, setModal] = useState<ModeId>(initialModal);
  const [compare, setCompare] = useState<Compare>(initialCompare);
  const [lineKind, setLineKind] = useState<Line>('tune');
  const [drone, setDrone] = useState(true);
  const [nowMidi, setNowMidi] = useState<number | null>(null);
  const live = useRef({ modal, compare, lineKind, drone });
  live.current = { modal, compare, lineKind, drone };

  // probe
  const [ctxKind, setCtxKind] = useState<'major' | 'minor'>('major');
  const [ratings, setRatings] = useState<Record<string, (number | null)[]>>({ major: Array(12).fill(null), minor: Array(12).fill(null) });
  const [probe, setProbe] = useState<number | null>(null);
  const [showKK, setShowKK] = useState(false);

  // keyfind
  const [kfId, setKfId] = useState(KF_TUNES.some((t) => t.id === initialTune) ? initialTune : 'twinkle');

  const stop = useCallback(() => {
    run.current?.stop(0.2);
    run.current = null;
    cancels.current.forEach((c) => c());
    cancels.current = [];
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPlaying(false);
    setNowMidi(null);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => stop, [lab, stop]);

  // ---------- modes: derived ----------
  const info = modeById(modal);
  const tonicLetter = compare === 'relative' ? info.white : 'C';
  const tonicMidi = 60 + (compare === 'relative' ? letterPc(info.white) : 0);
  const spelled = spellScale(tonicLetter, tonicMidi % 12, info.semis);
  const scaleMidis = [...info.semis.map((s) => tonicMidi + s), tonicMidi + 12];

  // The drone follows the current home; rebuilt whenever home changes while playing.
  const droneNodes = useRef<{ stop: () => void } | null>(null);
  const startDrone = useCallback((r: Run, home: number, withFifth: boolean) => {
    const { ctx } = r;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.25);
    g.connect(r.bus);
    const wave = harmonicWave(ctx, 8, 1.4);
    const notes = [home - 24, home - 12, ...(withFifth ? [home - 12 + 7] : [])];
    const oscs = notes.map((m, i) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave);
      o.frequency.value = midiToHz(m);
      const og = ctx.createGain();
      og.gain.value = i === 0 ? 0.09 : 0.06;
      o.connect(og).connect(g);
      o.start(t);
      return o;
    });
    return {
      stop() {
        const n = ctx.currentTime;
        g.gain.cancelScheduledValues(n);
        g.gain.setValueAtTime(g.gain.value, n);
        g.gain.linearRampToValueAtTime(0, n + 0.2);
        oscs.forEach((o) => o.stop(n + 0.3));
      },
    };
  }, []);

  useEffect(() => {
    if (!playing || lab !== 'modes' || !run.current) return;
    droneNodes.current?.stop();
    droneNodes.current = null;
    if (drone) droneNodes.current = startDrone(run.current, tonicMidi, info.semis[4] === 7);
  }, [playing, lab, drone, tonicMidi, info, startDrone]);
  useEffect(() => {
    if (!playing) {
      droneNodes.current?.stop();
      droneNodes.current = null;
    }
  }, [playing]);

  const playModes = () => {
    const r = startRun(0.1);
    run.current = r;
    const wave = harmonicWave(r.ctx, 10, 1.5);
    const eighth = 60 / 132 / 2;
    let pos = 0; // index into the current line
    cancels.current.push(
      loop(r, (t) => {
        const L = live.current;
        const mi = modeById(L.modal);
        const home = 60 + (L.compare === 'relative' ? letterPc(mi.white) : 0);
        if (L.lineKind === 'drone') {
          pos = 0;
          timers.current.push(window.setTimeout(() => setNowMidi(null), Math.max(0, (t - r.ctx.currentTime) * 1000)));
          return eighth * 4;
        }
        let deg: number, len: number;
        if (L.lineKind === 'scale') {
          const seq = [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0];
          const i = pos % (seq.length + 2);
          if (i >= seq.length) {
            pos++;
            return eighth * 2; // a breath between runs
          }
          deg = seq[i];
          len = i === seq.length - 1 ? 4 : 2;
        } else {
          const [d, l] = MODAL_PHRASE[pos % MODAL_PHRASE.length];
          deg = d;
          len = l;
        }
        pos++;
        const m = degreeMidi(home, mi.semis, deg);
        note(r, { f: midiToHz(m), t, dur: len * eighth * 0.85, gain: 0.16, attack: 0.015, release: 0.15, wave });
        timers.current.push(window.setTimeout(() => setNowMidi(m), Math.max(0, (t - r.ctx.currentTime) * 1000)));
        return len * eighth;
      }),
    );
    setPlaying(true);
  };

  // ---------- probe ----------
  const playProbe = (pc: number) => {
    stop();
    const r = startRun(0.1);
    run.current = r;
    const wave = harmonicWave(r.ctx, 10, 1.6);
    const dur = 0.6;
    CONTEXT[ctxKind].forEach((ch, i) =>
      ch.forEach((m, k) => note(r, { f: midiToHz(m), t: r.t0 + i * dur, dur: dur - 0.06, gain: k === 0 ? 0.13 : 0.1, attack: 0.02, release: 0.15, wave })),
    );
    const tp = r.t0 + 4 * dur + 0.6;
    note(r, { f: midiToHz(60 + pc), t: tp, dur: 0.9, gain: 0.2, attack: 0.02, release: 0.3, wave });
    setProbe(pc);
    setPlaying(true);
    timers.current.push(
      window.setTimeout(() => {
        run.current = null;
        setPlaying(false);
      }, (tp - r.ctx.currentTime + 1.4) * 1000),
    );
  };
  const mine = ratings[ctxKind];
  const nextProbe = () => {
    const left = mine.map((v, i) => (v == null ? i : -1)).filter((i) => i >= 0);
    const pool = left.length ? left : Array.from({ length: 12 }, (_, i) => i);
    playProbe(pool[Math.floor(Math.random() * pool.length)]);
  };
  const rate = (v: number) => {
    if (probe == null) return;
    setRatings((r) => ({ ...r, [ctxKind]: r[ctxKind].map((x, i) => (i === probe ? v : x)) }));
  };
  const kk = ctxKind === 'major' ? KK_MAJOR : KK_MINOR;
  const rated = mine.filter((v) => v != null).length;
  const rMatch = useMemo(() => {
    const idx = mine.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
    if (idx.length < 5) return null;
    return correlation(idx.map((i) => mine[i] as number), idx.map((i) => kk[i]));
  }, [mine, kk]);
  const scaleSet = new Set((ctxKind === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]));

  // ---------- keyfind ----------
  const kf = KF_TUNES.find((t) => t.id === kfId)!;
  const hist = useMemo(() => pcDurations(kf.notes), [kf]);
  const guesses = useMemo(() => findKeys(kf.notes), [kf]);
  const best = guesses[0];
  const bestProfile = rotated(best.minor ? KK_MINOR : KK_MAJOR, best.tonicPc);
  const playTune = () => {
    const r = startRun(0.1);
    run.current = r;
    const wave = harmonicWave(r.ctx, 10, 1.5);
    const e = 60 / kf.bpm / 2;
    let t = r.t0;
    for (const [m, len] of kf.notes) {
      if (m > 0) {
        note(r, { f: midiToHz(m), t, dur: len * e * 0.9, gain: 0.17, attack: 0.015, release: 0.12, wave });
        const at = (t - r.ctx.currentTime) * 1000;
        timers.current.push(window.setTimeout(() => setNowMidi(m), at));
      }
      t += len * e;
    }
    timers.current.push(window.setTimeout(() => stop(), (t - r.ctx.currentTime + 0.4) * 1000));
    setPlaying(true);
  };

  const onPlay = () => {
    if (playing) return stop();
    if (lab === 'modes') playModes();
    else if (lab === 'keyfind') playTune();
    else nextProbe();
  };

  // ---------- render ----------
  const title = lab === 'modes' ? 'Same notes, different home' : lab === 'probe' ? 'How well does this note fit?' : 'Finding the key by counting';
  const caption =
    lab === 'modes' ? (
      <>
        Blue key: home (the <strong>tonic</strong>), sounded by the drone. Orange key: the note that gives the mode its
        color. Numbers under the keys are the steps in semitones; half steps are orange. In <em>Same notes, new home</em>{' '}
        every mode uses only the white keys and only home moves. In <em>Same home, new notes</em> home stays on C and the
        notes change. Switch modes while it plays.
      </>
    ) : lab === 'probe' ? (
      <>
        A short chord progression sets up a key, then a single tone sounds. Rate how well it fits, from 1 (badly) to 7
        (very well). Blue bars are your ratings. The orange dots are the average ratings of Krumhansl and Kessler's
        listeners (1982), on the same 1–7 scale. Click a column to hear that tone again. Your ratings will be noisier than
        an average of many listeners.
      </>
    ) : (
      <>
        Bars: how long each pitch class sounds in the tune, in total. The Krumhansl–Schmuckler method compares that
        pattern with the profile of all 24 major and minor keys and picks the best match. The orange line is the winning
        key's profile. It ignores the order of the notes, and it only knows major and minor.
      </>
    );

  const steps = scaleMidis.slice(1).map((m, i) => m - scaleMidis[i]);
  const brightIdx = MODES.findIndex((m) => m.id === modal);

  return (
    <Widget kicker="Lab" title={title} caption={caption}>
      <div className="w-controls">
        <PlayButton playing={playing} onClick={onPlay} label={lab === 'probe' && !playing ? (rated ? 'Next tone' : 'Start') : undefined} />
        {modes.length > 1 && (
          <Segmented label="Lab" value={lab} options={modes.map((m) => ({ value: m, label: LAB_LABELS[m] }))} onChange={setLab} />
        )}
      </div>

      {lab === 'modes' && (
        <>
          <div className="w-controls">
            <Segmented
              label="Compare"
              value={compare}
              options={[
                { value: 'relative', label: 'Same notes, new home' },
                { value: 'parallel', label: 'Same home, new notes' },
              ]}
              onChange={setCompare}
            />
            <Segmented
              label="Play"
              value={lineKind}
              options={[
                { value: 'tune', label: 'A tune' },
                { value: 'scale', label: 'The scale' },
                { value: 'drone', label: 'Drone only' },
              ]}
              onChange={setLineKind}
            />
            <button type="button" className={'w-chip' + (drone ? ' is-on' : '')} aria-pressed={drone} onClick={() => setDrone((d) => !d)}>
              Drone on home
            </button>
          </div>
          <div className="ml-modes" role="radiogroup" aria-label="Mode">
            <span className="w-label">brighter</span>
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={m.id === modal}
                className={'w-chip ml-mode' + (m.id === modal ? ' is-on' : '')}
                onClick={() => setModal(m.id)}
              >
                <span>{m.name.replace(/ \(.*\)/, '')}</span>
                <small>{compare === 'relative' ? `${m.white}–${m.white}` : m.vsMajor.join(' ') || 'major'}</small>
              </button>
            ))}
            <span className="w-label">darker</span>
          </div>

          <svg viewBox="0 0 680 150" className="w-plot" role="img" aria-label={`Keyboard showing ${info.name} on ${tonicLetter}`}>
            {whites.map((m) => {
              const inScale = scaleMidis.includes(m);
              const cls = m === tonicMidi || m === tonicMidi + 12 ? ' is-home' : inScale && (m - tonicMidi) % 12 === info.semis[info.color] ? ' is-color' : inScale ? ' is-in' : '';
              return (
                <g key={m}>
                  <rect x={r2(whiteX(m) + 0.5)} y={6} width={r2(KW - 1)} height={92} rx={3} className={'ml-white' + cls + (nowMidi === m ? ' is-now' : '')} />
                  <text x={r2(whiteX(m) + KW / 2)} y={90} textAnchor="middle" className="ml-keylabel">
                    {NOTE_NAMES[m % 12]}
                  </text>
                </g>
              );
            })}
            {Array.from({ length: K1 - K0 + 1 }, (_, i) => K0 + i)
              .filter((m) => BLACK.has(m % 12))
              .map((m) => {
                const inScale = scaleMidis.includes(m);
                const cls = inScale && (m - tonicMidi) % 12 === info.semis[info.color] ? ' is-color' : inScale ? ' is-in' : '';
                return <rect key={m} x={r2(keyX(m))} y={6} width={r2(KW * 0.64)} height={56} rx={2} className={'ml-black' + cls + (nowMidi === m ? ' is-now' : '')} />;
              })}
            {steps.map((s, i) => {
              const x0 = keyCenter(scaleMidis[i]);
              const x1 = keyCenter(scaleMidis[i + 1]);
              const mx = (x0 + x1) / 2;
              return (
                <g key={i}>
                  <path d={`M${r2(x0)},106 Q${r2(mx)},122 ${r2(x1)},106`} className="ml-arc" />
                  <text x={r2(mx)} y={134} textAnchor="middle" className={'ml-step' + (s === 1 ? ' is-half' : '')}>
                    {s}
                  </text>
                </g>
              );
            })}
            {scaleMidis.map((m, i) => (
              <text key={i} x={r2(keyCenter(m))} y={148} textAnchor="middle" className="w-tick">
                {i === 7 ? '1' : i === info.color ? info.colorLabel : String(i + 1)}
              </text>
            ))}
          </svg>

          <div className="w-readouts">
            <Readout label="Mode">
              {info.name} on {tonicLetter}
            </Readout>
            <Readout label="Notes">{spelled.join(' ')}</Readout>
            <Readout label="Compared with major">{info.vsMajor.length ? info.vsMajor.join(' ') : 'same'}</Readout>
            <Readout label="Brightness">
              {brightIdx + 1} of 7
            </Readout>
          </div>
          <p className="ml-blurb">{info.blurb}</p>
        </>
      )}

      {lab === 'probe' && (
        <>
          <div className="w-controls">
            <Segmented
              label="Key"
              value={ctxKind}
              options={[
                { value: 'major', label: 'C major' },
                { value: 'minor', label: 'C minor' },
              ]}
              onChange={(v) => {
                setCtxKind(v);
                setProbe(null);
              }}
            />
            <button type="button" className={'w-chip' + (showKK ? ' is-on' : '')} aria-pressed={showKK} onClick={() => setShowKK((s) => !s)}>
              Show the published ratings
            </button>
            <button
              type="button"
              className="w-chip"
              onClick={() => {
                setRatings((r) => ({ ...r, [ctxKind]: Array(12).fill(null) }));
                setProbe(null);
              }}
            >
              Clear my ratings
            </button>
          </div>
          <div className="w-controls ml-rate" aria-label="Rate the tone">
            <span className="w-label">{probe == null ? 'Press Start to hear a tone' : `Rate ${PC_LABEL[probe]}:`}</span>
            {[1, 2, 3, 4, 5, 6, 7].map((v) => (
              <button key={v} type="button" disabled={probe == null} className={'w-chip ml-rate-b' + (probe != null && mine[probe] === v ? ' is-on' : '')} onClick={() => rate(v)}>
                {v}
              </button>
            ))}
          </div>
          <svg viewBox="0 0 680 200" className="w-plot is-clickable" role="img" aria-label="Your fit ratings for the 12 pitch classes, with the published profile">
            {[1, 4, 7].map((v) => (
              <g key={v}>
                <line x1={34} x2={676} y1={r2(170 - (v - 1) * 25)} y2={r2(170 - (v - 1) * 25)} className="stroke-grid" />
                <text x={26} y={r2(174 - (v - 1) * 25)} textAnchor="end" className="w-tick">
                  {v}
                </text>
              </g>
            ))}
            {mine.map((v, pc) => {
              const x = 40 + pc * 53;
              return (
                <g key={pc} onClick={() => playProbe(pc)} style={{ cursor: 'pointer' }}>
                  <rect x={x - 4} y={10} width={53} height={186} className="ml-col" />
                  {v != null && <rect x={x + 8} y={r2(170 - (v - 1) * 25)} width={28} height={r2((v - 1) * 25 + 2)} rx={2} className={'ml-bar' + (probe === pc ? ' is-now' : '')} />}
                  {showKK && <circle cx={x + 22} cy={r2(170 - (kk[pc] - 1) * 25)} r={5} className="ml-kk" />}
                  <text x={x + 22} y={190} textAnchor="middle" className={'ml-pc' + (scaleSet.has(pc) ? ' is-in' : '') + (probe === pc ? ' is-now' : '')}>
                    {NOTE_NAMES[pc]}
                  </text>
                </g>
              );
            })}
            {showKK && <path d={kk.map((v, pc) => `${pc ? 'L' : 'M'}${62 + pc * 53},${r2(170 - (v - 1) * 25)}`).join(' ')} className="ml-kk-line" />}
          </svg>
          <div className="w-readouts">
            <Readout label="Tones rated">{rated} of 12</Readout>
            <Readout label="Match with the published profile">{rMatch == null ? 'rate at least 5 tones' : `r = ${rMatch.toFixed(2)}`}</Readout>
            <Readout label="Bold names">notes of the {ctxKind === 'major' ? 'C major' : 'C minor'} scale</Readout>
          </div>
        </>
      )}

      {lab === 'keyfind' && (
        <>
          <div className="w-controls">
            <Segmented label="Tune" value={kfId} options={KF_TUNES.map((t) => ({ value: t.id, label: t.name }))} onChange={(v) => { stop(); setKfId(v); }} />
          </div>
          <svg viewBox="0 0 680 190" className="w-plot" role="img" aria-label="Time spent on each pitch class, with the best-matching key profile">
            {(() => {
              const hmax = Math.max(...hist);
              const pmin = Math.min(...bestProfile), pmax = Math.max(...bestProfile);
              return (
                <>
                  {hist.map((v, pc) => {
                    const x = 40 + pc * 53;
                    const h = (v / hmax) * 140;
                    const on = nowMidi != null && nowMidi % 12 === pc;
                    return (
                      <g key={pc}>
                        <rect x={x + 8} y={r2(160 - h)} width={28} height={r2(Math.max(h, 0.5))} rx={2} className={'ml-bar' + (on ? ' is-now' : '')} />
                        <text x={x + 22} y={178} textAnchor="middle" className={'ml-pc' + (pc === best.tonicPc ? ' is-now' : '')}>
                          {NOTE_NAMES[pc]}
                        </text>
                      </g>
                    );
                  })}
                  <path
                    d={bestProfile.map((v, pc) => `${pc ? 'L' : 'M'}${62 + pc * 53},${r2(160 - ((v - pmin) / (pmax - pmin)) * 140)}`).join(' ')}
                    className="ml-kk-line"
                  />
                </>
              );
            })()}
          </svg>
          <div className="ml-guesses">
            {guesses.slice(0, 4).map((g, i) => (
              <div key={g.name} className={'ml-guess' + (i === 0 ? ' is-best' : '')}>
                <span>{g.name}</span>
                <svg viewBox="0 0 100 10" className="ml-guess-bar" aria-hidden>
                  <rect x={0} y={1} width={r2(Math.max(0, g.r) * 100)} height={8} className={i === 0 ? 'ml-kk' : 'ml-bar'} />
                </svg>
                <span className="w-value">r = {g.r.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="w-readouts">
            <Readout label="The method's guess">{best.name}</Readout>
            <Readout label="What most listeners hear">{kf.actual}</Readout>
            <Readout label="Verdict">{best.name === kf.actual ? 'right' : 'wrong'}</Readout>
          </div>
        </>
      )}
    </Widget>
  );
}

// Expectation lab (chapter 1.6). Two modes:
// - "guess": a tune stops at a gap; you guess the next note on the keyboard,
//   then see what a simple statistical model predicted and how surprising the
//   real note was (surprisal, in bits). The model can listen as a stranger to
//   the tune (style knowledge only), as someone noticing repeats within this
//   hearing, or as someone who knows the tune by heart. All of it is computed
//   by src/lib/expectation.ts from the same tunes the lab plays.
// - "learn": a statistical-learning demo after Saffran et al. (1999). A
//   continuous stream of tones made of six hidden three-tone "words"; then a
//   test of words against part-words.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HI, LO, TONE_WORDS, profile, testPairs, transitionStats, wordStream, type Listener } from '../../lib/expectation';
import { TUNES, type Note } from '../../lib/melodies';
import { harmonicWave, loop, note, startRun, type Run } from '../../lib/sequence';
import { midiName, midiToHz } from '../../lib/tuning';
import { PlayButton, Readout, Segmented, Widget, r2, scale, useAudioOwner } from './ui';

type Mode = 'guess' | 'learn';
const LISTENERS: { value: Listener; label: string }[] = [
  { value: 'schematic', label: 'A stranger to this tune' },
  { value: 'dynamic', label: '+ notices repeats' },
  { value: 'veridical', label: 'Knows it by heart' },
];
const GUESS_TUNES = TUNES.filter((t) => t.id !== 'beethoven5');

export default function ExpectationLab(props: { initialMode?: Mode; modes?: Mode[]; tune?: string; listener?: Listener }) {
  const modes = props.modes ?? ['guess', 'learn'];
  const [mode, setMode] = useState<Mode>(props.initialMode ?? modes[0]);
  return (
    <Widget
      kicker="Lab"
      title={mode === 'guess' ? 'Guess the next note' : 'Learn a tone language'}
      caption={
        mode === 'guess' ? (
          <>
            Notes are bars: time across, pitch up. Hidden notes show only their rhythm. Bars under the notes show each
            note's <strong>surprisal</strong>: how unexpected it was for the model, in bits (each extra bit means half as
            likely). Above the keyboard: the model's probability for each possible next note. The model is a toy: it
            learned its style from the other {GUESS_TUNES.length - 1} tunes in this lab, where a research model such as
            IDyOM learns from thousands.
          </>
        ) : (
          <>
            A continuous stream of tones with no pauses. Hidden in it are six three-tone "words"; within a word, the next
            tone is fairly predictable, and between words it isn't. That is the only clue. After listening, the test
            plays pairs of three-tone snippets: one a word, one a "part-word" that straddles a boundary. Chance is 50%.
          </>
        )
      }
    >
      {modes.length > 1 && (
        <div className="w-controls">
          <Segmented
            label="Lab"
            value={mode}
            options={[
              { value: 'guess' as Mode, label: 'Guess the next note' },
              { value: 'learn' as Mode, label: 'Learn a tone language' },
            ].filter((o) => modes.includes(o.value))}
            onChange={setMode}
          />
        </div>
      )}
      {mode === 'guess' ? <Guess tune={props.tune} listener={props.listener} /> : <Learn />}
    </Widget>
  );
}

// ---------------------------------------------------------------- guess mode

type Ev = { m: number; u: number; d: number; pi: number };
function events(notes: Note[]): Ev[] {
  let u = 0;
  let pi = 0;
  return notes.map(([m, d]) => {
    const e = { m, u, d, pi: m > 0 ? pi++ : -1 };
    u += d;
    return e;
  });
}

function pickCut(n: number, avoid: number) {
  let c = avoid;
  while (c === avoid) c = 2 + Math.floor(Math.random() * (n - 2));
  return c;
}

function Guess(props: { tune?: string; listener?: Listener }) {
  const [tuneId, setTuneId] = useState(props.tune ?? 'ode');
  const [listener, setListener] = useState<Listener>(props.listener ?? 'schematic');
  const tune = GUESS_TUNES.find((t) => t.id === tuneId) ?? GUESS_TUNES[0];
  const evs = useMemo(() => events(tune.notes), [tune]);
  const prof = useMemo(() => profile(tune, listener), [tune, listener]);
  const n = prof.length;
  const [cut, setCut] = useState(6);
  const [guess, setGuess] = useState<number | null>(null);
  const [whole, setWhole] = useState(false);
  const [score, setScore] = useState({ you: 0, model: 0, tries: 0 });
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const run = useRef<Run | null>(null);
  const timers = useRef<number[]>([]);

  const stop = useCallback(() => {
    run.current?.stop(0.08);
    run.current = null;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPlaying(false);
    setNow(null);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => stop, [tuneId, stop]);
  useEffect(() => {
    setGuess(null);
    setCut((c) => Math.min(c, n - 1));
  }, [tuneId, n]);

  const revealed = whole || guess !== null;
  const shown = (pi: number) => whole || pi < cut || (guess !== null && pi === cut);
  const eighth = 30 / (tune.bpm ?? 120);

  const play = () => {
    if (playing) return stop();
    const r = startRun(0.1);
    run.current = r;
    const wave = harmonicWave(r.ctx, 8, 1.5);
    const lead = (r.t0 - r.ctx.currentTime) * 1000;
    const lastPi = whole ? n - 1 : revealed ? cut : cut - 1;
    const lastEv = evs.find((e) => e.pi === lastPi);
    const endU = lastEv ? lastEv.u + lastEv.d : 0;
    let end = 0;
    evs.forEach((e, i) => {
      if (e.u >= endU) return;
      const t = r.t0 + e.u * eighth;
      if (e.m) note(r, { f: midiToHz(e.m), t, dur: e.d * eighth * 0.85, gain: 0.2, attack: 0.01, release: 0.12, wave });
      timers.current.push(window.setTimeout(() => setNow(i), lead + e.u * eighth * 1000));
      end = Math.max(end, e.u + e.d);
    });
    timers.current.push(window.setTimeout(() => stop(), lead + (end * eighth + 0.3) * 1000));
    setPlaying(true);
  };

  const blip = (m: number) => {
    stop();
    const r = startRun(0.03);
    run.current = r;
    note(r, { f: midiToHz(m), t: r.t0, dur: 0.45, gain: 0.22, attack: 0.01, release: 0.15, wave: harmonicWave(r.ctx, 8, 1.5) });
    timers.current.push(window.setTimeout(() => stop(), 800));
    setPlaying(true);
  };

  const onKey = (m: number) => {
    blip(m);
    if (whole || guess !== null) return;
    setGuess(m);
    const info = prof[cut];
    setScore((s) => ({ you: s.you + (m === info.midi ? 1 : 0), model: s.model + (info.top === info.midi ? 1 : 0), tries: s.tries + 1 }));
  };

  const next = () => {
    stop();
    setGuess(null);
    setCut((c) => pickCut(n, c));
  };

  const info = prof[cut];
  const probs = whole ? null : guess !== null ? info.probs : null;
  const avg = prof.reduce((a, b) => a + b.bits, 0) / n;
  const pct = (p: number) => (p >= 0.995 ? '>99%' : p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`);

  return (
    <>
      <div className="w-controls">
        <PlayButton playing={playing} onClick={play} label={playing ? 'Stop' : whole ? 'Play the tune' : revealed ? 'Play with the answer' : 'Play up to the gap'} />
        {!whole && (
          <button type="button" className="w-chip" onClick={next}>
            Another gap
          </button>
        )}
        <button type="button" className={'w-chip' + (whole ? ' is-on' : '')} onClick={() => (stop(), setWhole(!whole))}>
          Show the whole tune
        </button>
      </div>
      <div className="w-controls">
        <Segmented label="Tune" value={tuneId} options={GUESS_TUNES.map((t) => ({ value: t.id, label: t.name }))} onChange={setTuneId} />
      </div>
      <div className="w-controls">
        <Segmented label="The model listens as" value={listener} options={LISTENERS} onChange={setListener} />
      </div>
      <Roll evs={evs} prof={prof} shown={shown} gap={whole ? null : cut} now={now} />
      {!whole && <Keys probs={probs} guess={guess} answer={guess !== null ? info.midi : null} onKey={onKey} />}
      <div className="w-controls">
        {whole ? (
          <>
            <Readout label="Average surprisal">{avg.toFixed(1)} bits per note</Readout>
            <Readout label="Model's first choice was right">
              {Math.round((100 * prof.filter((p) => p.top === p.midi).length) / n)}% of notes
            </Readout>
          </>
        ) : guess === null ? (
          <p className="w-note">Play up to the gap, then click the key you think comes next.</p>
        ) : (
          <>
            <Readout label="You">
              {midiName(guess)} {guess === info.midi ? '✓' : '✗'}
            </Readout>
            <Readout label="Actual">{midiName(info.midi)}</Readout>
            <Readout label="Model's first choice">
              {midiName(info.top)} {info.top === info.midi ? '✓' : '✗'}
            </Readout>
            <Readout label="Model gave the actual note">
              {pct(info.p)} · {info.bits.toFixed(1)} bits
            </Readout>
          </>
        )}
      </div>
      {score.tries > 0 && !whole && (
        <p className="w-note">
          Score so far: you {score.you} of {score.tries}, the model {score.model} of {score.tries}.
        </p>
      )}
    </>
  );
}

function Roll(props: { evs: Ev[]; prof: { bits: number; midi: number }[]; shown: (pi: number) => boolean; gap: number | null; now: number | null }) {
  const { evs, prof } = props;
  const W = 680;
  const H = 230;
  const NH = 150; // note area height
  const total = evs.reduce((s, e) => Math.max(s, e.u + e.d), 0);
  const ms = evs.filter((e) => e.m > 0).map((e) => e.m);
  const lo = Math.min(...ms) - 2;
  const hi = Math.max(...ms) + 2;
  const x = scale(0, total, 36, W - 10);
  const y = scale(lo, hi, NH - 12, 10);
  const BMAX = 8;
  const by = scale(0, BMAX, H - 16, NH + 12);
  const cs: number[] = [];
  for (let m = Math.ceil(lo / 12) * 12; m <= hi; m += 12) cs.push(m);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Piano roll of the tune with the surprisal of each note">
      {cs.map((m) => (
        <g key={m}>
          <line x1={36} x2={W - 10} y1={y(m)} y2={y(m)} className="stroke-grid" />
          <text x={30} y={y(m) + 4} textAnchor="end" className="w-tick">
            {midiName(m)}
          </text>
        </g>
      ))}
      {[0, 4, 8].map((b) => (
        <g key={b}>
          <line x1={36} x2={W - 10} y1={by(b)} y2={by(b)} className="stroke-grid" />
          <text x={30} y={by(b) + 4} textAnchor="end" className="w-tick">
            {b}
          </text>
        </g>
      ))}
      <text x={36} y={NH + 6} className="w-tick">
        surprisal (bits)
      </text>
      {evs.map((e, i) => {
        if (e.pi < 0) return null;
        const x0 = x(e.u);
        const w = r2(Math.max(2, x(e.u + e.d) - x0 - 2));
        const isGap = props.gap === e.pi;
        if (!props.shown(e.pi)) {
          return (
            <g key={i}>
              <rect x={x0} y={NH - 8} width={w} height={4} rx={2} className="note-ghost" />
              {isGap && (
                <text x={r2(x0 + w / 2)} y={NH / 2} textAnchor="middle" className="exp-gap">
                  ?
                </text>
              )}
            </g>
          );
        }
        const bits = Math.min(BMAX, prof[e.pi].bits);
        return (
          <g key={i}>
            <rect x={x0} y={r2(y(e.m) - 4)} width={w} height={8} rx={2} className={'note-bar' + (props.now === i || isGap ? ' is-now' : '')} />
            <rect x={x0} y={by(bits)} width={w} height={r2(by(0) - by(bits))} className={bits >= 4 ? 'bar-leap' : 'bar-step'} opacity={0.85} />
          </g>
        );
      })}
    </svg>
  );
}

const BLACK = new Set([1, 3, 6, 8, 10]);
function Keys(props: { probs: number[] | null; guess: number | null; answer: number | null; onKey: (m: number) => void }) {
  const W = 680;
  const H = 150;
  const KH = 88;
  const whites: number[] = [];
  for (let m = LO; m <= HI; m++) if (!BLACK.has(m % 12)) whites.push(m);
  const ww = (W - 20) / whites.length;
  const xOf = (m: number) => {
    if (!BLACK.has(m % 12)) return 10 + whites.indexOf(m) * ww;
    return 10 + whites.indexOf(m - 1) * ww + ww * 0.68;
  };
  const top = H - KH;
  const pmax = props.probs ? Math.max(...props.probs) : 1;
  const cls = (m: number, base: string) =>
    base + (m === props.answer ? ' sel-a' : m === props.guess ? ' sel-b' : '');
  const blacks: number[] = [];
  for (let m = LO; m <= HI; m++) if (BLACK.has(m % 12)) blacks.push(m);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-keys" role="group" aria-label="Keyboard: click the note you think comes next">
      {props.probs &&
        props.probs.map((p, i) => {
          const m = LO + i;
          const w = BLACK.has(m % 12) ? ww * 0.64 : ww - 2;
          const hgt = r2((p / pmax) * (top - 18));
          return (
            <g key={'p' + m}>
              <rect x={r2(xOf(m) + 1)} y={r2(top - 4 - hgt)} width={r2(w)} height={hgt} className={m === props.answer ? 'bar-same' : 'bar-repeat'} />
              {p >= 0.08 && (
                <text x={r2(xOf(m) + w / 2 + 1)} y={r2(top - 8 - hgt)} textAnchor="middle" className="w-tick">
                  {Math.round(p * 100)}%
                </text>
              )}
            </g>
          );
        })}
      {whites.map((m) => (
        <g key={m} onClick={() => props.onKey(m)}>
          <rect x={r2(xOf(m))} y={top} width={r2(ww - 1)} height={KH} rx={3} className={cls(m, 'white')} />
          {m % 12 === 0 && (
            <text x={r2(xOf(m) + ww / 2)} y={H - 6} textAnchor="middle" className={'key-label' + (m === props.answer || m === props.guess ? ' on-sel' : '')}>
              {midiName(m)}
            </text>
          )}
        </g>
      ))}
      {blacks.map((m) => (
        <rect key={m} x={r2(xOf(m))} y={top} width={r2(ww * 0.64)} height={KH * 0.6} rx={2} className={cls(m, 'black')} onClick={() => props.onKey(m)} />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------- learn mode

const TONE = 0.3; // seconds per tone, no gaps
const STREAM = wordStream(2000, 11);
const PAIRS = testPairs(8, 5);
// Spelled with sharps, as in Saffran et al. (1999).
const SHARPS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const WORD_CLASS = ['exp-w0', 'exp-w1', 'exp-w2', 'exp-w3', 'exp-w4', 'exp-w5'];

type Phase = 'listen' | 'test';
function Learn() {
  const [minutes, setMinutes] = useState(2);
  const [phase, setPhase] = useState<Phase>('listen');
  const [show, setShow] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [heard, setHeard] = useState(0); // tones heard
  const [trial, setTrial] = useState(0);
  const [answers, setAnswers] = useState<(0 | 1)[]>([]);
  const [trialPlayed, setTrialPlayed] = useState(false);
  const run = useRef<Run | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const timers = useRef<number[]>([]);
  const sched = useRef<{ t: number; k: number }[]>([]);
  const raf = useRef<number | null>(null);
  const heardRef = useRef(0);

  const stop = useCallback(() => {
    run.current?.stop(0.08);
    run.current = null;
    cancel.current?.();
    cancel.current = null;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setPlaying(false);
  }, []);
  useAudioOwner(playing, stop);

  const tones = useMemo(() => STREAM.flatMap((w) => TONE_WORDS[w].map((m, k) => ({ m, w, k }))), []);
  const limit = Math.round((minutes * 60) / TONE);

  const listen = () => {
    if (playing) return stop();
    const r = startRun(0.1, 1);
    run.current = r;
    const wave = harmonicWave(r.ctx, 6, 1.6);
    sched.current = [];
    const start = heardRef.current;
    cancel.current = loop(r, (t, i) => {
      const k = start + i;
      if (k >= limit) {
        if (k === limit) timers.current.push(window.setTimeout(() => (stop(), setPhase('test')), (t - r.ctx.currentTime) * 1000 + 200));
        return 10;
      }
      note(r, { f: midiToHz(tones[k].m), t, dur: TONE - 0.03, gain: 0.17, attack: 0.012, release: 0.06, wave });
      sched.current.push({ t, k });
      return TONE;
    });
    const tick = () => {
      const now = r.ctx.currentTime;
      let last = heardRef.current;
      for (const s of sched.current) if (s.t <= now) last = Math.max(last, s.k + 1);
      if (last !== heardRef.current) {
        heardRef.current = last;
        setHeard(last);
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    setPlaying(true);
  };

  const playPair = () => {
    if (playing) return stop();
    const r = startRun(0.1, 1);
    run.current = r;
    const wave = harmonicWave(r.ctx, 6, 1.6);
    const p = PAIRS[trial];
    const items = p.wordFirst ? [p.word, p.part] : [p.part, p.word];
    let t = r.t0;
    items.forEach((it, j) => {
      it.forEach((m) => {
        note(r, { f: midiToHz(m), t, dur: TONE - 0.03, gain: 0.17, attack: 0.012, release: 0.06, wave });
        t += TONE;
      });
      if (j === 0) t += 0.9;
    });
    timers.current.push(window.setTimeout(() => (stop(), setTrialPlayed(true)), (t - r.ctx.currentTime + 0.3) * 1000));
    setPlaying(true);
  };

  const answer = (first: boolean) => {
    const p = PAIRS[trial];
    const correct = first === p.wordFirst;
    setAnswers((a) => [...a, correct ? 1 : 0]);
    setTrial((t) => t + 1);
    setTrialPlayed(false);
  };

  const reset = () => {
    stop();
    heardRef.current = 0;
    setHeard(0);
    setPhase('listen');
    setTrial(0);
    setAnswers([]);
    setTrialPlayed(false);
  };

  const done = phase === 'test' && trial >= PAIRS.length;
  const stats = useMemo(() => transitionStats(STREAM.slice(0, Math.max(2, Math.ceil(heard / 3)))), [heard]);
  const secs = Math.round(heard * TONE);
  const name = (ms: number[]) => ms.map((m) => SHARPS[m % 12]).join(' ');

  return (
    <>
      {phase === 'listen' ? (
        <>
          <div className="w-controls">
            <PlayButton playing={playing} onClick={listen} label={playing ? 'Pause' : heard ? 'Keep listening' : 'Start listening'} />
            <Segmented
              label="Listen for"
              value={minutes}
              options={[
                { value: 1, label: '1 min' },
                { value: 2, label: '2 min' },
                { value: 5, label: '5 min' },
              ]}
              onChange={(v) => setMinutes(v)}
            />
            <button type="button" className="w-chip" onClick={() => (stop(), setPhase('test'))}>
              Go to the test
            </button>
            <button type="button" className={'w-chip' + (show ? ' is-on' : '')} onClick={() => setShow(!show)}>
              Show the hidden words
            </button>
          </div>
          <Ticker tones={tones} heard={heard} show={show} />
          <div className="w-controls">
            <Readout label="Listened">
              {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} of {minutes}:00
            </Readout>
            {show && (
              <Readout label="Next tone predictable">
                inside a word {Math.round(stats.within * 100)}% · across a boundary {Math.round(stats.across * 100)}%
              </Readout>
            )}
          </div>
          <p className="w-note">
            {show
              ? 'Spoilers on. Each color is one of the six words. Better to take the test first with them hidden.'
              : 'Just listen; no need to concentrate. The test starts when the time is up.'}
          </p>
        </>
      ) : done ? (
        <>
          <div className="w-controls">
            <Readout label="You picked the word">
              {answers.reduce<number>((a, b) => a + b, 0)} of {PAIRS.length}
            </Readout>
            <button type="button" className="w-chip" onClick={reset}>
              Start over
            </button>
          </div>
          <div className="exp-results">
            {PAIRS.map((p, i) => (
              <div key={i}>
                {answers[i] ? '✓' : '✗'} word <strong>{name(p.word)}</strong> vs part-word {name(p.part)}
              </div>
            ))}
          </div>
          <p className="w-note">
            The six words were: {TONE_WORDS.map((w) => name(w)).join(', ')}. Four or five out of eight is what guessing
            gives you most of the time; six or more starts to look like learning.
          </p>
        </>
      ) : (
        <>
          <div className="w-controls">
            <PlayButton playing={playing} onClick={playPair} label={playing ? 'Stop' : trialPlayed ? 'Hear the pair again' : `Play pair ${trial + 1} of ${PAIRS.length}`} />
          </div>
          <div className="w-controls">
            <span className="w-label">Which one sounded more familiar?</span>
            <button type="button" className="w-chip" disabled={!trialPlayed} onClick={() => answer(true)}>
              The first
            </button>
            <button type="button" className="w-chip" disabled={!trialPlayed} onClick={() => answer(false)}>
              The second
            </button>
          </div>
          <p className="w-note">
            You heard {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} of the stream. Go with your gut; it's
            fine to feel you're guessing.
          </p>
        </>
      )}
    </>
  );
}

function Ticker(props: { tones: { m: number; w: number; k: number }[]; heard: number; show: boolean }) {
  const W = 680;
  const H = 120;
  const N = 24;
  const from = Math.max(0, props.heard - N);
  const vis = props.tones.slice(from, props.heard);
  const x = (i: number) => r2(24 + i * ((W - 48) / (N - 1)));
  const y = scale(59, 72, H - 16, 14);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="The most recent tones of the stream">
      {vis.map((t, i) => (
        <g key={from + i}>
          {props.show && t.k === 0 && i > 0 && <line x1={r2(x(i) - (W - 48) / (N - 1) / 2)} x2={r2(x(i) - (W - 48) / (N - 1) / 2)} y1={8} y2={H - 8} className="stroke-grid" />}
          <circle cx={x(i)} cy={y(t.m)} r={i === vis.length - 1 ? 8 : 6} className={props.show ? WORD_CLASS[t.w] : 'exp-dot'} opacity={r2(0.35 + (0.65 * (i + 1)) / vis.length)} />
        </g>
      ))}
      {!vis.length && (
        <text x={W / 2} y={H / 2} textAnchor="middle" className="w-tick">
          the stream will scroll here
        </text>
      )}
    </svg>
  );
}

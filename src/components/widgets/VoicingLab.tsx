// Chords from the inside: how they're built, how they're voiced, and how they
// move. Three modes:
//   diatonic  the chord on each degree of C major, made by stacking thirds
//             from the scale (triads or sevenths), with the size of each third
//   voicing   one chord: quality, inversion, spacing, register; its roughness
//             (the chapter 1.5 model) and, optionally, the bass note's harmonics
//   leading   four voices through a progression, either as block chords
//             (everything moves in parallel) or with smooth voice leading
//             (a search for the least motion without parallel fifths/octaves;
//             see src/lib/harmony.ts). Shows each voice's path, held notes,
//             motion in semitones, and parallels.

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ChordHandle, playChord } from '../../lib/audio';
import { chordRoughness, harmonic } from '../../lib/dissonance';
import {
  QUALITIES,
  type Quality,
  type Spacing,
  diatonicChord,
  gapLabel,
  leadVoices,
  motion,
  parallels,
  parseSymbol,
  slashSymbol,
  spellChord,
  voiceChord,
} from '../../lib/harmony';
import { harmonicWave, note, startRun, type Run } from '../../lib/sequence';
import { NOTE_NAMES, midiName, midiToHz } from '../../lib/tuning';
import { PlayButton, Readout, Segmented, Slider, Widget, r2, useAudioOwner } from './ui';

type Mode = 'diatonic' | 'voicing' | 'leading';

const SPEC = harmonic(8, 0.85);
const BLACK = new Set([1, 3, 6, 8, 10]);

/** Roughness between the notes only (each note's own internal roughness removed). */
function interaction(midis: number[]): number {
  const freqs = midis.map(midiToHz);
  const self = freqs.reduce((s, f) => s + chordRoughness(SPEC, [f]), 0);
  return chordRoughness(SPEC, freqs) - self;
}
// reference: a close C major triad (four voices) with its root at C2, about as muddy as a common chord gets
const ROUGH_REF = interaction(voiceChord(36, [0, 4, 7], 0, 'close'));

// ---------- keyboard drawing ----------

type Lit = { cls: string; label?: string };

function Keys(props: { low: number; high: number; lit: Map<number, Lit>; y0: number; ww: number; marks?: { m: number; label: string }[] }) {
  const { low, high, lit, y0, ww } = props;
  const wh = ww * 3.6;
  const bw = ww * 0.62;
  const bh = wh * 0.62;
  const pos = new Map<number, number>();
  let x = 0;
  for (let m = low; m <= high; m++) if (!BLACK.has(m % 12)) pos.set(m, (x += ww) - ww);
  const cx = (m: number) => (BLACK.has(m % 12) ? pos.get(m - 1)! + ww : pos.get(m)! + ww / 2);
  const out = [];
  for (let m = low; m <= high; m++) {
    if (BLACK.has(m % 12)) continue;
    const l = lit.get(m);
    out.push(
      <g key={m}>
        <rect x={r2(pos.get(m)!)} y={y0} width={ww} height={r2(wh)} rx={2} className={'vl-white' + (l ? ' ' + l.cls : '')} />
        {m % 12 === 0 && !l && (
          <text x={r2(pos.get(m)! + ww / 2)} y={r2(y0 + wh - 5)} textAnchor="middle" className="vl-keylabel">
            {midiName(m)}
          </text>
        )}
      </g>,
    );
  }
  for (let m = low; m <= high; m++) {
    if (!BLACK.has(m % 12)) continue;
    const l = lit.get(m);
    out.push(<rect key={m} x={r2(cx(m) - bw / 2)} y={y0} width={r2(bw)} height={r2(bh)} rx={1.5} className={'vl-black' + (l ? ' ' + l.cls : '')} />);
  }
  // labels under lit keys
  for (const [m, l] of lit)
    if (l.label && m >= low && m <= high)
      out.push(
        <text key={'l' + m} x={r2(cx(m))} y={r2(y0 + wh + 13)} textAnchor="middle" className="vl-name">
          {l.label}
        </text>,
      );
  for (const mk of props.marks ?? [])
    if (mk.m >= low && mk.m <= high)
      out.push(
        <g key={'h' + mk.label}>
          <circle cx={r2(cx(mk.m))} cy={y0 - 7} r={6.5} className="vl-harm" />
          <text x={r2(cx(mk.m))} y={y0 - 3.5} textAnchor="middle" className="vl-harm-t">
            {mk.label}
          </text>
        </g>,
      );
  return { svg: out, width: x, cx, wh };
}

// ---------- the lab ----------

const PROGRESSIONS: Record<string, { label: string; chords: string[]; note: string }> = {
  pop: { label: 'C G Am F C', chords: ['C', 'G', 'Am', 'F', 'C'], note: 'I–V–vi–IV: the four chords under countless pop songs' },
  hymn: { label: 'C F G7 C', chords: ['C', 'F', 'G7', 'C'], note: 'I–IV–V7–I: the classic way home' },
  canon: { label: 'C G Am Em F C F G', chords: ['C', 'G', 'Am', 'Em', 'F', 'C', 'F', 'G'], note: 'the chords of Pachelbel’s Canon' },
  jazz: { label: 'Dm7 G7 Cmaj7', chords: ['Dm7', 'G7', 'Cmaj7'], note: 'ii7–V7–Imaj7: the core move of jazz harmony' },
};
const VOICE_NAMES = ['Bass', 'Tenor', 'Alto', 'Soprano'];
const QUALITY_ORDER: Quality[] = ['maj', 'min', 'dim', 'aug', 'maj7', '7', 'm7', 'm7b5', 'dim7'];

export default function VoicingLab(props: {
  initialMode?: Mode;
  modes?: Mode[];
  quality?: Quality;
  progression?: keyof typeof PROGRESSIONS;
}) {
  const modes = props.modes ?? ['diatonic', 'voicing', 'leading'];
  const [mode, setMode] = useState<Mode>(props.initialMode ?? modes[0]);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState<number | null>(null);

  // diatonic
  const [degree, setDegree] = useState(0);
  const [sevenths, setSevenths] = useState(false);
  // voicing
  const [quality, setQuality] = useState<Quality>(props.quality ?? 'maj');
  const [inversion, setInversion] = useState(0);
  const [spacing, setSpacing] = useState<Spacing>('close');
  const [root, setRoot] = useState(48);
  const [showHarm, setShowHarm] = useState(false);
  // leading
  const [prog, setProg] = useState<string>(props.progression ?? 'pop');
  const [style, setStyle] = useState<'smooth' | 'block'>('smooth');
  const [bassMode, setBassMode] = useState<'root' | 'smooth'>('root');
  const [focus, setFocus] = useState<number>(-1);

  const run = useRef<Run | null>(null);
  const hold = useRef<ChordHandle | null>(null);
  const timers = useRef<number[]>([]);

  const stop = useCallback(() => {
    run.current?.stop(0.2);
    run.current = null;
    hold.current?.stop();
    hold.current = null;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPlaying(false);
    setNow(null);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => stop, [mode, stop]);

  /** Schedule chords (lists of MIDI notes) one after another; optionally arpeggiate each first. */
  const playSeq = (chords: number[][], beat: number, opts: { arp?: boolean; gains?: (voice: number) => number } = {}) => {
    stop();
    const r = startRun(0.1);
    run.current = r;
    const wave = harmonicWave(r.ctx, 10, 1.5);
    const lead = (r.t0 - r.ctx.currentTime) * 1000;
    let t = 0;
    chords.forEach((ch, i) => {
      const last = i === chords.length - 1;
      const arpStep = opts.arp ? 0.16 : 0;
      ch.forEach((m, k) => {
        const g = (opts.gains?.(k) ?? (k === 0 ? 0.18 : 0.13)) * (4 / Math.max(4, ch.length));
        const start = r.t0 + t + k * arpStep;
        const end = r.t0 + t + ch.length * arpStep + beat - 0.05;
        note(r, { f: midiToHz(m), t: start, dur: Math.max(0.05, end - start) * (last ? 0.9 : 1), gain: g, attack: 0.03, release: last ? 1 : 0.12, wave });
      });
      timers.current.push(window.setTimeout(() => setNow(i), lead + t * 1000));
      t += ch.length * arpStep + beat;
    });
    timers.current.push(
      window.setTimeout(() => {
        run.current = null;
        setPlaying(false);
        setNow(null);
      }, lead + (t + 1) * 1000),
    );
    setPlaying(true);
  };

  // ---------- diatonic ----------
  const diatonic = useMemo(() => Array.from({ length: 7 }, (_, d) => diatonicChord(d, sevenths)), [sevenths]);
  const dChord = diatonic[degree];
  const dMidis = dChord.semis.map((s) => 48 + dChord.rootPc + s);

  // ---------- voicing ----------
  const qSemis = QUALITIES[quality].semis;
  const inv = Math.min(inversion, qSemis.length - 1);
  const voiced = useMemo(() => voiceChord(root, qSemis, inv, spacing), [root, qSemis, inv, spacing]);
  const rough = interaction(voiced) / ROUGH_REF;
  const rootName = NOTE_NAMES[root % 12];
  const spelled = spellChord(root % 12, qSemis, rootName);
  const vSymbol = rootName + QUALITIES[quality].suffix + (inv ? '/' + spelled[inv] : '');

  useEffect(() => {
    if (mode === 'voicing' && hold.current) hold.current.setFreqs(voiced.map(midiToHz));
  }, [voiced, mode]);

  // ---------- leading ----------
  const P = PROGRESSIONS[prog];
  const specs = useMemo(() => P.chords.map(parseSymbol), [P]);
  const voices = useMemo(() => leadVoices(specs, { style, bass: style === 'block' ? 'root' : bassMode }), [specs, style, bassMode]);
  const moves = voices.slice(1).map((v, i) => ({ semis: motion(voices[i], v), par: parallels(voices[i], v) }));
  const total = moves.reduce((s, m) => s + m.semis, 0);
  const totalPar = moves.reduce((s, m) => s + m.par.length, 0);

  const onPlay = () => {
    if (playing) return stop();
    if (mode === 'diatonic') {
      const all = [...diatonic.map((c) => c.semis.map((s) => 48 + c.rootPc + s)), diatonic[0].semis.map((s) => 60 + s)];
      playSeq(all, 0.75);
    } else if (mode === 'voicing') {
      stop();
      hold.current = playChord(SPEC, voiced.map(midiToHz));
      setPlaying(true);
    } else {
      playSeq(voices, 1.5, {
        gains: (k) => (focus < 0 ? (k === 0 ? 0.18 : 0.13) : k === focus ? 0.26 : 0.06),
      });
    }
  };

  const pickDegree = (d: number) => {
    setDegree(d);
    const c = diatonic[d];
    playSeq([c.semis.map((s) => 48 + c.rootPc + s)], 1.2, { arp: true });
  };

  // ---------- render ----------
  let body: ReactNode;
  let title = '';
  let caption: ReactNode;

  if (mode === 'diatonic') {
    title = 'Chords from a scale';
    const lit = new Map<number, Lit>(dMidis.map((m, i) => [m, { cls: i === 0 ? 'is-a' : 'is-b', label: spellChord(dChord.rootPc, dChord.semis, dChord.rootName)[i] }]));
    const kb = Keys({ low: 48, high: 84, lit, y0: 30, ww: 680 / 22 });
    body = (
      <>
        <div className="w-controls vl-degrees">
          {diatonic.map((c, d) => (
            <button key={d} type="button" className={'w-chip vl-deg' + (d === degree ? ' is-on' : '') + (now !== null && playing && now === d ? ' is-now' : '')} onClick={() => pickDegree(d)}>
              <span className="vl-roman">{c.roman}</span>
              <span>{c.symbol}</span>
            </button>
          ))}
        </div>
        <svg viewBox={`0 0 ${r2(kb.width)} ${r2(30 + kb.wh + 20)}`} className="w-keys" role="img" aria-label={`Keyboard showing ${dChord.symbol}`}>
          {kb.svg}
          {dMidis.slice(1).map((m, i) => {
            const a = kb.cx(dMidis[i]);
            const b = kb.cx(m);
            const gap = m - dMidis[i];
            return (
              <g key={i}>
                <path d={`M${r2(a)},26 Q${r2((a + b) / 2)},${4} ${r2(b)},26`} className="vl-arc" />
                <text x={r2((a + b) / 2)} y={12} textAnchor="middle" className={gap === 4 ? 'vl-gap is-major' : 'vl-gap'}>
                  {gap === 4 ? 'M3' : gap === 3 ? 'm3' : gap}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="w-controls">
          <PlayButton playing={playing} onClick={onPlay} label={playing ? 'Stop' : 'Play all seven in turn'} />
          <button type="button" className={'w-chip' + (sevenths ? ' is-on' : '')} aria-pressed={sevenths} onClick={() => setSevenths((s) => !s)}>
            Stack one more third (sevenths)
          </button>
        </div>
        <div className="w-readouts">
          <Readout label="Chord">
            <strong>{dChord.symbol}</strong> <span className="muted">({dChord.roman})</span>
          </Readout>
          <Readout label="Quality">{QUALITIES[dChord.q].label}</Readout>
          <Readout label="Thirds, bottom up">{dChord.semis.slice(1).map((s, i) => (s - dChord.semis[i] === 4 ? 'major' : 'minor')).join(' + ')}</Readout>
        </div>
      </>
    );
    caption = (
      <>
        Every chord here uses only the white keys: the notes of C major. Start on any note of the scale and take every
        other note (skip one, take one) and you get a stack of thirds. Whether each third is <strong>major</strong> (4
        semitones) or <strong>minor</strong> (3) depends on where in the scale you start, and that decides the chord's
        quality. Click a chord to hear it built from the bottom up. The Roman numeral names the scale degree it's built
        on: capitals for major chords, lower case for minor, ° for diminished.
      </>
    );
  } else if (mode === 'voicing') {
    title = 'One chord, many voicings';
    const harmMarks = showHarm
      ? Array.from({ length: 10 }, (_, k) => ({ m: Math.round(voiced[0] + 12 * Math.log2(k + 1)), label: String(k + 1) }))
      : [];
    const lit = new Map<number, Lit>(voiced.map((m, i) => [m, { cls: m % 12 === root % 12 ? 'is-a' : 'is-b', label: i === 0 ? midiName(m) : undefined }]));
    const kb = Keys({ low: 28, high: 96, lit, y0: 22, ww: 680 / 41, marks: harmMarks });
    const gaps = voiced.slice(1).map((m, i) => m - voiced[i]);
    body = (
      <>
        <div className="w-controls">
          <PlayButton playing={playing} onClick={onPlay} label={playing ? 'Stop' : 'Hold the chord'} />
          <Segmented
            label="Chord"
            value={quality}
            options={QUALITY_ORDER.map((q) => ({ value: q, label: QUALITIES[q].suffix || 'maj' }))}
            onChange={(q) => {
              setQuality(q);
              if (QUALITIES[q].semis.length === 3 && inversion > 2) setInversion(2);
            }}
          />
        </div>
        <div className="w-controls">
          <Segmented
            label="In the bass"
            value={inv}
            options={[
              { value: 0, label: 'Root' },
              { value: 1, label: '3rd' },
              { value: 2, label: '5th' },
              ...(qSemis.length === 4 ? [{ value: 3, label: '7th' }] : []),
            ]}
            onChange={setInversion}
          />
          <Segmented
            label="Spacing"
            value={spacing}
            options={[
              { value: 'close', label: 'Close' },
              { value: 'open', label: 'Open' },
              { value: 'spread', label: 'Spread' },
            ]}
            onChange={setSpacing}
          />
          <button type="button" className={'w-chip' + (showHarm ? ' is-on' : '')} aria-pressed={showHarm} onClick={() => setShowHarm((s) => !s)}>
            Show the bass note's harmonics
          </button>
        </div>
        <svg viewBox={`0 0 ${r2(kb.width)} ${r2(22 + kb.wh + 18)}`} className="w-keys" role="img" aria-label={`Keyboard showing a voicing of ${vSymbol}`}>
          {kb.svg}
        </svg>
        <Slider label="Root" min={28} max={55} step={1} value={root} onChange={setRoot} display={midiName(root)} />
        <div className="w-readouts">
          <Readout label="Chord">
            <strong>{vSymbol}</strong> <span className="muted">({QUALITIES[quality].label.toLowerCase()})</span>
          </Readout>
          <Readout label="Notes, bottom up">{voiced.map(midiName).join(' ')}</Readout>
          <Readout label="Gaps, bottom up">{gaps.map(gapLabel).join(' · ')}</Readout>
        </div>
        <div className="vl-rough">
          <span className="w-label">Roughness</span>
          <svg viewBox="0 0 400 14" className="vl-rough-bar" aria-hidden>
            <rect x={0} y={2} width={400} height={10} rx={3} className="vl-track" />
            <rect x={0} y={2} width={r2(Math.max(2, Math.min(400, 400 * rough)))} height={10} rx={3} className="fill-rough" />
          </svg>
          <span className="w-value">{Math.round(rough * 100)}%</span>
        </div>
      </>
    );
    caption = (
      <>
        <span className="key-a">Root</span> and <span className="key-b">other chord tones</span>. The same chord can be
        laid out in many ways. <strong>In the bass</strong> chooses which chord tone is lowest (the inversions).{' '}
        <strong>Spacing</strong>: <em>close</em> packs the notes together, <em>open</em> skips a chord tone each time,
        and <em>spread</em> puts wide gaps at the bottom and narrow ones at the top. Turn on the bass note's harmonics
        to see why spread voicings sound so clear: they copy the shape of the harmonic series. The bar is the chord's
        roughness from the chapter 1.5 model, where 100% is a close C major chord with its root at C2. Hold the chord
        and drag the root down to hear close voicings get muddy.
      </>
    );
  } else {
    title = 'How chords move';
    const W = 680;
    const H = 230;
    const LO = 34;
    const HI = 82;
    const top = 34;
    const bottom = 196;
    const y = (m: number) => r2(bottom - ((m - LO) / (HI - LO)) * (bottom - top));
    const colW = (W - 40) / voices.length;
    const bw = colW * 0.56;
    const x0 = (i: number) => 30 + i * colW + (colW - bw) / 2;
    const vClass = ['vl-v0', 'vl-v1', 'vl-v2', 'vl-v3'];
    body = (
      <>
        <div className="w-controls">
          <PlayButton playing={playing} onClick={onPlay} />
          <Segmented label="Progression" value={prog} options={Object.entries(PROGRESSIONS).map(([k, v]) => ({ value: k, label: v.label }))} onChange={setProg} />
        </div>
        <div className="w-controls">
          <Segmented
            label="Voicing"
            value={style}
            options={[
              { value: 'smooth', label: 'Smooth voice leading' },
              { value: 'block', label: 'Block chords' },
            ]}
            onChange={setStyle}
          />
          {style === 'smooth' && (
            <Segmented
              label="Bass"
              value={bassMode}
              options={[
                { value: 'root', label: 'Roots' },
                { value: 'smooth', label: 'Allow inversions' },
              ]}
              onChange={setBassMode}
            />
          )}
          <Segmented
            label="Bring out"
            value={focus}
            options={[{ value: -1, label: 'All' }, ...[3, 2, 1, 0].map((v) => ({ value: v, label: VOICE_NAMES[v] }))]}
            onChange={setFocus}
          />
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="Four voices moving through a chord progression">
          {[36, 48, 60, 72].map((m) => (
            <g key={m}>
              <line x1={26} x2={W - 8} y1={y(m)} y2={y(m)} className="stroke-grid" />
              <text x={2} y={y(m) + 4} className="w-tick">
                {midiName(m)}
              </text>
            </g>
          ))}
          {voices.map((v, i) => (
            <g key={i}>
              <rect x={r2(x0(i) - 6)} y={4} width={r2(bw + 12)} height={bottom - 4 + 8} rx={6} className={'vl-col' + (now === i ? ' is-now' : '')} />
              <text x={r2(x0(i) + bw / 2)} y={22} textAnchor="middle" className="chord-name">
                {slashSymbol(specs[i], v[0])}
              </text>
              {v.map((m, k) => (
                <g key={k}>
                  <line x1={r2(x0(i))} x2={r2(x0(i) + bw)} y1={y(m)} y2={y(m)} className={'vl-seg ' + vClass[k] + (focus >= 0 && focus !== k ? ' is-dim' : '')} />
                  {focus === k && (
                    <text x={r2(x0(i) + bw / 2)} y={y(m) - 5} textAnchor="middle" className="w-tick">
                      {midiName(m)}
                    </text>
                  )}
                </g>
              ))}
            </g>
          ))}
          {moves.map((mv, i) => {
            const a = voices[i];
            const b = voices[i + 1];
            const xa = x0(i) + bw;
            const xb = x0(i + 1);
            const bad = new Set(mv.par.flatMap((p) => [p.lo, p.hi]));
            return (
              <g key={i}>
                {a.map((m, k) => (
                  <line
                    key={k}
                    x1={r2(xa)}
                    x2={r2(xb)}
                    y1={y(m)}
                    y2={y(b[k])}
                    className={'vl-link ' + (bad.has(k) ? 'is-par' : m === b[k] ? 'is-held ' + vClass[k] : vClass[k]) + (focus >= 0 && focus !== k ? ' is-dim' : '')}
                  />
                ))}
                <text x={r2((xa + xb) / 2)} y={bottom + 20} textAnchor="middle" className={mv.par.length ? 'w-tick key-rough' : 'w-tick'}>
                  {mv.semis} st{mv.par.length ? ` · ${mv.par.length} par.` : ''}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="w-readouts">
          <Readout label="Progression">
            {P.label} <span className="muted">({specs.map((s) => s.roman).join('–')})</span>
          </Readout>
          <Readout label="Total motion">{total} semitones</Readout>
          <Readout label="Parallel 5ths/8ves">
            <span className={totalPar ? 'key-rough' : 'key-match'}>{totalPar}</span>
          </Readout>
        </div>
      </>
    );
    caption = (
      <>
        {P.note}. Each chord is four voices: <span className="vl-k0">bass</span>, <span className="vl-k1">tenor</span>,{' '}
        <span className="vl-k2">alto</span>, <span className="vl-k3">soprano</span> (top). Lines show where each voice
        goes; a flat line is a held <strong>common tone</strong>. Under each move: the total distance the voices travel,
        in semitones (st), and the number of <span className="key-rough">parallel fifths or octaves</span> (par., dashed red lines).{' '}
        <em>Block chords</em> moves the same hand shape up and down. <em>Smooth voice leading</em> is computed: of all
        the ways to voice the next chord, the lab picks the one with the least total motion and no parallels. Use{' '}
        <strong>Bring out</strong> to hear what one voice is doing.
      </>
    );
  }

  return (
    <Widget kicker="Lab" title={title} caption={caption}>
      {modes.length > 1 && (
        <div className="w-controls">
          <Segmented
            label="Lab"
            value={mode}
            options={modes.map((m) => ({ value: m, label: m === 'diatonic' ? 'Building' : m === 'voicing' ? 'Voicing' : 'Voice leading' }))}
            onChange={setMode}
          />
        </div>
      )}
      {body}
    </Widget>
  );
}

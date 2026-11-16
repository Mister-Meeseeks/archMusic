// An echo that fills the grid. A sequencer plays a bass pattern in eighth
// notes; a real delay line (DelayNode) repeats every note once, a fixed time
// later. Set to a sixteenth, the repeats land exactly in the gaps, and the
// ear hears an unbroken stream of sixteenths that nobody played. Options:
// other delay times (an eighth doubles the notes instead of filling the gaps;
// a dotted eighth fills them with an earlier note), dry and echo split left
// and right, a four-on-the-floor kick and an off-beat hi-hat (made from
// filtered noise, the way a synthesizer makes one), and transposing the whole
// pattern by "pressing a different key". The grid is computed from the same
// settings the audio uses.

import { useCallback, useEffect, useRef, useState } from 'react';
import { loop, startRun, type Run } from '../../lib/sequence';
import { DEFAULT_SYNTH, SYNTH_PRESETS, synthVoice, type SynthParams } from '../../lib/synth';
import { midiToHz } from '../../lib/tuning';
import { PlayButton, Readout, Segmented, Slider, Widget, r2, useAudioOwner } from './ui';

type Echo = 0 | 1 | 2 | 3; // delay in sixteenths (0 = off)
type PatternId = 'octaves' | 'arp';

const PATTERNS: Record<PatternId, { label: string; notes: number[] }> = {
  octaves: { label: 'Octaves', notes: [0, 12, 0, 12, 0, 12, 0, 12] },
  arp: { label: 'Root, octave, fifth, seventh', notes: [0, 12, 0, 12, 7, 12, 10, 12] },
};
const ROOTS = [
  { value: 0, label: 'C' },
  { value: 3, label: 'E♭' },
  { value: 5, label: 'F' },
  { value: 7, label: 'G' },
];
const BASE = 36; // C2
const BASS: SynthParams = { ...DEFAULT_SYNTH, ...(SYNTH_PRESETS.find((p) => p.id === 'seqbass')?.p ?? {}) };

// ---- drawing ----
const W = 680;
const LX = 78; // label column
const GX1 = W - 12;
const STEPS = 16;
const SW = (GX1 - LX) / STEPS;
const Y_HAT = 30;
const Y_KICK = 54;
const BASS_TOP = 78;
const BASS_H = 92;
const H = BASS_TOP + BASS_H + 30;
const py = (semis: number) => r2(BASS_TOP + BASS_H - 10 - (semis / 12) * (BASS_H - 24));

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 0.5);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuf = b);
}

function kick(ctx: BaseAudioContext, dest: AudioNode, t: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.55, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.35);
  o.onended = () => g.disconnect();
}

function hat(ctx: BaseAudioContext, dest: AudioNode, t: number) {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  s.connect(hp).connect(g).connect(dest);
  s.start(t, Math.random() * 0.3);
  s.stop(t + 0.13);
  s.onended = () => g.disconnect();
}

type Nodes = { dry: StereoPannerNode; delay: DelayNode; wet: GainNode; wetPan: StereoPannerNode };

export default function EchoLab(props: { echo?: Echo; drums?: boolean }) {
  const [echo, setEcho] = useState<Echo>(props.echo ?? 0);
  const [tempo, setTempo] = useState(124);
  const [pattern, setPattern] = useState<PatternId>('octaves');
  const [root, setRoot] = useState(0);
  const [cycle, setCycle] = useState(false);
  const [split, setSplit] = useState(false);
  const [kickOn, setKickOn] = useState(props.drums ?? false);
  const [hatOn, setHatOn] = useState(props.drums ?? false);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState<{ step: number; root: number } | null>(null);

  const params = useRef({ echo, tempo, pattern, root, cycle, kickOn, hatOn });
  params.current = { echo, tempo, pattern, root, cycle, kickOn, hatOn };
  const run = useRef<Run | null>(null);
  const nodes = useRef<Nodes | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const marks = useRef<{ t: number; step: number; root: number }[]>([]);
  const raf = useRef(0);

  const sixteenth = (bpm: number) => 60 / bpm / 4;

  const stop = useCallback(() => {
    cancel.current?.();
    cancel.current = null;
    run.current?.stop(0.06);
    run.current = null;
    nodes.current = null;
    cancelAnimationFrame(raf.current);
    marks.current = [];
    setPlaying(false);
    setNow(null);
  }, []);
  useAudioOwner(playing, stop);

  // live parameter changes → the audio graph
  useEffect(() => {
    const n = nodes.current;
    const r = run.current;
    if (!n || !r) return;
    const t = r.ctx.currentTime;
    n.wet.gain.setTargetAtTime(echo ? 0.8 : 0, t, 0.01);
    if (echo) n.delay.delayTime.setTargetAtTime(echo * sixteenth(tempo), t, 0.01);
    n.dry.pan.setTargetAtTime(split ? -0.9 : 0, t, 0.02);
    n.wetPan.pan.setTargetAtTime(split ? 0.9 : 0, t, 0.02);
  }, [echo, tempo, split]);

  const play = () => {
    if (playing) return stop();
    const r = startRun(0.1);
    run.current = r;
    const { ctx } = r;
    const bassIn = ctx.createGain();
    const dry = ctx.createStereoPanner();
    const delay = ctx.createDelay(1.5);
    const wet = ctx.createGain();
    const wetPan = ctx.createStereoPanner();
    const p0 = params.current;
    delay.delayTime.value = Math.max(1, p0.echo) * sixteenth(p0.tempo);
    wet.gain.value = p0.echo ? 0.8 : 0;
    dry.pan.value = split ? -0.9 : 0;
    wetPan.pan.value = split ? 0.9 : 0;
    bassIn.connect(dry).connect(r.bus);
    bassIn.connect(delay).connect(wet).connect(wetPan).connect(r.bus);
    nodes.current = { dry, delay, wet, wetPan };

    let bar = 0;
    let barRoot = p0.root;
    cancel.current = loop(r, (t, i) => {
      const p = params.current;
      const step = i % STEPS;
      if (step === 0) {
        bar = Math.floor(i / STEPS);
        barRoot = p.cycle ? ROOTS[Math.floor(bar / 2) % ROOTS.length].value : p.root;
      }
      const dt = sixteenth(p.tempo);
      if (step % 2 === 0) {
        const semis = PATTERNS[p.pattern].notes[step / 2];
        synthVoice(ctx, bassIn, BASS, midiToHz(BASE + barRoot + semis), t, dt * 1.6);
      }
      if (p.kickOn && step % 4 === 0) kick(ctx, r.bus, t);
      if (p.hatOn && step % 4 === 2) hat(ctx, r.bus, t);
      marks.current.push({ t, step, root: barRoot });
      if (marks.current.length > 48) marks.current.splice(0, marks.current.length - 48);
      return dt;
    });
    const frame = () => {
      if (!run.current) return;
      const tnow = r.ctx.currentTime;
      let cur: { step: number; root: number } | null = null;
      for (const m of marks.current) if (m.t <= tnow) cur = { step: m.step, root: m.root };
      setNow((prev) => (prev && cur && prev.step === cur.step && prev.root === cur.root ? prev : cur));
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    setPlaying(true);
  };

  // ---- what to draw ----
  const notes = PATTERNS[pattern].notes;
  const dry = notes.map((s, k) => ({ step: 2 * k, semis: s }));
  const echoes = echo ? dry.map((n) => ({ step: (n.step + echo) % STEPS, semis: n.semis, wrapped: n.step + echo >= STEPS })) : [];
  const heard = new Set([...dry.map((n) => n.step), ...echoes.map((n) => n.step)]);
  const shownRoot = now?.root ?? (cycle ? 0 : root);
  const rootName = ROOTS.find((r) => r.value === shownRoot)?.label ?? 'C';
  const ms = Math.round(echo * sixteenth(tempo) * 1000);
  const cx = (step: number) => r2(LX + step * SW);
  const COUNT = ['1', 'e', '+', 'a', '2', 'e', '+', 'a', '3', 'e', '+', 'a', '4', 'e', '+', 'a'];

  return (
    <Widget
      kicker="Lab"
      title="Eighth notes plus an echo"
      caption={
        <>
          One bar, divided into sixteen sixteenth-note slots (counted "1 e + a, 2 e + a…"). The sequencer plays only
          the <strong className="key-a">filled</strong> notes, one every eighth note. The{' '}
          <strong className="key-b">outlined</strong> notes are the echo: a delay line repeating each note once, a
          fixed time later. The kick and hi-hat rows show the drum layers when they're on. The bass pattern is a
          generic octave-bouncing figure, not a transcription of any record.
        </>
      }
    >
      <div className="w-controls">
        <PlayButton playing={playing} onClick={play} />
        <Segmented
          label="Echo"
          value={echo}
          onChange={(v) => setEcho(v as Echo)}
          options={[
            { value: 0, label: 'Off' },
            { value: 1, label: 'A sixteenth' },
            { value: 2, label: 'An eighth' },
            { value: 3, label: 'A dotted eighth' },
          ]}
        />
      </div>
      <div className="w-controls">
        <button type="button" className={'w-chip' + (split ? ' is-on' : '')} aria-pressed={split} onClick={() => setSplit((v) => !v)}>
          Notes left, echo right
        </button>
        <button type="button" className={'w-chip' + (kickOn ? ' is-on' : '')} aria-pressed={kickOn} onClick={() => setKickOn((v) => !v)}>
          Kick on every beat
        </button>
        <button type="button" className={'w-chip' + (hatOn ? ' is-on' : '')} aria-pressed={hatOn} onClick={() => setHatOn((v) => !v)}>
          Off-beat hi-hat
        </button>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-plot" role="img" aria-label="One bar of the bass pattern, its echo, and the drum layers on a sixteenth-note grid">
        {Array.from({ length: STEPS + 1 }, (_, s) => (
          <line key={'g' + s} x1={cx(s)} x2={cx(s)} y1={16} y2={H - 22} className="stroke-grid" strokeWidth={s % 4 === 0 ? 1.6 : 1} />
        ))}
        {now && <rect x={cx(now.step)} y={16} width={r2(SW)} height={H - 38} className="echo-now" />}
        {COUNT.map((c, s) => (
          <text key={'c' + s} x={r2(cx(s) + SW / 2)} y={H - 8} textAnchor="middle" className="w-tick" fontWeight={s % 4 === 0 ? 700 : 400}>
            {c}
          </text>
        ))}
        <text x={8} y={Y_HAT + 4} className="w-tick">Hi-hat</text>
        <text x={8} y={Y_KICK + 4} className="w-tick">Kick</text>
        <text x={8} y={BASS_TOP + 18} className="w-tick">Bass</text>
        <text x={8} y={BASS_TOP + 34} className="w-tick">on {rootName}</text>
        {[2, 6, 10, 14].map((s) => (
          <rect key={'h' + s} x={r2(cx(s) + SW * 0.3)} y={Y_HAT - 6} width={r2(SW * 0.4)} height={12} rx={2} className={hatOn ? 'echo-drum' : 'echo-drum is-off'} />
        ))}
        {[0, 4, 8, 12].map((s) => (
          <circle key={'k' + s} cx={r2(cx(s) + SW / 2)} cy={Y_KICK} r={7} className={kickOn ? 'echo-drum' : 'echo-drum is-off'} />
        ))}
        <line x1={LX} x2={GX1} y1={py(0)} y2={py(0)} className="stroke-grid" strokeDasharray="2 4" />
        <line x1={LX} x2={GX1} y1={py(12)} y2={py(12)} className="stroke-grid" strokeDasharray="2 4" />
        {echoes.map((n, k) => (
          <rect key={'e' + k} x={r2(cx(n.step) + 3)} y={r2(py(n.semis) - 6)} width={r2(SW - 6)} height={12} rx={3} className="echo-wet" />
        ))}
        {dry.map((n, k) => (
          <rect key={'d' + k} x={r2(cx(n.step) + 3)} y={r2(py(n.semis) - 6)} width={r2(SW - 6)} height={12} rx={3} className="echo-dry" />
        ))}
      </svg>

      <div className="w-controls">
        <Readout label="Notes played per bar">8</Readout>
        <Readout label="Slots you hear filled">{heard.size} of 16</Readout>
        <Readout label="Echo time">{echo ? `${ms} ms` : 'none'}</Readout>
      </div>
      <div className="w-controls">
        <Segmented label="Pattern" value={pattern} onChange={(v) => setPattern(v as PatternId)} options={(Object.keys(PATTERNS) as PatternId[]).map((k) => ({ value: k, label: PATTERNS[k].label }))} />
      </div>
      <div className="w-controls">
        <Segmented label="Key pressed" value={cycle ? -1 : root} onChange={(v) => { setCycle(false); setRoot(v as number); }} options={ROOTS} />
        <button type="button" className={'w-chip' + (cycle ? ' is-on' : '')} aria-pressed={cycle} onClick={() => setCycle((v) => !v)}>
          Change key every two bars
        </button>
        <Slider label="Tempo" value={tempo} min={100} max={140} step={1} onChange={setTempo} display={`${tempo} BPM`} />
      </div>
    </Widget>
  );
}

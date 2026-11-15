// Two pure tones, pulled apart: unison -> beating -> roughness -> two smooth tones.
// Reused later for: tuning by ear (Vol III), gamelan ombak, chorus/detune (Vol IV).

import { useCallback, useMemo, useRef, useState } from 'react';
import { AdditiveVoice } from '../../lib/audio';
import { erb, pairRoughness, sine } from '../../lib/dissonance';
import { PlayButton, Readout, Segmented, Slider, Widget, scale, useAudioOwner } from './ui';

const MAX_DF = 150;
const W = 640;

function zone(df: number, peak: number): { label: string; detail: string } {
  if (df < 0.5) return { label: 'Unison', detail: 'One steady tone.' };
  if (df < 12) return { label: 'Beating', detail: `You can count the pulses: ${df.toFixed(1)} per second.` };
  if (df < peak * 3) return { label: 'Roughness', detail: 'Too fast to count; heard as a buzzy, grainy texture.' };
  return { label: 'Two tones', detail: 'The ear resolves two separate, smooth pitches.' };
}

export default function BeatingLab({ initialDf = 3 }: { initialDf?: number }) {
  const [base, setBase] = useState(440);
  const [pos, setPos] = useState(Math.sqrt(initialDf / MAX_DF));
  const [playing, setPlaying] = useState(false);
  const voices = useRef<AdditiveVoice[] | null>(null);

  const df = MAX_DF * pos * pos; // quadratic slider: fine control near unison
  const f2 = base + df;

  // Where the roughness curve peaks for this register (analytic max of the model).
  const s = 0.24 / (0.0207 * base + 18.96);
  const peak = Math.log(5.75 / 3.51) / ((5.75 - 3.51) * s);

  const stop = useCallback(() => {
    voices.current?.forEach((v) => v.stop());
    voices.current = null;
    setPlaying(false);
  }, []);
  useAudioOwner(playing, stop);

  const toggle = () => {
    if (playing) return stop();
    voices.current = [new AdditiveVoice(sine, base, 0.5), new AdditiveVoice(sine, f2, 0.5)];
    voices.current.forEach((v) => v.start());
    setPlaying(true);
  };

  const update = (nextBase: number, nextPos: number) => {
    setBase(nextBase);
    setPos(nextPos);
    if (voices.current) {
      voices.current[0].setF0(nextBase);
      voices.current[1].setF0(nextBase + MAX_DF * nextPos * nextPos);
    }
  };

  // Waveform of the sum over a 0.5 s window, plus its envelope 2|cos(pi*df*t)|.
  const wave = useMemo(() => {
    const T = 0.5;
    const N = 1600;
    const x = scale(0, T, 0, W);
    const y = scale(-2, 2, 110, 10);
    let d = '';
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * T;
      const v = Math.sin(2 * Math.PI * base * t) + Math.sin(2 * Math.PI * f2 * t);
      d += (i ? 'L' : 'M') + x(t).toFixed(1) + ' ' + y(v).toFixed(1);
    }
    let env = '';
    for (let i = 0; i <= 400; i++) {
      const t = (i / 400) * T;
      env += (i ? 'L' : 'M') + x(t).toFixed(1) + ' ' + y(2 * Math.abs(Math.cos(Math.PI * df * t))).toFixed(1);
    }
    return { d, env };
  }, [base, f2, df]);

  // Roughness vs. frequency difference for this register.
  const curve = useMemo(() => {
    const x = scale(0, MAX_DF, 0, W);
    const maxR = pairRoughness(base, 1, base + peak, 1);
    const y = scale(0, maxR, 90, 10);
    let d = '';
    for (let i = 0; i <= 300; i++) {
      const dfi = (i / 300) * MAX_DF;
      d += (i ? 'L' : 'M') + x(dfi).toFixed(1) + ' ' + y(pairRoughness(base, 1, base + dfi, 1)).toFixed(1);
    }
    return { d, x, y, maxR };
  }, [base, peak]);

  const z = zone(df, peak);
  const band = erb(base);

  return (
    <Widget
      kicker="Lab"
      title="Two pure tones, pulled apart"
      caption={
        <>
          Top: the combined waveform over half a second (the dashed line is its envelope, the loudness you hear
          pulsing). Bottom: modeled roughness against frequency difference. The shaded region is one critical band (ERB ≈{' '}
          {band.toFixed(0)} Hz at {base} Hz). Change the register and watch the band and the roughness peak move.
        </>
      }
    >
      <div className="w-controls">
        <PlayButton playing={playing} onClick={toggle} />
        <Segmented
          label="Lower tone"
          value={base}
          options={[
            { value: 110, label: '110 Hz' },
            { value: 220, label: '220 Hz' },
            { value: 440, label: '440 Hz' },
            { value: 880, label: '880 Hz' },
          ]}
          onChange={(b) => update(b, pos)}
        />
      </div>
      <Slider
        label="Difference"
        min={0}
        max={1}
        value={pos}
        onChange={(p) => update(base, p)}
        display={`${df.toFixed(1)} Hz`}
      />
      <div className="w-readouts">
        <Readout label="Tones">
          {base} + {f2.toFixed(1)} Hz
        </Readout>
        <Readout label="You should hear">
          <strong>{z.label}</strong>. {z.detail}
        </Readout>
      </div>

      <svg viewBox={`0 0 ${W} 120`} className="w-plot" role="img" aria-label="Combined waveform">
        <path d={wave.d} className="stroke-a thin" />
        <path d={wave.env} className="stroke-ink dashed" />
      </svg>

      <svg viewBox={`0 0 ${W} 112`} className="w-plot" role="img" aria-label="Roughness curve">
        <rect x={0} y={10} width={curve.x(Math.min(band, MAX_DF))} height={80} className="fill-band" />
        <path d={curve.d} className="stroke-rough" />
        <line x1={curve.x(df)} x2={curve.x(df)} y1={6} y2={92} className="stroke-ink" />
        <circle cx={curve.x(df)} cy={curve.y(pairRoughness(base, 1, f2, 1))} r={5} className="fill-ink" />
        {[0, 25, 50, 75, 100, 125, 150].map((t) => (
          <text key={t} x={curve.x(t)} y={106} className="w-tick" textAnchor={t === 0 ? 'start' : t === 150 ? 'end' : 'middle'}>
            {t} Hz
          </text>
        ))}
        <text x={W - 6} y={22} textAnchor="end" className="w-tick">
          peak ≈ {peak.toFixed(0)} Hz apart
        </text>
      </svg>
    </Widget>
  );
}

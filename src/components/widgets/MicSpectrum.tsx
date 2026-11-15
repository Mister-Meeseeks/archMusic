// Live spectrum of your microphone (or a demo tone). Sing a steady note and
// watch the harmonics appear as evenly spaced peaks; the estimated
// fundamental's multiples are marked so you can see them line up. Change the
// vowel and watch the heights change while the positions stay put.
//
// Privacy: audio is analyzed in the browser and never recorded or sent.
// The microphone is only requested when you press the button.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAudio } from '../../lib/audio';
import { RECIPES, detectPitch, padRecipe, periodicWave, recipeGain } from '../../lib/spectrum';
import { midiName } from '../../lib/tuning';
import { Segmented, Widget, useAudioOwner } from './ui';

const W = 680;
const H = 220;
const F_MIN = 60;
const F_MAX = 5000;

type Source = 'off' | 'mic' | 'demo';

export default function MicSpectrum() {
  const [source, setSource] = useState<Source>('off');
  const [error, setError] = useState<string | null>(null);
  const [f0, setF0] = useState<number | null>(null);
  const [demoRecipe, setDemoRecipe] = useState('saw');
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<{
    analyser?: AnalyserNode;
    stream?: MediaStream;
    src?: AudioNode;
    osc?: OscillatorNode;
    gain?: GainNode;
    raf?: number;
  }>({});

  const teardown = useCallback(() => {
    const l = live.current;
    if (l.raf) cancelAnimationFrame(l.raf);
    l.stream?.getTracks().forEach((t) => t.stop());
    if (l.osc) {
      const { ctx } = getAudio();
      l.gain?.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      l.osc.stop(ctx.currentTime + 0.2);
    }
    l.src?.disconnect();
    live.current = {};
    setF0(null);
  }, []);

  const stop = useCallback(() => {
    teardown();
    setSource('off');
  }, [teardown]);
  // Only the demo tone makes sound, so only it takes part in "one widget at a time".
  useAudioOwner(source === 'demo', stop);
  useEffect(() => () => teardown(), [teardown]);

  const makeAnalyser = () => {
    const { ctx } = getAudio();
    const a = ctx.createAnalyser();
    a.fftSize = 16384;
    a.smoothingTimeConstant = 0.55;
    a.minDecibels = -100;
    a.maxDecibels = -20;
    return a;
  };

  const startMic = async () => {
    teardown();
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const { ctx } = getAudio();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = makeAnalyser();
      src.connect(analyser); // deliberately NOT connected to the speakers (no feedback)
      live.current = { stream, src, analyser };
      setSource('mic');
      draw();
    } catch (e) {
      setError(
        (e as Error)?.name === 'NotAllowedError'
          ? 'Microphone permission was denied. You can allow it in the browser’s site settings, or use the demo tone.'
          : 'Couldn’t open a microphone. Use the demo tone instead.',
      );
      setSource('off');
    }
  };

  const startDemo = (id = demoRecipe) => {
    teardown();
    setError(null);
    const { ctx, out } = getAudio();
    const amps = padRecipe(RECIPES.find((r) => r.id === id)!.amps);
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(periodicWave(amps, []));
    osc.frequency.value = 220;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(recipeGain(amps), ctx.currentTime, 0.03);
    const analyser = makeAnalyser();
    osc.connect(gain);
    gain.connect(out);
    gain.connect(analyser);
    osc.start();
    live.current = { osc, gain, analyser, src: gain };
    setSource('demo');
    draw();
  };

  const draw = () => {
    const l = live.current;
    const c = canvas.current;
    if (!l.analyser || !c) return;
    const { ctx } = getAudio();
    const g = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr;
    c.height = H * dpr;
    g.scale(dpr, dpr);
    const css = getComputedStyle(c);
    const col = (v: string) => css.getPropertyValue(v).trim() || '#888';
    const spec = new Float32Array(l.analyser.frequencyBinCount);
    const time = new Float32Array(4096);
    const binHz = ctx.sampleRate / l.analyser.fftSize;
    const fx = (f: number) => 34 + (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * (W - 44);
    const dy = (db: number) => 10 + (1 - (db + 100) / 80) * (H - 40);
    let smoothF0: number | null = null;
    let lastLabel = 0;

    const frame = () => {
      const a = live.current.analyser;
      if (!a) return;
      a.getFloatFrequencyData(spec);
      a.getFloatTimeDomainData(time);
      const est = detectPitch(time, ctx.sampleRate);
      if (est) smoothF0 = smoothF0 && Math.abs(Math.log2(est / smoothF0)) < 0.05 ? smoothF0 * 0.8 + est * 0.2 : est;
      else smoothF0 = null;
      const now = performance.now();
      if (now - lastLabel > 150) {
        setF0(smoothF0);
        lastLabel = now;
      }

      g.clearRect(0, 0, W, H);
      g.fillStyle = col('--bg');
      g.fillRect(0, 0, W, H);
      // frequency grid
      g.font = '11px Inter, system-ui, sans-serif';
      g.fillStyle = col('--muted');
      g.strokeStyle = col('--grid');
      g.lineWidth = 1;
      for (const f of [100, 200, 500, 1000, 2000, 5000]) {
        const x = fx(f);
        g.beginPath();
        g.moveTo(x, 10);
        g.lineTo(x, H - 30);
        g.stroke();
        g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x - 8, H - 14);
      }
      g.fillText('Hz', W - 22, H - 14);
      // harmonic markers
      if (smoothF0) {
        g.strokeStyle = col('--tone-b');
        g.fillStyle = col('--tone-b');
        g.setLineDash([3, 4]);
        for (let n = 1; n <= 16 && n * smoothF0 < F_MAX; n++) {
          const x = fx(n * smoothF0);
          g.beginPath();
          g.moveTo(x, 18);
          g.lineTo(x, H - 30);
          g.stroke();
          if (n <= 10) g.fillText(String(n), x - 3, 14);
        }
        g.setLineDash([]);
      }
      // spectrum
      g.strokeStyle = col('--tone-a');
      g.lineWidth = 1.5;
      g.beginPath();
      let started = false;
      for (let px = 34; px <= W - 10; px++) {
        const f = F_MIN * Math.pow(F_MAX / F_MIN, (px - 34) / (W - 44));
        const f2 = F_MIN * Math.pow(F_MAX / F_MIN, (px + 1 - 34) / (W - 44));
        // take the max over the bins this pixel covers, so narrow peaks aren't lost
        let db = -120;
        for (let b = Math.floor(f / binHz); b <= Math.max(Math.floor(f / binHz), Math.floor(f2 / binHz)); b++) db = Math.max(db, spec[b] ?? -120);
        const y = Math.max(10, Math.min(H - 30, dy(db)));
        if (!started) {
          g.moveTo(px, y);
          started = true;
        } else g.lineTo(px, y);
      }
      g.stroke();
      live.current.raf = requestAnimationFrame(frame);
    };
    live.current.raf = requestAnimationFrame(frame);
  };

  return (
    <Widget
      kicker="Lab"
      title="Your voice, as a spectrum"
      caption={
        <>
          A live spectrum: frequency runs left to right (on a log scale, like a piano keyboard) and height shows
          strength. When there's a steady pitch, its harmonics are marked with dashed orange lines numbered 1, 2,
          3… Audio is analyzed in your browser and never recorded or sent anywhere. No microphone? Use the demo tone.
        </>
      }
    >
      <div className="w-controls">
        <button type="button" className={'w-play' + (source === 'mic' ? ' is-playing' : '')} onClick={() => (source === 'mic' ? stop() : startMic())}>
          <span className="w-play-icon" aria-hidden>
            {source === 'mic' ? '■' : '●'}
          </span>
          {source === 'mic' ? 'Stop microphone' : 'Use microphone'}
        </button>
        <button type="button" className={'w-play small' + (source === 'demo' ? ' is-playing' : '')} onClick={() => (source === 'demo' ? stop() : startDemo())}>
          <span className="w-play-icon" aria-hidden>
            {source === 'demo' ? '■' : '▶'}
          </span>
          {source === 'demo' ? 'Stop demo' : 'Demo tone'}
        </button>
        {source === 'demo' && (
          <Segmented
            label="Demo"
            value={demoRecipe}
            options={RECIPES.filter((r) => r.id !== 'sine').map((r) => ({ value: r.id, label: r.label }))}
            onChange={(id) => {
              setDemoRecipe(id);
              startDemo(id);
            }}
          />
        )}
      </div>
      {error && <p className="w-note w-warn">{error}</p>}
      <canvas ref={canvas} className="w-canvas" style={{ aspectRatio: `${W} / ${H}` }} />
      <div className="w-readouts">
        <span className="w-readout">
          <span className="w-label">Pitch</span>
          <span className="w-readout-value">
            {source === 'off' ? '—' : f0 ? `${f0.toFixed(1)} Hz · near ${midiName(69 + 12 * Math.log2(f0 / 440))}` : 'no steady pitch'}
          </span>
        </span>
      </div>
    </Widget>
  );
}

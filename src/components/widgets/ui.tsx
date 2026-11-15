// Small shared UI kit for widgets. Styling lives in src/styles/global.css
// (classes prefixed `w-`), so widgets follow the site theme automatically.

import { useEffect, useRef, type ReactNode } from 'react';
import { claimAudio, releaseAudio } from '../../lib/audio';

export function Widget(props: { title: string; kicker?: string; children: ReactNode; caption?: ReactNode }) {
  return (
    <figure className="w-frame">
      <header className="w-head">
        {props.kicker && <span className="w-kicker">{props.kicker}</span>}
        <span className="w-title">{props.title}</span>
      </header>
      <div className="w-body">{props.children}</div>
      {props.caption && <figcaption className="w-caption">{props.caption}</figcaption>}
    </figure>
  );
}

export function PlayButton(props: { playing: boolean; onClick: () => void; label?: string }) {
  return (
    <button type="button" className={'w-play' + (props.playing ? ' is-playing' : '')} onClick={props.onClick}>
      <span className="w-play-icon" aria-hidden>
        {props.playing ? '■' : '▶'}
      </span>
      {props.label ?? (props.playing ? 'Stop' : 'Play')}
    </button>
  );
}

export function Segmented<T extends string | number>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="w-seg" role="radiogroup" aria-label={props.label}>
      {props.label && <span className="w-label">{props.label}</span>}
      {props.options.map((o) => (
        <button
          type="button"
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === props.value}
          className={o.value === props.value ? 'is-on' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  display?: ReactNode;
}) {
  return (
    <label className="w-slider">
      <span className="w-label">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 'any'}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <span className="w-value">{props.display ?? props.value}</span>
    </label>
  );
}

export function Readout(props: { label: string; children: ReactNode }) {
  return (
    <div className="w-readout">
      <span className="w-label">{props.label}</span>
      <span className="w-readout-value">{props.children}</span>
    </div>
  );
}

/**
 * Ties a widget's sound to the page-wide "one widget at a time" rule and
 * guarantees silence on unmount. `stop` must be stable (useCallback).
 */
export function useAudioOwner(playing: boolean, stop: () => void) {
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    if (!playing) return;
    const s = () => stopRef.current();
    claimAudio(s);
    return () => releaseAudio(s);
  }, [playing]);
  useEffect(() => () => stopRef.current(), []);
}

/** Round for SVG output, so server and client render identical strings. */
export const r2 = (v: number) => Math.round(v * 100) / 100;

/** Simple linear scale helper (rounded output). */
export function scale(d0: number, d1: number, r0: number, r1: number) {
  return (v: number) => r2(r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));
}

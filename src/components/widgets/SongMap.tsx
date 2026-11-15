// A map of a whole recording: its sections and key events on a timeline,
// synced to the official YouTube upload. Click a section to jump there.
// "Draw my tension" lets you record how tense the music feels as it plays
// (drag up/down on the curve area, or use the ↑/↓ keys), so you can compare
// your curve with the map. Curves are saved in this browser only.
//
// In private builds, "Retime" lets the owner correct the section timestamps
// by tapping along with the recording, and prints YAML for tracks.yaml.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtTime } from '../../lib/sequence';
import { claimAudio, releaseAudio } from '../../lib/audio';
import { Widget, r2 } from './ui';

export type MapSection = { t: number; label: string; kind?: string };
export type MapEvent = { t: number; label: string };

type Props = {
  trackId: string;
  title: string;
  artist: string;
  year?: string | number | null;
  youtube: string;
  duration: number;
  sections: MapSection[];
  events?: MapEvent[];
  verified?: boolean;
  editable?: boolean;
  /** Optional instruction shown above the timeline. */
  prompt?: string;
};

const BIN = 0.5; // seconds per tension sample

/** Truncate a label to fit `px` (approximate width of the 11px UI font). */
function fitLabel(label: string, px: number): string {
  const max = Math.floor(px / 6.4);
  if (label.length <= max) return label;
  return max <= 2 ? '' : label.slice(0, max - 1).trimEnd() + '…';
}

// ---- YouTube IFrame API (loaded once, on first use) ----
let ytPromise: Promise<any> | null = null;
function loadYT(): Promise<any> {
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (!ytPromise)
    ytPromise = new Promise((resolve) => {
      const prev = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(w.YT);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  return ytPromise;
}

function loadCurve(key: string, n: number): (number | null)[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return Array.from({ length: n }, (_, i) => (typeof arr[i] === 'number' ? arr[i] : null));
    }
  } catch {
    /* storage unavailable */
  }
  return Array(n).fill(null);
}

export default function SongMap(props: Props) {
  const { trackId, youtube, sections, events = [], editable = false, verified = false } = props;
  const [duration, setDuration] = useState(props.duration);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0.2);
  const [retime, setRetime] = useState(false);
  const [marks, setMarks] = useState<number[]>([]);
  const nBins = Math.ceil(duration / BIN) + 1;
  const storeKey = `archmusic:tension:${trackId}`;
  const [curve, setCurve] = useState<(number | null)[]>(() => Array(nBins).fill(null));
  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const raf = useRef(0);
  const levelRef = useRef(level);
  levelRef.current = level;
  const recRef = useRef(recording);
  recRef.current = recording;
  const pendingSeek = useRef<number | null>(null);

  useEffect(() => setCurve(loadCurve(storeKey, nBins)), [storeKey, nBins]);
  const saveCurve = (c: (number | null)[]) => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(c.map((v) => (v === null ? null : Math.round(v * 100) / 100))));
    } catch {
      /* ignore */
    }
  };

  // ---- one-sound-at-a-time: pause the video when another widget starts ----
  const pause = useCallback(() => player.current?.pauseVideo?.(), []);
  useEffect(() => {
    if (!playing) return;
    claimAudio(pause);
    return () => releaseAudio(pause);
  }, [playing, pause]);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      try {
        player.current?.destroy?.();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  // ---- clock: poll the player while playing, and sample tension ----
  useEffect(() => {
    if (!playing) return;
    let lastBin = -1;
    let prevT = -1;
    const tick = () => {
      const p = player.current;
      const t = p?.getCurrentTime?.() ?? 0;
      setTime(t);
      // Only sample during continuous playback: right after a seek the player can briefly report a stale time.
      const continuous = prevT >= 0 && t >= prevT && t - prevT < 0.5;
      prevT = t;
      if (recRef.current && continuous) {
        const b = Math.floor(t / BIN);
        if (b !== lastBin && b >= 0) {
          lastBin = b;
          setCurve((c) => {
            if (b >= c.length) return c;
            const next = c.slice();
            next[b] = levelRef.current;
            return next;
          });
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing]);

  // Save after recording stops or playback pauses.
  useEffect(() => {
    if (!playing || !recording) saveCurve(curve);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, recording]);

  const ensurePlayer = async (): Promise<any> => {
    if (player.current) return player.current;
    setStatus('loading');
    try {
      const YT = await loadYT();
      return await new Promise((resolve) => {
        const el = document.createElement('div');
        holder.current!.replaceChildren(el);
        const p = new YT.Player(el, {
          videoId: youtube,
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          playerVars: { rel: 0, playsinline: 1, modestbranding: 1 },
          events: {
            onReady: () => {
              player.current = p;
              const d = p.getDuration?.();
              if (d && d > 0) setDuration(d);
              setStatus('ready');
              resolve(p);
            },
            onStateChange: (e: any) => {
              setPlaying(e.data === YT.PlayerState.PLAYING);
              if (e.data !== YT.PlayerState.PLAYING) setTime(p.getCurrentTime?.() ?? 0);
            },
            onError: () => setStatus('error'),
          },
        });
      });
    } catch {
      setStatus('error');
      return null;
    }
  };

  const seek = async (t: number, play = true) => {
    const p = await ensurePlayer();
    if (!p) return;
    p.seekTo(Math.max(0, t), true);
    setTime(t);
    if (play) p.playVideo();
  };

  const toggle = async () => {
    const p = await ensurePlayer();
    if (!p) return;
    if (playing) p.pauseVideo();
    else p.playVideo();
  };

  // ---- retime (private builds) ----
  const items = useMemo(
    () =>
      [...sections.map((s) => ({ ...s, type: 'section' as const })), ...events.map((e) => ({ ...e, type: 'event' as const }))].sort(
        (a, b) => a.t - b.t,
      ),
    [sections, events],
  );
  const mark = () => setMarks((m) => (m.length < items.length ? [...m, Math.round(time * 10) / 10] : m));
  const yaml = useMemo(() => {
    const t = (i: number, orig: number) => {
      const v = marks[i] ?? orig;
      const m = Math.floor(v / 60);
      const s = (v - m * 60).toFixed(1).padStart(4, '0');
      return `"${m}:${s}"`;
    };
    const idx = (it: (typeof items)[number]) => items.indexOf(it);
    const secs = items.filter((x) => x.type === 'section');
    const evs = items.filter((x) => x.type === 'event');
    return [
      '  map:',
      `    verified: ${marks.length === items.length}`,
      '    sections:',
      ...secs.map((s) => `      - { t: ${t(idx(s), s.t)}, label: ${JSON.stringify(s.label)}${s.kind ? `, kind: ${s.kind}` : ''} }`),
      '    events:',
      ...evs.map((e) => `      - { t: ${t(idx(e), e.t)}, label: ${JSON.stringify(e.label)} }`),
    ].join('\n');
  }, [marks, items]);

  // ---- geometry ----
  const W = 680;
  const PADL = 10;
  const PW = W - 2 * PADL;
  const X = (t: number) => r2(PADL + (Math.min(Math.max(t, 0), duration) / duration) * PW);
  const CURVE_TOP = 6;
  const CURVE_H = 70;
  const SECT_Y = CURVE_TOP + CURVE_H + 8;
  const SECT_H = 30;
  const EV_Y = SECT_Y + SECT_H + 6;
  const H = EV_Y + 44;
  const showCurve = recording || curve.some((v) => v !== null);

  const curvePath = useMemo(() => {
    let d = '';
    let pen = false;
    curve.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      const x = X(i * BIN);
      const y = r2(CURVE_TOP + CURVE_H * (1 - v));
      d += (pen ? 'L' : 'M') + x + ' ' + y;
      pen = true;
    });
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curve, duration]);

  const setFromPointer = (e: React.PointerEvent<SVGRectElement>) => {
    const svg = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const y = ((e.clientY - svg.top) / svg.height) * H;
    setLevel(Math.min(1, Math.max(0, 1 - (y - CURVE_TOP) / CURVE_H)));
  };

  const timelineClick = (e: React.MouseEvent<SVGRectElement>) => {
    const svg = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const x = ((e.clientX - svg.left) / svg.width) * W;
    seek(((x - PADL) / PW) * duration);
  };

  const sectEnd = (i: number) => (i + 1 < sections.length ? sections[i + 1].t : duration);
  const current = sections.findIndex((s, i) => time >= s.t && time < sectEnd(i));

  // Stagger event labels on two rows so neighbours don't collide.
  const evRows = events.map((_, i) => i % 2);

  return (
    <Widget
      kicker="Song map"
      title={`${props.title} · ${props.artist}${props.year ? `, ${props.year}` : ''}`}
      caption={
        <>
          The whole recording, left to right. Click a section (or anywhere on the timeline) to jump there. Turn on{' '}
          <strong>Draw my tension</strong> and, while the music plays, drag up and down in the top area (or use the ↑/↓
          keys) to trace how tense it feels. Your curve is saved in this browser only.
          {editable && !verified && (
            <>
              {' '}
              <span className="key-rough">Timestamps are estimates and haven’t been checked by ear yet.</span>
            </>
          )}
        </>
      }
    >
      {props.prompt && <p className="w-note">{props.prompt}</p>}
      <div className="w-controls">
        <button type="button" className={'w-play' + (playing ? ' is-playing' : '')} onClick={toggle}>
          <span className="w-play-icon" aria-hidden>
            {playing ? '❚❚' : '▶'}
          </span>
          {status === 'loading' ? 'Loading…' : playing ? 'Pause' : time > 0 ? 'Resume' : 'Play'}
        </button>
        <button type="button" className={'w-chip' + (recording ? ' is-on' : '')} aria-pressed={recording} onClick={() => setRecording((r) => !r)}>
          {recording ? '● Drawing my tension' : 'Draw my tension'}
        </button>
        {curve.some((v) => v !== null) && (
          <button
            type="button"
            className="w-chip"
            onClick={() => {
              const c = Array(nBins).fill(null);
              setCurve(c);
              saveCurve(c);
            }}
          >
            Clear my curve
          </button>
        )}
        <span className="w-readout-value songmap-time">
          {fmtTime(time)} / {fmtTime(duration)}
          {current >= 0 && <span className="muted"> · {sections[current].label}</span>}
        </span>
      </div>

      <div className={'songmap-video' + (status === 'idle' ? ' is-idle' : '')} ref={holder}>
        {status === 'idle' && (
          <button type="button" className="songmap-load" onClick={() => seek(0, false)}>
            Load the video (YouTube)
          </button>
        )}
      </div>
      {status === 'error' && <p className="w-note w-warn">Couldn’t load the YouTube player. The video may be unavailable in your region.</p>}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-plot songmap"
        role="group"
        aria-label="Song timeline"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            setLevel((l) => Math.min(1, Math.max(0, l + (e.key === 'ArrowUp' ? 0.1 : -0.1))));
          } else if (editable && retime && e.key.toLowerCase() === 'm') mark();
        }}
      >
        {/* tension area */}
        {showCurve && (
          <g>
            <text x={PADL + 2} y={CURVE_TOP + 10} className="w-tick">
              tense
            </text>
            <text x={PADL + 2} y={CURVE_TOP + CURVE_H - 2} className="w-tick">
              relaxed
            </text>
            <line x1={PADL} x2={W - PADL} y1={CURVE_TOP + CURVE_H} y2={CURVE_TOP + CURVE_H} className="stroke-grid" />
            <path d={curvePath} className="tension-line" />
            {recording && <circle cx={X(time)} cy={r2(CURVE_TOP + CURVE_H * (1 - level))} r={5} className="tension-dot" />}
            <rect
              x={PADL}
              y={CURVE_TOP}
              width={PW}
              height={CURVE_H}
              className="songmap-hit"
              style={{ cursor: recording ? 'ns-resize' : 'default', touchAction: recording ? 'none' : 'auto' }}
              onPointerDown={(e) => {
                if (!recording) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                setFromPointer(e);
              }}
              onPointerMove={(e) => {
                if (recording && (e.buttons || e.pointerType === 'mouse')) setFromPointer(e);
              }}
            />
          </g>
        )}
        {!showCurve && (
          <text x={W / 2} y={CURVE_TOP + CURVE_H / 2} textAnchor="middle" className="w-tick muted">
            (your tension curve will appear here)
          </text>
        )}

        {/* sections */}
        {sections.map((s, i) => {
          const x0 = X(s.t);
          const x1 = X(sectEnd(i));
          const w = Math.max(1, x1 - x0 - 1.5);
          return (
            <g key={i} className="songmap-sect" onClick={() => seek(s.t)} style={{ cursor: 'pointer' }} aria-label={`${s.label}, ${fmtTime(s.t)}`}>
              <rect x={x0} y={SECT_Y} width={r2(w)} height={SECT_H} rx={3} className={'sect-band sect-' + (s.kind ?? 'other') + (i === current ? ' is-now' : '')} />
              {w > 26 && (
                <text x={r2(x0 + 4)} y={SECT_Y + 19} className="w-tick sect-label">
                  {fitLabel(s.label, w - 8)}
                </text>
              )}
            </g>
          );
        })}

        {/* events */}
        {events.map((e, i) => {
          const x = X(e.t);
          const y = EV_Y + 12 + evRows[i] * 16;
          const anchor = x > W - 120 ? 'end' : 'start';
          return (
            <g key={i} onClick={() => seek(Math.max(0, e.t - 5))} style={{ cursor: 'pointer' }}>
              <line x1={x} x2={x} y1={SECT_Y - 4} y2={y - 9} className="stroke-b" />
              <circle cx={x} cy={SECT_Y - 4} r={3} className="fill-b" />
              <text x={anchor === 'end' ? x - 4 : x + 4} y={y} textAnchor={anchor} className="w-tick key-b">
                {e.label}
              </text>
            </g>
          );
        })}

        {/* timeline hit area (below sections, for seeking) */}
        <rect x={PADL} y={H - 8} width={PW} height={8} className="songmap-scrub" onClick={timelineClick} style={{ cursor: 'pointer' }} />
        {[...Array(Math.floor(duration / 60) + 1)].map((_, m) => (
          <text key={m} x={X(m * 60)} y={H - 1} textAnchor={m === 0 ? 'start' : 'middle'} className="w-tick muted">
            {m}:00
          </text>
        ))}

        {/* playhead */}
        {(playing || time > 0) && <line x1={X(time)} x2={X(time)} y1={CURVE_TOP} y2={EV_Y} className="playhead" />}
      </svg>

      {editable && (
        <details className="songmap-edit" open={retime} onToggle={(e) => setRetime((e.target as HTMLDetailsElement).open)}>
          <summary>Retime this map (private builds only)</summary>
          <p className="w-note">
            Play from the start and press <strong>Mark</strong> (or the M key with the timeline focused) at the start of
            each item, in order. Next: <strong>{marks.length < items.length ? items[marks.length].label : 'done'}</strong>. Then
            paste the YAML into this track in <code>src/data/tracks.yaml</code>.
          </p>
          <div className="w-controls">
            <button type="button" className="w-chip" onClick={mark} disabled={marks.length >= items.length}>
              Mark
            </button>
            <button type="button" className="w-chip" onClick={() => setMarks((m) => m.slice(0, -1))} disabled={!marks.length}>
              Undo
            </button>
            <button type="button" className="w-chip" onClick={() => setMarks([])} disabled={!marks.length}>
              Reset
            </button>
          </div>
          <pre className="songmap-yaml">{yaml}</pre>
        </details>
      )}
    </Widget>
  );
}

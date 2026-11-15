// Interval ear trainer. Plays two notes; you name the interval.
// Start with a few very different intervals and add more as you go.
// After each answer it shows a well-known tune that opens with that
// interval, the classic memory hook.

import { useCallback, useEffect, useRef, useState } from 'react';
import { playNotes } from '../../lib/audio';
import { harmonic } from '../../lib/dissonance';
import { INTERVALS, midiToHz, spellInterval } from '../../lib/tuning';
import { Segmented, Widget, useAudioOwner } from './ui';

const SPECTRUM = harmonic(8, 0.8);
const CHOICES = INTERVALS.filter((iv) => iv.semis > 0); // m2 .. P8

/** Tunes that open with (ascending) intervals: a traditional ear-training aid. */
const HOOKS: Record<string, string> = {
  m2: 'the Jaws theme',
  M2: '“Happy Birthday” (the step from “-py” to “birth-”)',
  m3: '“Greensleeves” (first two notes)',
  M3: '“When the Saints Go Marching In” (“Oh when”)',
  P4: '“Here Comes the Bride”',
  TT: '“Maria” from West Side Story',
  P5: '“Twinkle, Twinkle, Little Star” (“twinkle, twinkle”)',
  m6: '“The Entertainer” (the leap in the opening phrase)',
  M6: '“My Bonnie Lies Over the Ocean” (“My Bon-”)',
  m7: '“Somewhere” from West Side Story (“There’s a”)',
  M7: '“Take On Me” (the leap in the chorus)',
  P8: '“Somewhere Over the Rainbow” (“Some-where”)',
};

type Q = { root: number; iv: (typeof CHOICES)[number] };

export default function IntervalQuiz(props: { start?: string[] }) {
  const [pool, setPool] = useState<string[]>(props.start ?? ['M3', 'P5', 'P8']);
  const [mode, setMode] = useState<'up' | 'together'>('up');
  const [q, setQ] = useState<Q | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const [playing, setPlaying] = useState(false);
  const handle = useRef<{ stop: () => void } | null>(null);

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    setPlaying(false);
  }, []);
  useAudioOwner(playing, stop);
  useEffect(() => () => handle.current?.stop(), []);

  const play = (question: Q, m = mode) => {
    handle.current?.stop();
    handle.current = playNotes(SPECTRUM, [midiToHz(question.root), midiToHz(question.root + question.iv.semis)], {
      mode: m,
      noteDur: 0.9,
      onEnd: () => setPlaying(false),
    });
    setPlaying(true);
  };

  const next = () => {
    const options = CHOICES.filter((iv) => pool.includes(iv.short));
    if (!options.length) return;
    let iv = options[Math.floor(Math.random() * options.length)];
    // Avoid asking the same interval three times in a row.
    if (q && options.length > 1 && iv.short === q.iv.short && Math.random() < 0.5)
      iv = options[Math.floor(Math.random() * options.length)];
    const root = 53 + Math.floor(Math.random() * 12); // F3..E4
    const question = { root, iv };
    setQ(question);
    setAnswer(null);
    play(question);
  };

  const guess = (short: string) => {
    if (!q || answer) return;
    setAnswer(short);
    setScore((s) => ({ right: s.right + (short === q.iv.short ? 1 : 0), total: s.total + 1 }));
  };

  const togglePool = (short: string) =>
    setPool((p) => (p.includes(short) ? (p.length > 2 ? p.filter((x) => x !== short) : p) : [...p, short]));

  const correct = answer && q && answer === q.iv.short;

  return (
    <Widget
      kicker="Practice"
      title="Interval ear trainer"
      caption={
        <>
          Pick which intervals to practice (at least two). Start with a few very different ones, like a major third, a
          fifth, and an octave, and add more as they get easy. “One after the other” is easier than “together”. Each
          question uses a random starting note, so you learn the <em>sound of the distance</em>, not particular notes.
        </>
      }
    >
      <div className="w-chips" role="group" aria-label="Intervals to practice">
        {CHOICES.map((iv) => (
          <button
            type="button"
            key={iv.short}
            className={'w-chip' + (pool.includes(iv.short) ? ' is-on' : '')}
            onClick={() => togglePool(iv.short)}
            title={iv.name}
          >
            {iv.short}
          </button>
        ))}
      </div>
      <div className="w-controls">
        <button type="button" className="w-play" onClick={next}>
          <span className="w-play-icon" aria-hidden>
            ▶
          </span>
          {q ? 'Next interval' : 'Start'}
        </button>
        {q && (
          <button type="button" className="w-play small" onClick={() => play(q)} disabled={playing}>
            Replay
          </button>
        )}
        <Segmented
          label="Play"
          value={mode}
          options={[
            { value: 'up', label: 'One after the other' },
            { value: 'together', label: 'Together' },
          ]}
          onChange={(m) => {
            setMode(m);
            if (q) play(q, m);
          }}
        />
        <span className="muted">
          Score: {score.right}/{score.total}
        </span>
      </div>

      {q && (
        <div className="w-quiz-answers">
          {CHOICES.filter((iv) => pool.includes(iv.short)).map((iv) => (
            <button
              type="button"
              key={iv.short}
              className={
                'w-quiz-btn' +
                (answer && iv.short === q.iv.short ? ' is-right' : '') +
                (answer === iv.short && iv.short !== q.iv.short ? ' is-wrong' : '')
              }
              onClick={() => guess(iv.short)}
              disabled={!!answer}
            >
              <strong>{iv.short}</strong> <span className="muted">{iv.name}</span>
            </button>
          ))}
        </div>
      )}

      {answer && q && (
        <p className={'w-note ' + (correct ? 'w-quiz-ok' : 'w-quiz-no')}>
          {correct ? 'Yes!' : `Not quite: that was ${/^[aeiou]/i.test(q.iv.name) ? 'an' : 'a'} ${q.iv.name}.`} {spellInterval(q.root, q.iv.semis).join(' up to ')},{' '}
          {q.iv.semis} semitone{q.iv.semis > 1 ? 's' : ''}. Memory hook: {HOOKS[q.iv.short]}.
        </p>
      )}
    </Widget>
  );
}

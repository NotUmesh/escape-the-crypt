import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { usePrefersReducedMotion } from '../crypt/lantern-context';
import { FRONT_OF_HOUSE_COPY } from '@escape-the-crypt/core';
import { DESCENT_CLIPS } from './clip-sources';
import type { DescentClip } from './clip-sources';
import { useDescentSequence } from './use-descent-sequence';
import type { DescentEnd } from './use-descent-sequence';
import './descent.css';

export interface DescentGateProps {
  /**
   * `clips` plays the two clips, for a newly generated or newly started crypt.
   * `fade` is the short fade used when "Continue your crypt" goes straight in.
   */
  readonly variant: 'clips' | 'fade';
  /** Called once when the descent is over. The host then lifts `inert` and moves focus into the room. */
  readonly onDone: (reason: DescentEnd) => void;
  /** Sends text to the one live region on screen. */
  readonly announce?: (message: string) => void;
  readonly clips?: readonly DescentClip[];
}

const FADE_MS = 400;

function Clips({ onDone, announce, clips }: Required<Pick<DescentGateProps, 'clips'>> & Omit<DescentGateProps, 'variant' | 'clips'>): ReactNode {
  const copy = FRONT_OF_HOUSE_COPY.descent;
  const sequence = useDescentSequence({ clipCount: clips.length, onDone });
  const skipRef = useRef<HTMLButtonElement | null>(null);
  const { skip } = sequence;
  useEffect(() => {
    announce?.(copy.announce);
    skipRef.current?.focus();
  }, [announce, copy]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') skip();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [skip]);
  const clip = clips[Math.min(sequence.index, clips.length - 1)];
  if (clip === undefined) return null;
  return (
    <div className="descent" role="region" aria-label={copy.label} data-testid="descent-gate" data-clip={sequence.index}>
      {/* Decorative and silent: no audio track, no controls. The Skip button is the way out. */}
      <video
        key={sequence.index}
        className="descent__video"
        autoPlay
        muted
        playsInline
        preload="auto"
        poster={clip.poster}
        aria-hidden="true"
        tabIndex={-1}
        onEnded={sequence.onEnded}
        onError={sequence.onError}
        onCanPlay={sequence.onCanPlay}
      >
        <source src={clip.webm} type="video/webm" />
        <source src={clip.mp4} type="video/mp4" onError={sequence.onError} />
      </video>
      <button type="button" className="fh-button descent__skip" ref={skipRef} onClick={sequence.skip}>
        {copy.skip}
      </button>
    </div>
  );
}

function Fade({ onDone }: Pick<DescentGateProps, 'onDone'>): ReactNode {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    // A backstop in case the animation never reports its end.
    const timer = setTimeout(() => done.current('ended'), FADE_MS + 100);
    return () => clearTimeout(timer);
  }, []);
  return <div className="descent descent--fade" aria-hidden="true" data-testid="descent-fade" onAnimationEnd={() => done.current('ended')} />;
}

/**
 * The cover over a freshly started run. With reduced motion it does not draw at all: it announces
 * the descent and finishes at once. The fade never takes input (pointer events pass through) and the
 * clips always have a Skip button, so nothing blocks the learner.
 */
export function DescentGate({ variant, onDone, announce, clips = DESCENT_CLIPS }: DescentGateProps): ReactNode {
  const reduced = usePrefersReducedMotion();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const announced = useRef(announce);
  announced.current = announce;
  useEffect(() => {
    if (!reduced) return;
    if (variant === 'clips') announced.current?.(FRONT_OF_HOUSE_COPY.descent.announce);
    doneRef.current('reduced-motion');
  }, [reduced, variant]);
  if (reduced) return null;
  return variant === 'fade' ? <Fade onDone={onDone} /> : <Clips onDone={onDone} announce={announce} clips={clips} />;
}

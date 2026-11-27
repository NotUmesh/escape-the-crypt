import { useCallback, useEffect, useRef, useState } from 'react';
import { CAN_PLAY_TIMEOUT_MS } from './clip-sources';

export type DescentEnd = 'ended' | 'skipped' | 'error' | 'reduced-motion';

export interface DescentSequenceOptions {
  readonly clipCount: number;
  /** Called exactly once, however the sequence ends. */
  readonly onDone: (reason: DescentEnd) => void;
  readonly canPlayTimeoutMs?: number;
}

export interface DescentSequence {
  /** The clip to show now. */
  readonly index: number;
  readonly skip: () => void;
  readonly onEnded: () => void;
  readonly onError: () => void;
  readonly onCanPlay: () => void;
}

/**
 * Plays the clips in order. It ends when the last clip ends, when the learner skips, or when a
 * clip fails or does not become playable in time: the crypt is already running behind the gate,
 * so giving up on a clip loses nothing.
 */
export function useDescentSequence({
  clipCount,
  onDone,
  canPlayTimeoutMs = CAN_PLAY_TIMEOUT_MS,
}: DescentSequenceOptions): DescentSequence {
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const finished = useRef(false);
  const playable = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const finish = useCallback((reason: DescentEnd): void => {
    if (finished.current) return;
    finished.current = true;
    doneRef.current(reason);
  }, []);

  const onEnded = useCallback((): void => {
    if (finished.current) return;
    if (indexRef.current + 1 >= clipCount) {
      finish('ended');
      return;
    }
    indexRef.current += 1;
    setIndex(indexRef.current);
  }, [clipCount, finish]);

  useEffect(() => {
    playable.current = false;
    const timer = setTimeout(() => {
      if (!playable.current) finish('error');
    }, canPlayTimeoutMs);
    return () => clearTimeout(timer);
  }, [index, canPlayTimeoutMs, finish]);

  return {
    index,
    skip: useCallback(() => finish('skipped'), [finish]),
    onEnded,
    onError: useCallback(() => finish('error'), [finish]),
    onCanPlay: useCallback(() => {
      playable.current = true;
    }, []),
  };
}

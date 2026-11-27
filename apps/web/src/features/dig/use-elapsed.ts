import { useEffect, useRef, useState } from 'react';

export type Clock = () => number;

/**
 * Whole seconds since `active` last turned true, from a real clock. It counts while active, holds
 * its last value when `active` turns false, and starts again from 0 on the next activation.
 */
export function useElapsed(active: boolean, now: Clock = Date.now, tickMs = 1000): number {
  const [seconds, setSeconds] = useState(0);
  const startedAt = useRef<number | null>(null);
  const clock = useRef(now);
  clock.current = now;

  useEffect(() => {
    if (!active) {
      startedAt.current = null;
      return undefined;
    }
    const start = clock.current();
    startedAt.current = start;
    setSeconds(0);
    const timer = setInterval(() => {
      setSeconds(Math.max(0, Math.floor((clock.current() - start) / 1000)));
    }, tickMs);
    return () => clearInterval(timer);
  }, [active, tickMs]);

  return seconds;
}

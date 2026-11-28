import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DescentGate } from '../descent/descent-gate';
import type { EndgameClip } from '../descent/clip-sources';

export type DescentVariant = 'clips' | 'fade' | EndgameClip;

const ROOM_TARGETS = '.room-hotspot, .room-screen__lock-button';
const MAX_FRAMES = 30;

function focusDestination(variant: DescentVariant): () => void {
  const screen = variant === 'escape' ? '.final-door--escaped' : variant === 'final-door' ? '.final-door' : '.room-screen';
  const selector = variant === 'escape' ? '.final-door__button' : variant === 'final-door' ? '.final-door__seal-button' : ROOM_TARGETS;
  const focus = (): boolean => {
    const destination = document.querySelector(screen);
    if (destination?.contains(document.activeElement)) return true;
    const target = destination?.querySelector<HTMLElement>(selector);
    if (target == null) return false;
    target.focus();
    return true;
  };
  const destination = document.querySelector(screen);
  if (variant === 'final-door' && destination !== null) {
    // The clips can end before the room art (or its fallback) has drawn the seals.
    const observer = new MutationObserver(() => {
      if (document.activeElement !== document.body || focus()) observer.disconnect();
    });
    if (!focus()) observer.observe(destination, { childList: true, subtree: true });
    return () => observer.disconnect();
  }
  let frames = 0;
  let frame = 0;
  const attempt = (): void => {
    if (focus()) return;
    frames += 1;
    if (frames < MAX_FRAMES) frame = requestAnimationFrame(attempt);
  };
  attempt();
  return () => cancelAnimationFrame(frame);
}

export interface Descent {
  readonly variant: DescentVariant | null;
  readonly begin: (variant: DescentVariant, then?: DescentVariant) => void;
  readonly end: () => void;
}

/** Which descent is up over a freshly started run. It is view state only; the run does not know about it. */
export function useDescent(enabled: boolean): Descent {
  const [variant, setVariant] = useState<DescentVariant | null>(null);
  const focusAfter = useRef<DescentVariant | null>(null);
  const following = useRef<DescentVariant | null>(null);
  const begin = useCallback(
    (next: DescentVariant, then?: DescentVariant): void => {
      if (!enabled) return;
      following.current = then ?? null;
      setVariant(next);
    },
    [enabled],
  );
  const end = useCallback((): void => {
    const next = following.current;
    following.current = null;
    if (next === null) focusAfter.current = variant;
    setVariant(next);
  }, [variant]);
  useEffect(() => {
    const destination = focusAfter.current;
    if (variant !== null || destination === null) return;
    focusAfter.current = null;
    return focusDestination(destination);
  }, [variant]);
  return { variant, begin, end };
}

export interface DescentLayerProps {
  readonly variant: DescentVariant | null;
  readonly onDone: () => void;
  readonly announce: (message: string) => void;
  /**
   * True once a run is playing (or failed to start): the wrapper is then the page's `main`, with the
   * app's page frame. Before that the host's own screens draw their own `main`, so it draws no box.
   */
  readonly landmark: boolean;
  /** The run's screens. They stay mounted and unchanged; while the descent is up they are inert. */
  readonly children: ReactNode;
}

/**
 * Keeps the run's screens in one stable wrapper so the descent can cover them without remounting.
 * The wrapper draws no box of its own. While the descent is up the screens beneath are inert (no
 * focus, no clicks, hidden from screen readers); the gate itself always has a Skip button.
 */
export function DescentLayer({ variant, onDone, announce, landmark, children }: DescentLayerProps): ReactNode {
  const props = { inert: variant !== null, 'data-descending': variant ?? undefined };
  return (
    <>
      {landmark ? (
        <main className="screen crypt-stage crypt-stage--page" {...props}>
          {children}
        </main>
      ) : (
        <div className="crypt-stage" {...props}>
          {children}
        </div>
      )}
      {variant === null ? null : <DescentGate key={variant} variant={variant} onDone={onDone} announce={announce} />}
    </>
  );
}

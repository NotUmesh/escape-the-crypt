import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DescentGate } from '../descent/descent-gate';

export type DescentVariant = 'clips' | 'fade';

const FOCUS_TARGETS = '.room-hotspot, .room-screen__lock-button';
const MAX_FRAMES = 30;

/** Moves focus to the first lock in the room once it is drawn, unless the learner already focused something there. */
function focusRoom(): void {
  let frames = 0;
  const attempt = (): void => {
    const room = document.querySelector('.room-screen');
    if (room !== null && room.contains(document.activeElement) && document.activeElement !== room) return;
    const target = document.querySelector<HTMLElement>(FOCUS_TARGETS);
    if (target !== null) {
      target.focus();
      return;
    }
    frames += 1;
    if (frames < MAX_FRAMES) requestAnimationFrame(attempt);
  };
  attempt();
}

export interface Descent {
  readonly variant: DescentVariant | null;
  readonly begin: (variant: DescentVariant) => void;
  readonly end: () => void;
}

/** Which descent is up over a freshly started run. It is view state only; the run does not know about it. */
export function useDescent(enabled: boolean): Descent {
  const [variant, setVariant] = useState<DescentVariant | null>(null);
  const focusAfter = useRef(false);
  const begin = useCallback(
    (next: DescentVariant): void => {
      if (enabled) setVariant(next);
    },
    [enabled],
  );
  const end = useCallback((): void => {
    focusAfter.current = true;
    setVariant(null);
  }, []);
  useEffect(() => {
    if (variant !== null || !focusAfter.current) return;
    focusAfter.current = false;
    focusRoom();
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
      {variant === null ? null : <DescentGate variant={variant} onDone={onDone} announce={announce} />}
    </>
  );
}

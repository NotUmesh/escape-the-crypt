import { useEffect } from 'react';
import type { RefObject } from 'react';

/** The largest shift, in px, at a parallax factor of 1 (Requirement 12.1: a few pixels). */
export const MAX_PARALLAX_PX = 6;

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** Pointer position as -1..1 across the window. */
export function pointerOffset(clientX: number, clientY: number, width: number, height: number): { x: number; y: number } {
  if (width <= 0 || height <= 0) return { x: 0, y: 0 };
  return { x: clamp((clientX / width - 0.5) * 2), y: clamp((clientY / height - 0.5) * 2) };
}

/** Device tilt as -1..1: 30 degrees either way is the full range. */
export function tiltOffset(gamma: number | null, beta: number | null): { x: number; y: number } {
  return { x: clamp((gamma ?? 0) / 30), y: clamp(((beta ?? 45) - 45) / 30) };
}

/**
 * Writes `--parallax-x` and `--parallax-y` on the element from the pointer or device tilt. It sets CSS
 * variables directly, so a move never re-renders React. With `enabled` false it listens to nothing and
 * leaves the variables at rest.
 */
export function useParallax(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const set = (x: number, y: number): void => {
      element.style.setProperty('--parallax-x', x.toFixed(3));
      element.style.setProperty('--parallax-y', y.toFixed(3));
    };
    set(0, 0);
    if (!enabled) return undefined;
    const onPointer = (event: PointerEvent): void => {
      const { x, y } = pointerOffset(event.clientX, event.clientY, window.innerWidth, window.innerHeight);
      set(x, y);
    };
    const onTilt = (event: DeviceOrientationEvent): void => {
      const { x, y } = tiltOffset(event.gamma, event.beta);
      set(x, y);
    };
    element.addEventListener('pointermove', onPointer);
    window.addEventListener('deviceorientation', onTilt);
    return () => {
      element.removeEventListener('pointermove', onPointer);
      window.removeEventListener('deviceorientation', onTilt);
      set(0, 0);
    };
  }, [ref, enabled]);
}

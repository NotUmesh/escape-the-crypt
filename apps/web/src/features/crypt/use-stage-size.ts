import { useEffect, useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { Viewport } from './crop-mapping';

function windowSize(): Viewport {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}

/** The window size, kept current on resize. `override` fixes it (tests). */
export function useWindowViewport(override?: Viewport): Viewport {
  const [size, setSize] = useState<Viewport>(windowSize);
  useEffect(() => {
    if (override !== undefined) return undefined;
    const onResize = (): void => setSize(windowSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [override]);
  return override ?? size;
}

/**
 * The element's measured size in px. Where nothing can be measured (no layout, no ResizeObserver),
 * `fallback` stands in, so the first frame and jsdom still place every control.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>, fallback: Viewport): Viewport {
  const [measured, setMeasured] = useState<Viewport | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const measure = (): void => {
      const rect = element.getBoundingClientRect();
      setMeasured((prev) => {
        if (rect.width <= 0 || rect.height <= 0) return prev === null ? prev : null;
        if (prev !== null && prev.width === rect.width && prev.height === rect.height) return prev;
        return { width: rect.width, height: rect.height };
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return measured ?? fallback;
}

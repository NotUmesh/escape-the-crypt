import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { readLanternSetting, resolveLanternMode, writeLanternSetting } from './lantern-setting';

// Lantern_Mode and the reduced-motion flag live here, once, for every stage (Requirements 12.2 to 12.5, 12.8 to 12.11).
// This is view state, not game state: the runtime never sees it.

export interface LanternState {
  readonly lantern: boolean;
  readonly reducedMotion: boolean;
  /** Sets the mode for the session and writes the setting; a failed write is ignored silently (Requirement 12.11). */
  readonly setLantern: (on: boolean) => void;
}

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

function reduceQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(REDUCE_QUERY);
}

/** The browser's reduced-motion preference, kept current. False where `matchMedia` is missing. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => reduceQuery()?.matches ?? false);
  useEffect(() => {
    const query = reduceQuery();
    if (query === null) return undefined;
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Where no provider is mounted (a lone stage in a test): lantern off, motion on. */
const DEFAULT_STATE: LanternState = { lantern: false, reducedMotion: false, setLantern: () => undefined };

const LanternContext = createContext<LanternState>(DEFAULT_STATE);

export function LanternProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const reducedMotion = usePrefersReducedMotion();
  // Read once on start: a stored value wins, otherwise reduced motion decides (Requirements 12.3, 12.9, 12.10).
  const [lantern, setLanternState] = useState<boolean>(() =>
    resolveLanternMode(readLanternSetting(), reduceQuery()?.matches ?? false),
  );
  const setLantern = useCallback((on: boolean): void => {
    setLanternState(on);
    writeLanternSetting(on);
  }, []);
  const value = useMemo<LanternState>(() => ({ lantern, reducedMotion, setLantern }), [lantern, reducedMotion, setLantern]);
  return <LanternContext.Provider value={value}>{children}</LanternContext.Provider>;
}

export function useLantern(): LanternState {
  return useContext(LanternContext);
}

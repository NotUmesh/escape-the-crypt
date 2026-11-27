// The Lantern_Setting is the only value this app keeps in localStorage (Requirements 12.8-12.12).

export const LANTERN_STORAGE_KEY = 'escape-the-crypt:lantern';

export type StoredLantern = 'on' | 'off' | 'absent' | 'threw' | { readonly garbage: string };

export type LanternStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Req 12.3, 12.9, 12.10: a stored 'on'/'off' wins; anything else falls back to reduced-motion. */
export function resolveLanternMode(stored: StoredLantern, prefersReducedMotion: boolean): boolean {
  if (stored === 'on') return true;
  if (stored === 'off') return false;
  return prefersReducedMotion;
}

function defaultStorage(): LanternStorage {
  return window.localStorage;
}

/** Reads the stored value. Never throws: an unreadable store reports `'threw'`. */
export function readLanternSetting(getStorage: () => LanternStorage = defaultStorage): StoredLantern {
  try {
    const value = getStorage().getItem(LANTERN_STORAGE_KEY);
    if (value === null) return 'absent';
    if (value === 'on' || value === 'off') return value;
    return { garbage: value };
  } catch {
    return 'threw';
  }
}

/**
 * Writes the Lantern_Setting. Returns false when the write failed; the caller keeps the session
 * value and shows nothing (Requirement 12.11).
 */
export function writeLanternSetting(
  on: boolean,
  getStorage: () => LanternStorage = defaultStorage,
): boolean {
  try {
    getStorage().setItem(LANTERN_STORAGE_KEY, on ? 'on' : 'off');
    return true;
  } catch {
    return false;
  }
}

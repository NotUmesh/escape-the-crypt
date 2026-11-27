import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  LANTERN_STORAGE_KEY,
  readLanternSetting,
  resolveLanternMode,
  writeLanternSetting,
} from './lantern-setting';
import type { LanternStorage, StoredLantern } from './lantern-setting';

function memoryStorage(initial: Record<string, string> = {}): LanternStorage & {
  readonly data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const throwing: LanternStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

describe('Property 9: The Lantern setting falls back to the reduced-motion default', () => {
  // Validates: Requirements 12.3, 12.9, 12.10
  const storedArb: fc.Arbitrary<StoredLantern> = fc.oneof(
    fc.constant<StoredLantern>('on'),
    fc.constant<StoredLantern>('off'),
    fc.constant<StoredLantern>('absent'),
    fc.constant<StoredLantern>('threw'),
    fc.string().map((garbage): StoredLantern => ({ garbage })),
  );

  it('returns true for on, false for off and prefersReducedMotion otherwise', () => {
    fc.assert(
      fc.property(storedArb, fc.boolean(), (stored, reduced) => {
        const expected = stored === 'on' ? true : stored === 'off' ? false : reduced;
        expect(resolveLanternMode(stored, reduced)).toBe(expected);
      }),
    );
  });
});

describe('readLanternSetting', () => {
  it('reads on and off', () => {
    expect(readLanternSetting(() => memoryStorage({ [LANTERN_STORAGE_KEY]: 'on' }))).toBe('on');
    expect(readLanternSetting(() => memoryStorage({ [LANTERN_STORAGE_KEY]: 'off' }))).toBe('off');
  });

  it('reports absent when nothing is stored', () => {
    expect(readLanternSetting(() => memoryStorage())).toBe('absent');
  });

  it('reports a throwing read, and a throwing storage accessor, as threw', () => {
    expect(readLanternSetting(() => throwing)).toBe('threw');
    expect(
      readLanternSetting(() => {
        throw new Error('denied');
      }),
    ).toBe('threw');
  });

  it.each(['', 'ON', 'true', '1', 'maybe'])('treats %j as unrecognised', (value) => {
    const stored = readLanternSetting(() => memoryStorage({ [LANTERN_STORAGE_KEY]: value }));
    expect(stored).toEqual({ garbage: value });
    expect(resolveLanternMode(stored, true)).toBe(true);
    expect(resolveLanternMode(stored, false)).toBe(false);
  });
});

describe('writeLanternSetting', () => {
  it('writes on and off under the one key and nothing else', () => {
    const storage = memoryStorage();
    expect(writeLanternSetting(true, () => storage)).toBe(true);
    expect(storage.data).toEqual(new Map([[LANTERN_STORAGE_KEY, 'on']]));
    expect(writeLanternSetting(false, () => storage)).toBe(true);
    expect(storage.data).toEqual(new Map([[LANTERN_STORAGE_KEY, 'off']]));
  });

  it('round-trips through read', () => {
    const storage = memoryStorage();
    writeLanternSetting(false, () => storage);
    expect(readLanternSetting(() => storage)).toBe('off');
  });

  it('does not throw when the write throws, and reports it', () => {
    expect(writeLanternSetting(true, () => throwing)).toBe(false);
    expect(
      writeLanternSetting(true, () => {
        throw new Error('denied');
      }),
    ).toBe(false);
  });

  it('uses window.localStorage by default', () => {
    window.localStorage.clear();
    expect(writeLanternSetting(true)).toBe(true);
    expect(readLanternSetting()).toBe('on');
    expect(window.localStorage.length).toBe(1);
    window.localStorage.clear();
  });
});

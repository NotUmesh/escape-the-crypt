import { describe, expect, it } from 'vitest';
import {
  SESSION_TOKEN_KEY,
  createSessionToken,
  isWellFormedSessionToken,
  readOrCreateSessionToken,
} from './session-token';
import type { TokenStorage } from './session-token';

function memoryStorage(initial: Record<string, string> = {}): TokenStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const throwingStorage: TokenStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

function countingRandom(): { fill: (b: Uint8Array) => Uint8Array; calls: () => number } {
  let n = 0;
  return {
    fill: (bytes) => {
      n += 1;
      bytes.forEach((_, i) => {
        bytes[i] = (n * 37 + i * 11) % 256;
      });
      return bytes;
    },
    calls: () => n,
  };
}

describe('session token', () => {
  it('makes a well-formed base64url token of at least 128 bits and stores it under one key', () => {
    const storage = memoryStorage();
    const token = readOrCreateSessionToken({ storage });
    expect(isWellFormedSessionToken(token)).toBe(true);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(22);
    expect(token.length).toBeLessThanOrEqual(128);
    expect([...storage.data.keys()]).toEqual([SESSION_TOKEN_KEY]);
    expect(storage.data.get(SESSION_TOKEN_KEY)).toBe(token);
  });

  it('asks for at least 16 random bytes', () => {
    let size = 0;
    readOrCreateSessionToken({
      storage: memoryStorage(),
      getRandomValues: (bytes) => {
        size = bytes.length;
        return bytes;
      },
    });
    expect(size).toBeGreaterThanOrEqual(16);
  });

  it('works with the real crypto source', () => {
    const a = readOrCreateSessionToken({ storage: memoryStorage() });
    const b = readOrCreateSessionToken({ storage: memoryStorage() });
    expect(a).not.toBe(b);
  });

  it('reuses a stored well-formed token', () => {
    const random = countingRandom();
    const storage = memoryStorage();
    const first = readOrCreateSessionToken({ storage, getRandomValues: random.fill });
    const second = readOrCreateSessionToken({ storage, getRandomValues: random.fill });
    expect(second).toBe(first);
    expect(random.calls()).toBe(1);
  });

  it.each([
    ['too short', 'abc'],
    ['bad characters', `${'a'.repeat(30)}+/=`],
    ['too long', 'a'.repeat(129)],
    ['empty', ''],
  ])('replaces a stored token that is %s', (_name, bad) => {
    const storage = memoryStorage({ [SESSION_TOKEN_KEY]: bad });
    const token = readOrCreateSessionToken({ storage });
    expect(token).not.toBe(bad);
    expect(isWellFormedSessionToken(token)).toBe(true);
    expect(storage.data.get(SESSION_TOKEN_KEY)).toBe(token);
  });

  it('keeps one in-memory token when storage throws', () => {
    const random = countingRandom();
    const getToken = createSessionToken({ storage: throwingStorage, getRandomValues: random.fill });
    const first = getToken();
    expect(isWellFormedSessionToken(first)).toBe(true);
    expect(getToken()).toBe(first);
    expect(random.calls()).toBe(1);
  });

  it('survives a storage getter that throws', () => {
    const token = readOrCreateSessionToken({
      storage: () => {
        throw new Error('denied');
      },
    });
    expect(isWellFormedSessionToken(token)).toBe(true);
  });

  it('checks the length bounds exactly', () => {
    expect(isWellFormedSessionToken('a'.repeat(21))).toBe(false);
    expect(isWellFormedSessionToken('a'.repeat(22))).toBe(true);
    expect(isWellFormedSessionToken('a'.repeat(128))).toBe(true);
    expect(isWellFormedSessionToken(null)).toBe(false);
  });
});

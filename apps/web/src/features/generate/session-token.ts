/** The one sessionStorage key that holds the tab's worker session token. */
export const SESSION_TOKEN_KEY = 'etc.session-token';

/** 24 random bytes = 192 bits, which gives a 32-character base64url token (at least 128 bits is required). */
const TOKEN_BYTES = 24;
const MIN_LENGTH = 22;
const MAX_LENGTH = 128;
const WELL_FORMED = /^[A-Za-z0-9_-]+$/;

export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SessionTokenDeps {
  /** Defaults to `globalThis.sessionStorage`; access is guarded, so a throwing store is fine. */
  readonly storage?: TokenStorage | (() => TokenStorage);
  /** Fills the array with random bytes. Defaults to `crypto.getRandomValues`. */
  readonly getRandomValues?: (bytes: Uint8Array) => Uint8Array;
}

/** True for a base64url string of 22 to 128 characters, the worker's "well-formed" rule. */
export function isWellFormedSessionToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= MIN_LENGTH &&
    value.length <= MAX_LENGTH &&
    WELL_FORMED.test(value)
  );
}

/** Base64url without padding. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function resolveStorage(deps: SessionTokenDeps): TokenStorage | null {
  try {
    const source = deps.storage ?? globalThis.sessionStorage;
    const storage = typeof source === 'function' ? source() : source;
    return storage ?? null;
  } catch {
    return null;
  }
}

function newToken(deps: SessionTokenDeps): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  const fill = deps.getRandomValues ?? ((b: Uint8Array) => crypto.getRandomValues(b));
  fill(bytes);
  return toBase64Url(bytes);
}

/**
 * Returns the tab's session token: the stored one when it is well-formed, otherwise a new
 * one that is stored. A throwing or missing store never throws out of here; the caller
 * then keeps the returned value for the session (see `createSessionToken`).
 */
export function readOrCreateSessionToken(deps: SessionTokenDeps = {}): string {
  const storage = resolveStorage(deps);
  if (storage !== null) {
    try {
      const stored = storage.getItem(SESSION_TOKEN_KEY);
      if (isWellFormedSessionToken(stored)) return stored;
    } catch {
      // fall through and make a new token
    }
  }
  const token = newToken(deps);
  if (storage !== null) {
    try {
      storage.setItem(SESSION_TOKEN_KEY, token);
    } catch {
      // keep the in-memory token
    }
  }
  return token;
}

/**
 * A getter that reads or creates the token once, then keeps it in memory, so a store that
 * throws on every call still gives one stable token for the page's lifetime.
 */
export function createSessionToken(deps: SessionTokenDeps = {}): () => string {
  let cached: string | null = null;
  return () => {
    cached ??= readOrCreateSessionToken(deps);
    return cached;
  };
}

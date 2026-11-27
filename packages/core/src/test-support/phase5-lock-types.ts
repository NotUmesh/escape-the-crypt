import type { LockType } from '../types';

/**
 * Lock types that Phase 5 tests allow through their own explicit options.
 * Not a production allow-list: DEFAULT_ALLOWED_LOCK_TYPES and the worker's ALLOWED_LOCK_TYPES stay unchanged.
 *
 * This list grows with each type group, and the allowed list is part of the generation prompt and schema,
 * so it changes prompt digests. Cassette fixtures must pin their own explicit list instead of importing
 * this constant, so later additions never drift recorded digests.
 */
export const PHASE5_TEST_ALLOWED_LOCK_TYPES: readonly LockType[] = [
  'rune-cipher',
  'seance-board',
  'bone-ordering',
  'bound-threads',
  'cursed-object',
];

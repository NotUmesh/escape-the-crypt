import type { LockType } from '../types';

/**
 * Lock types that Phase 5 tests allow through their own explicit options.
 * Not a production allow-list: DEFAULT_ALLOWED_LOCK_TYPES and the worker's ALLOWED_LOCK_TYPES stay unchanged.
 */
export const PHASE5_TEST_ALLOWED_LOCK_TYPES: readonly LockType[] = ['rune-cipher', 'seance-board', 'bone-ordering'];

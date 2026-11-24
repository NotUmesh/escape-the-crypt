import { EVENT_KINDS, LOCK_TYPES } from '../types';
import type { Event, EventKind } from '../types';

const KINDS: ReadonlySet<string> = new Set(EVENT_KINDS);

const STRING_FIELD: Readonly<Partial<Record<EventKind, 'manifestId' | 'roomId' | 'slotId'>>> = {
  RunStarted: 'manifestId',
  RoomPublished: 'roomId',
  RoomEntered: 'roomId',
  LockOpened: 'slotId',
  HintUsed: 'slotId',
  AnswerSubmitted: 'slotId',
  Skipped: 'slotId',
  Challenged: 'slotId',
  EvidenceContinued: 'slotId',
};

/**
 * True when `value` is a well-formed Event: a known kind, the string or count field that
 * kind needs, and (for AnswerSubmitted) a present submission. A `lockType` field, if
 * present, must name a real lock type. Never throws.
 */
export function isEvent(value: unknown): value is Event {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  const kind = record['kind'];
  if (typeof kind !== 'string' || !KINDS.has(kind)) return false;
  const field = STRING_FIELD[kind as EventKind];
  if (field !== undefined && typeof record[field] !== 'string') return false;
  if (kind === 'CryptFinalised' || kind === 'CryptShortened') {
    const count = record['finalRoomCount'];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return false;
  }
  if (kind === 'AnswerSubmitted' && record['submission'] === undefined) return false;
  if ('lockType' in record && !(LOCK_TYPES as readonly unknown[]).includes(record['lockType'])) {
    return false;
  }
  return true;
}

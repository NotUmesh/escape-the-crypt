import { LOCK_TYPES } from '../types';
import type { CryptManifest } from './manifest-types';

export type InvalidManifestError =
  | { readonly kind: 'invalid-manifest'; readonly room: string; readonly lockType: string }
  | { readonly kind: 'invalid-manifest'; readonly questionId: string; readonly slotId?: string }
  | { readonly kind: 'invalid-manifest'; readonly lockType: string }
  | { readonly kind: 'invalid-manifest'; readonly reason: 'malformed' }
  | { readonly kind: 'invalid-manifest'; readonly reason: 'too-many-final-door-questions'; readonly count: number };

/** The Manifest holds 0 to 4 reserved final-door questions (Req 20.1). */
export const MAX_RESERVED_FINAL_DOOR_QUESTIONS = 4;

export type ManifestCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: InvalidManifestError };

type Rec = Readonly<Record<string, unknown>>;

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? (value as readonly unknown[]) : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isLockType(value: unknown): boolean {
  return typeof value === 'string' && (LOCK_TYPES as readonly string[]).includes(value);
}

const MALFORMED: ManifestCheckResult = {
  ok: false,
  error: { kind: 'invalid-manifest', reason: 'malformed' },
};

interface SlotView {
  readonly roomId: string;
  readonly slotId: string;
  readonly stationType: unknown;
  readonly questions: readonly unknown[]; // primary, then Alternate when present
}

function readRooms(manifest: Rec): readonly { roomId: string; slots: readonly SlotView[] }[] | null {
  const rooms = asArray(manifest['rooms']);
  if (rooms === null) return null;
  const out: { roomId: string; slots: readonly SlotView[] }[] = [];
  for (const room of rooms) {
    if (!isRec(room)) return null;
    const slots = asArray(room['lockSlots']);
    if (slots === null) return null;
    const roomId = str(room['roomId']);
    const views: SlotView[] = [];
    for (const slot of slots) {
      if (!isRec(slot)) return null;
      const alt = slot['alternateQuestion'];
      views.push({
        roomId,
        slotId: str(slot['slotId']),
        stationType: slot['stationType'],
        questions: alt === null || alt === undefined ? [slot['primaryQuestion']] : [slot['primaryQuestion'], alt],
      });
    }
    out.push({ roomId, slots: views });
  }
  return out;
}

function readReserved(manifest: Rec): readonly { slotId: string; question: unknown }[] | null {
  const finalDoor = manifest['finalDoor'];
  if (!isRec(finalDoor)) return null;
  const slots = asArray(finalDoor['slots']);
  if (slots === null) return null;
  const out: { slotId: string; question: unknown }[] = [];
  for (const slot of slots) {
    if (!isRec(slot)) return null;
    out.push({ slotId: str(slot['slotId']), question: slot['question'] });
  }
  return out;
}

function lockTypeOf(question: unknown): unknown {
  return isRec(question) ? question['lockType'] : undefined;
}

/**
 * Accepts a manifest only when every lock type is valid, each room holds at most one
 * Lock_Slot per Station_Type (the final door is exempt) and every question carries a
 * non-empty questionId that is unique in the manifest. Passes run in that order and the
 * first failure is returned. Pure; never throws.
 */
export function manifestCheck(manifest: CryptManifest): ManifestCheckResult {
  const root: unknown = manifest;
  if (!isRec(root)) return MALFORMED;
  const rooms = readRooms(root);
  const reserved = readReserved(root);
  if (rooms === null || reserved === null) return MALFORMED;

  // Pass 1: lock types (Req 27.4).
  for (const room of rooms) {
    for (const slot of room.slots) {
      for (const candidate of [slot.stationType, ...slot.questions.map(lockTypeOf)]) {
        if (!isLockType(candidate)) {
          return { ok: false, error: { kind: 'invalid-manifest', lockType: str(candidate) } };
        }
      }
    }
  }
  for (const entry of reserved) {
    const candidate = lockTypeOf(entry.question);
    if (!isLockType(candidate)) {
      return { ok: false, error: { kind: 'invalid-manifest', lockType: str(candidate) } };
    }
  }

  // Pass 2: one Station_Type per room (Req 28.1 to 28.3, 28.10).
  for (const room of rooms) {
    const seen = new Set<string>();
    for (const slot of room.slots) {
      const type = str(slot.stationType);
      if (seen.has(type)) {
        return { ok: false, error: { kind: 'invalid-manifest', room: room.roomId, lockType: type } };
      }
      seen.add(type);
    }
  }

  // Pass 3: question IDs, in the order primary, Alternate, then reserved (Req 28.8, 28.9).
  const seenIds = new Set<string>();
  const entries: { slotId: string; question: unknown }[] = [];
  for (const room of rooms) {
    for (const slot of room.slots) {
      for (const question of slot.questions) entries.push({ slotId: slot.slotId, question });
    }
  }
  entries.push(...reserved);
  for (const entry of entries) {
    const id = isRec(entry.question) ? entry.question['questionId'] : undefined;
    if (typeof id !== 'string' || id === '') {
      return { ok: false, error: { kind: 'invalid-manifest', questionId: '', slotId: entry.slotId } };
    }
    if (seenIds.has(id)) {
      return { ok: false, error: { kind: 'invalid-manifest', questionId: id } };
    }
    seenIds.add(id);
  }

  // Pass 4: at most MAX_RESERVED_FINAL_DOOR_QUESTIONS reserved final-door questions (Req 20.1).
  if (reserved.length > MAX_RESERVED_FINAL_DOOR_QUESTIONS) {
    return {
      ok: false,
      error: { kind: 'invalid-manifest', reason: 'too-many-final-door-questions', count: reserved.length },
    };
  }
  return { ok: true };
}

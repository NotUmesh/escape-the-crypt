import type { CryptManifest, FinalDoorSlotSpec, LockSlotSpec, QuestionSpec, RoomSpec } from '../runtime/manifest-types';
import { LOCK_TYPES } from '../types';
import type { LockType } from '../types';
import { buildPayload } from './question-payloads';

export type QuestionRole = 'primary' | 'alternate' | 'reserved';

export interface BuildManifestOptions {
  readonly manifestId?: string;
  /** 1 to 5. Default 2. */
  readonly rooms?: number;
  /** 1 to 6, capped at the number of lock types. Default 3. */
  readonly conceptsPerRoom?: number;
  /** Whether each concept has an Alternate. Default true. Ignored with a single lock type. */
  readonly alternates?: boolean | ((roomIndex: number, conceptIndex: number) => boolean);
  /** Whether each question carries a hint effect. Default false. Rune ciphers get reveal-first-letter. */
  readonly hintEffects?: boolean | ((role: QuestionRole, questionId: string) => boolean);
  /** Lock types to draw from. Default all six. */
  readonly lockTypes?: readonly LockType[];
  /** 0 to 4 reserved final-door questions. Default 2. */
  readonly finalDoorQuestions?: number;
  /** Without a seed the builder uses no randomness at all. */
  readonly seed?: number;
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  const v = value === undefined || !Number.isFinite(value) ? fallback : Math.trunc(value);
  return Math.min(max, Math.max(min, v));
}

/** Small deterministic generator (mulberry32). */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a valid manifest from a few options. Same options give the same manifest.
 * Content is fictional; every questionId is a unique counter value.
 */
export function buildManifest(options: BuildManifestOptions = {}): CryptManifest {
  const types: LockType[] = [...new Set(options.lockTypes ?? LOCK_TYPES)];
  if (types.length === 0) types.push(...LOCK_TYPES);
  const roomCount = clamp(options.rooms, 1, 5, 2);
  const conceptCount = Math.min(clamp(options.conceptsPerRoom, 1, 6, 3), types.length);
  const finalCount = clamp(options.finalDoorQuestions, 0, 4, 2);
  const rng = options.seed === undefined ? null : makeRng(options.seed);
  const pickIndex = (length: number, fallback: number): number =>
    rng === null ? fallback % length : Math.floor(rng() * length);

  let counter = 0;
  const makeQuestion = (role: QuestionRole, lockType: LockType): QuestionSpec => {
    counter += 1;
    const questionId = `q${counter}`;
    const built = buildPayload(lockType, questionId, counter);
    const wanted = options.hintEffects;
    const hinted = typeof wanted === 'function' ? wanted(role, questionId) : wanted === true;
    return {
      questionId,
      lockType,
      payload: built.payload,
      evidenceRefs: [`chk_fixture_${counter}`],
      hintEffect: hinted ? built.hint : null,
    };
  };

  const concepts: string[] = [];
  const rooms: RoomSpec[] = [];
  for (let r = 0; r < roomCount; r += 1) {
    // Distinct primary types per room: rotate (no seed) or shuffle (seed) the list.
    const order = [...types];
    if (rng === null) {
      for (let i = 0; i < r % order.length; i += 1) order.push(order.shift() as LockType);
    } else {
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j] as LockType, order[i] as LockType];
      }
    }
    const lockSlots: LockSlotSpec[] = [];
    for (let c = 0; c < conceptCount; c += 1) {
      const primaryType = order[c] as LockType;
      const conceptId = `concept-${r + 1}-${c + 1}`;
      concepts.push(conceptId);
      const primaryQuestion = makeQuestion('primary', primaryType);
      const others = types.filter((t) => t !== primaryType);
      const wantAlternate =
        typeof options.alternates === 'function'
          ? options.alternates(r, c)
          : options.alternates !== false;
      const alternateQuestion =
        wantAlternate && others.length > 0
          ? makeQuestion('alternate', others[pickIndex(others.length, r + c)] as LockType)
          : null;
      lockSlots.push({
        slotId: `room-${r + 1}-slot-${c + 1}`,
        stationType: primaryType,
        conceptId,
        primaryQuestion,
        alternateQuestion,
      });
    }
    rooms.push({ roomId: `room-${r + 1}`, lockSlots });
  }

  const finalSlots: FinalDoorSlotSpec[] = [];
  for (let k = 0; k < finalCount; k += 1) {
    const conceptId = concepts[pickIndex(concepts.length, Math.floor((k * concepts.length) / finalCount))] as string;
    const lockType = types[pickIndex(types.length, k)] as LockType;
    finalSlots.push({
      slotId: `final-door-slot-${k + 1}`,
      conceptId,
      question: makeQuestion('reserved', lockType),
    });
  }

  return {
    manifestId: options.manifestId ?? 'fixture-manifest',
    rooms,
    finalDoor: { slots: finalSlots },
  };
}

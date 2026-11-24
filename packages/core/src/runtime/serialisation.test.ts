import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { eventArb, manifestArb } from '../test-support/arbitraries';
import { buildManifest } from '../test-support/manifest-fixture';
import { submissionFor } from '../test-support/question-answers';
import { questionFor, roomTargets, openTargets } from '../test-support/runtime-model-support';
import { SETTINGS } from '../test-support/run-settings';
import { EVENT_KINDS, LOCK_TYPES } from '../types';
import type { Event, LockType } from '../types';
import { apply } from './apply';
import { initial } from './initial';
import type { CryptManifest } from './manifest-types';
import type { State } from './state-types';

/** Fails on undefined, functions, Set, Map, Date, class instances and non-finite numbers. */
function expectPlainJson(value: unknown, path = '$'): void {
  if (value === null) return;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      expect(Number.isFinite(value), `${path} is not finite`).toBe(true);
      return;
    case 'object': {
      if (Array.isArray(value)) {
        value.forEach((item, i) => expectPlainJson(item, `${path}[${i}]`));
        return;
      }
      // fast-check records may have a null prototype; both are plain data.
      const proto: unknown = Object.getPrototypeOf(value);
      expect(proto === Object.prototype || proto === null, `${path} is not a plain object`).toBe(true);
      for (const [key, item] of Object.entries(value)) expectPlainJson(item, `${path}.${key}`);
      return;
    }
    default:
      expect.unreachable(`${path} has type ${typeof value}`);
  }
}

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const SUBMISSIONS: Readonly<Record<LockType, unknown>> = {
  'rune-cipher': { text: 'glimmerstone' },
  'seance-board': { selectedOptionId: 'q1-o2' },
  'bone-ordering': { order: ['b3', 'b2', 'b1', 'b0'] },
  'bound-threads': {
    pairs: [
      ['l0', 'r1'],
      ['l1', 'r2'],
    ],
  },
  'cursed-object': { selectedId: 'q4-o0' },
  'combination-dial': { rawInput: '21.5' },
};

const VARIANTS: readonly Event[] = [
  { kind: 'RunStarted', manifestId: 'fixture-manifest' },
  { kind: 'RoomPublished', roomId: 'room-1' },
  { kind: 'CryptFinalised', finalRoomCount: 3 },
  { kind: 'CryptShortened', finalRoomCount: 2 },
  { kind: 'RoomEntered', roomId: 'room-1' },
  { kind: 'LockOpened', slotId: 'room-1-slot-1' },
  { kind: 'HintUsed', slotId: 'room-1-slot-1' },
  { kind: 'AnswerSubmitted', slotId: 'room-1-slot-1', submission: SUBMISSIONS['rune-cipher'] },
  { kind: 'Skipped', slotId: 'room-1-slot-1' },
  { kind: 'Challenged', slotId: 'room-1-slot-1' },
  { kind: 'EvidenceContinued', slotId: 'room-1-slot-1' },
  { kind: 'FinalDoorEntered' },
  { kind: 'RunLeft' },
  { kind: 'RunResumed' },
];

describe('event serialisation', () => {
  it('has an example for every Event kind', () => {
    expect(VARIANTS.map((e) => e.kind)).toEqual([...EVENT_KINDS]);
  });

  it.each(VARIANTS.map((e) => [e.kind, e] as const))('%s survives a JSON round trip', (_kind, event) => {
    expectPlainJson(event);
    expect(roundTrip(event)).toStrictEqual(event);
  });

  it.each(LOCK_TYPES.map((t) => [t] as const))('AnswerSubmitted for %s survives a JSON round trip', (type) => {
    const event: Event = { kind: 'AnswerSubmitted', slotId: 's', submission: SUBMISSIONS[type] };
    expectPlainJson(event);
    expect(roundTrip(event)).toStrictEqual(event);
  });

  it('keeps bound-threads pairs as tuple arrays', () => {
    const pairs = (SUBMISSIONS['bound-threads'] as { pairs: unknown[] }).pairs;
    expect(pairs.every((p) => Array.isArray(p) && p.length === 2)).toBe(true);
  });

  it('generated events survive a JSON round trip', () => {
    fc.assert(
      fc.property(eventArb, (event) => {
        expectPlainJson(event);
        expect(roundTrip(event)).toStrictEqual(event);
      }),
      { numRuns: 100 },
    );
  });
});

describe('state serialisation', () => {
  it('initial State survives a JSON round trip with no Set, Map or undefined', () => {
    const state = initial(buildManifest({ rooms: 3, conceptsPerRoom: 6, hintEffects: true }), SETTINGS);
    expectPlainJson(state);
    expect(roundTrip(state)).toStrictEqual(state);
  });

  it('initial State from generated manifests is plain JSON', () => {
    fc.assert(
      fc.property(manifestArb, (manifest) => {
        const state = initial(manifest, SETTINGS);
        expectPlainJson(state);
        expect(roundTrip(state)).toStrictEqual(state);
      }),
      { numRuns: 50 },
    );
  });

  it('a started State survives a JSON round trip', () => {
    const manifest = buildManifest();
    const result = apply(initial(manifest, SETTINGS), { kind: 'RunStarted', manifestId: manifest.manifestId });
    if (!result.ok) throw new Error('setup');
    expectPlainJson(result.state);
    expect(roundTrip(result.state)).toStrictEqual(result.state);
  });
});

// --- Property 6: replay determinism --------------------------------------------------------

interface Fold {
  readonly final: State;
  readonly states: readonly State[];
  /** Rejection kind per event, or null when the event was accepted. */
  readonly rejections: readonly (string | null)[];
}

function fold(start: State, events: readonly Event[]): Fold {
  let state = start;
  const states: State[] = [];
  const rejections: (string | null)[] = [];
  for (const event of events) {
    const result = apply(state, event);
    if (result.ok) state = result.state;
    rejections.push(result.ok ? null : result.error.kind);
    states.push(state);
  }
  return { final: state, states, rejections };
}

interface Step {
  readonly choice: number;
  readonly pick: number;
  readonly correct: boolean;
  readonly noise: Event;
}

const stepArb: fc.Arbitrary<Step> = fc.record({
  choice: fc.integer({ min: 0, max: 99 }),
  pick: fc.nat(50),
  correct: fc.boolean(),
  noise: eventArb,
});

/** Walks the reducer from a started run, so logs reach answers, skips and challenges as well as rejections. */
function buildLog(manifest: CryptManifest, steps: readonly Step[]): Event[] {
  const log: Event[] = [{ kind: 'RunStarted', manifestId: manifest.manifestId }];
  for (const room of manifest.rooms) log.push({ kind: 'RoomPublished', roomId: room.roomId });
  log.push({ kind: 'RoomEntered', roomId: manifest.rooms[0]?.roomId ?? '' });
  let state = fold(initial(manifest, SETTINGS), log).final;
  for (const step of steps) {
    const open = openTargets(state);
    const target = open.length === 0 ? undefined : open[step.pick % open.length];
    let event: Event = step.noise;
    if (target !== undefined && step.choice < 80) {
      const slotId = target.slotId;
      if (step.choice < 45) {
        const submission = submissionFor(questionFor(manifest, target.questionId), step.correct);
        event = { kind: 'AnswerSubmitted', slotId, submission };
      } else if (step.choice < 55) event = { kind: 'HintUsed', slotId };
      else if (step.choice < 65) event = { kind: 'Skipped', slotId };
      else if (step.choice < 72) event = { kind: 'Challenged', slotId };
      else event = { kind: 'EvidenceContinued', slotId };
    } else if (step.choice >= 90) {
      event = { kind: 'EvidenceContinued', slotId: roomTargets(state)[0]?.slotId ?? 'none' };
    }
    log.push(event);
    const result = apply(state, event);
    if (result.ok) state = result.state;
  }
  return log;
}

describe('Property 6: replay determinism', () => {
  it('replays a generated log deterministically, in prefixes and through JSON', () => {
    let sawAnswer = false;
    let sawRejection = false;
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        fc.array(stepArb, { minLength: 1, maxLength: 40 }),
        fc.nat(100),
        (rooms, steps, cut) => {
          const manifest = buildManifest({ rooms, conceptsPerRoom: 4, hintEffects: true });
          const start = initial(manifest, SETTINGS);
          const log = buildLog(manifest, steps);
          const whole = fold(start, log);

          // Each event survives a JSON round trip.
          const replayed = log.map((e) => roundTrip(e));
          expect(replayed).toStrictEqual(log);
          // Folding the log equals folding its JSON round trip, rejections included.
          const again = fold(start, replayed);
          expect(again.final).toStrictEqual(whole.final);
          expect(again.rejections).toStrictEqual(whole.rejections);
          // A prefix, then the rest, equals all at once.
          const at = cut % (log.length + 1);
          const head = fold(start, log.slice(0, at));
          expect(fold(head.final, log.slice(at)).final).toStrictEqual(whole.final);
          // Every intermediate State survives a JSON round trip.
          for (const state of whole.states) {
            expectPlainJson(state);
            expect(roundTrip(state)).toStrictEqual(state);
          }
          sawAnswer ||= whole.final.judgedAnswerCount > 0;
          sawRejection ||= whole.rejections.some((r) => r !== null);
        },
      ),
      { numRuns: 60 },
    );
    expect(sawAnswer).toBe(true);
    expect(sawRejection).toBe(true);
  });
});

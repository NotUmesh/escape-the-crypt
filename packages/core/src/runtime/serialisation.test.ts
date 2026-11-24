import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { eventArb, manifestArb } from '../test-support/arbitraries';
import { buildManifest } from '../test-support/manifest-fixture';
import { SETTINGS } from '../test-support/run-settings';
import { EVENT_KINDS, LOCK_TYPES } from '../types';
import type { Event, LockType } from '../types';
import { apply } from './apply';
import { initial } from './initial';

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

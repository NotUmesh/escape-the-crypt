import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import fc from 'fast-check';
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHumanHeartSampleCrypt } from '@escape-the-crypt/core';
import type { Event, HumanHeartQuestionsFile, SampleCryptResult } from '@escape-the-crypt/core';
import { usePersistedRoom } from './persisted-room';
import type { BuildCrypt, RoomBinding } from './room-binding';
import type { RoomAction } from './room-actions';
import { createEventWriter } from './storage/event-writer';
import type { AppendFn } from './storage/event-writer';
import { loadEvents } from './storage/run-repository';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAMPLES = join(process.cwd(), '..', '..', 'samples');

function build(): SampleCryptResult {
  const notes = readFileSync(join(SAMPLES, 'human-heart.txt'), 'utf8');
  const file = JSON.parse(
    readFileSync(join(SAMPLES, 'questions', 'human-heart.json'), 'utf8'),
  ) as HumanHeartQuestionsFile;
  const built = buildHumanHeartSampleCrypt(notes, file);
  if (!built.ok) throw new Error(`sample crypt failed: ${built.error.kind}`);
  return built.value;
}

const CRYPT = build();
const okBuild: BuildCrypt = () => ({ ok: true, value: CRYPT });
const slotIds = CRYPT.manifest.rooms.flatMap((r) => r.lockSlots.map((s) => s.slotId));
const RUN_ID = 'run-concurrent';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// Feature: persistence, Property 15: Concurrent accepts are written once, in order, only for accepted events
describe('writer: concurrent enqueues are written once, in order', () => {
  it('events enqueued without awaiting are appended exactly once each, in enqueue order', async () => {
    // **Validates: Requirements 6.3, 6.4**
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 15 }), fc.integer({ min: 0, max: 3 }), async (count, jitter) => {
        const seen: string[] = [];
        let active = 0;
        let overlapped = false;
        const append: AppendFn = async (_f, _id, event) => {
          active += 1;
          if (active > 1) overlapped = true;
          for (let i = 0; i < (seen.length * jitter) % 4; i += 1) await Promise.resolve();
          seen.push(event.kind === 'RoomPublished' ? event.roomId : '?');
          active -= 1;
          return { ok: true, value: { seq: seen.length - 1 } };
        };
        const writer = createEventWriter({ factory: new IDBFactory(), runId: RUN_ID, append });
        const events = Array.from({ length: count }, (_, i) => ({ kind: 'RoomPublished', roomId: `r${i}` }) as Event);
        const outcomes = await Promise.all(events.map((e) => writer.enqueue(e)));
        expect(outcomes).toEqual(events.map((_, i) => ({ status: 'saved', seq: i })));
        expect(seen).toEqual(events.map((_, i) => `r${i}`));
        expect(overlapped).toBe(false);
        expect(writer.unsaved()).toEqual([]);
      }),
      { numRuns: 50 },
    );
  });
});

describe('usePersistedRoom: concurrent accepts and rejects', () => {
  let root: Root;
  let current: RoomBinding;
  let factory: IDBFactory;

  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });
  afterEach(() => {
    act(() => root.unmount());
  });
  beforeEach(() => {
    root = createRoot(document.createElement('div'));
    factory = new IDBFactory();
  });

  function Probe(): null {
    current = usePersistedRoom(okBuild, { factory, newRunId: () => RUN_ID, now: () => 1 });
    return null;
  }

  // Each append is a separate IndexedDB transaction, so a fixed number of ticks is not enough once
  // a batch adds several events. Wait until the stored count reaches the log length and stays there
  // for a few more ticks (so a late duplicate would still show). Bounded, so a lost event fails.
  const settle = async (): Promise<void> => {
    let extra = 0;
    for (let i = 0; i < 200 && extra < 3; i += 1) {
      await act(async () => tick());
      const loaded = await loadEvents(factory, RUN_ID);
      const count = loaded.ok ? loaded.value.length : -1;
      extra = count >= current.eventLog.length ? extra + 1 : 0;
    }
  };

  async function storedEvents(): Promise<readonly Event[]> {
    const loaded = await loadEvents(factory, RUN_ID);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return [];
    expect(loaded.value.map((row) => row.seq)).toEqual(loaded.value.map((_, i) => i));
    return loaded.value.map((row) => row.event);
  }

  const actionFor = (kind: number, slotIndex: number): RoomAction => {
    const slotId = slotIds[slotIndex % slotIds.length] ?? '';
    switch (kind) {
      case 0:
        return { type: 'openLock', slotId };
      case 1:
        return { type: 'openLock', slotId: 'no-such-slot' };
      case 2:
        return { type: 'submitAnswer', slotId, submission: { text: 'zzz' } };
      case 3:
        return { type: 'skip', slotId };
      case 4:
        return { type: 'useHint', slotId };
      default:
        return { type: 'enterRoom', roomId: 'no-such-room' };
    }
  };

  it('stores exactly the accepted events, once each, in order, whatever the batching', async () => {
    // **Validates: Requirements 6.3, 6.4**
    const step = fc.record({ kind: fc.integer({ min: 0, max: 5 }), slot: fc.integer({ min: 0, max: 20 }) });
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.array(step, { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 4 }),
        async (batches) => {
          factory = new IDBFactory();
          root = createRoot(document.createElement('div'));
          act(() => root.render(createElement(Probe)));
          act(() => current.dispatch({ type: 'startRun' }));
          // Each batch is dispatched in one act, so React sees the actions in the same tick.
          for (const batch of batches) {
            act(() => {
              for (const s of batch) current.dispatch(actionFor(s.kind, s.slot));
            });
          }
          await settle();
          const expected = current.eventLog;
          expect(await storedEvents()).toEqual(expected);
          act(() => root.unmount());
        },
      ),
      { numRuns: 25 },
    );
  });

  it('stores both events when two accepted actions land in one render', async () => {
    // **Validates: Requirements 6.3**
    act(() => root.render(createElement(Probe)));
    act(() => current.dispatch({ type: 'startRun' }));
    const before = current.eventLog.length;
    act(() => {
      current.dispatch(actionFor(0, 0));
      current.dispatch(actionFor(2, 0));
    });
    expect(current.eventLog.length).toBe(before + 2);
    await settle();
    expect(await storedEvents()).toEqual(current.eventLog);
  });

  it('rejected actions write nothing', async () => {
    // **Validates: Requirements 6.4**
    act(() => root.render(createElement(Probe)));
    act(() => current.dispatch({ type: 'startRun' }));
    await settle();
    const before = await storedEvents();
    expect(before).toHaveLength(4);
    act(() => {
      current.dispatch(actionFor(1, 0));
      current.dispatch(actionFor(5, 0));
    });
    await settle();
    expect(await storedEvents()).toEqual(before);
  });
});

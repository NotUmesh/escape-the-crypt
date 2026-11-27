import fc from 'fast-check';
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { State } from '@escape-the-crypt/core';
import { SAMPLE_CRYPT } from '../test-support/sample-bundle';
import { usePersistedRoom } from './persisted-room';
import type { PersistedRoomOptions } from './persisted-room';
import type { RoomAction } from './room-actions';
import type { BuildCrypt, RoomBinding } from './room-binding';
import { loadEvents, loadRun } from './storage/run-repository';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const okBuild: BuildCrypt = () => ({ ok: true, value: SAMPLE_CRYPT });

interface Harness {
  readonly factory: IDBFactory;
  readonly send: (action: RoomAction) => void;
  readonly binding: () => RoomBinding;
  readonly runIds: string[];
  readonly unmount: () => void;
}

function mountPersisted(): Harness {
  const factory = new IDBFactory();
  const runIds: string[] = [];
  let counter = 0;
  // Stable option functions, so the hook's callbacks keep their identity across renders.
  const options: PersistedRoomOptions = {
    factory,
    now: () => 1_000,
    newRunId: () => {
      counter += 1;
      const id = `run-${counter}`;
      runIds.push(id);
      return id;
    },
  };
  let latest: RoomBinding | null = null;
  function Probe(): null {
    latest = usePersistedRoom(okBuild, options);
    return null;
  }
  const root: Root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Probe)));
  const binding = (): RoomBinding => {
    if (latest === null) throw new Error('not rendered');
    return latest;
  };
  return {
    factory,
    send: (action) => act(() => binding().dispatch(action)),
    binding,
    runIds,
    unmount: () => act(() => root.unmount()),
  };
}

/** Lets pending IndexedDB work and effects settle until `done` holds. */
async function waitUntil(done: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (await done()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error('timed out waiting for storage');
}

async function storedEvents(h: Harness, runId: string): Promise<unknown[]> {
  const loaded = await loadEvents(h.factory, runId);
  if (!loaded.ok) throw new Error(`loadEvents: ${loaded.error.kind}`);
  return loaded.value.map((row) => row.event);
}

async function storedStatus(h: Harness, runId: string): Promise<string | null> {
  const loaded = await loadRun(h.factory, runId);
  return loaded.ok ? loaded.value.status : null;
}

/** Waits until every Event in the in-memory log is stored for the run. */
async function waitSaved(h: Harness, runId: string): Promise<void> {
  await waitUntil(async () => (await storedEvents(h, runId).catch(() => [])).length === h.binding().eventLog.length);
}

function openSlotIds(state: State): string[] {
  const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
  const slots = state.atFinalDoor
    ? state.finalDoor.slots
    : [...(room?.lockSlots ?? []), ...(room?.dueReturnSlots ?? [])];
  return slots.filter((s) => s.status === 'open').map((s) => s.slotId);
}

/** Settles open slots (skip or challenge, per `policy`) and enters the final door, for at most `steps` actions. */
function play(h: Harness, policy: readonly boolean[], steps: number): void {
  let used = 0;
  for (let guard = 0; guard < 200 && used < steps; guard += 1) {
    const state = h.binding().state;
    if (state === null || state.status !== 'in progress') return;
    const [slotId] = openSlotIds(state);
    if (slotId !== undefined) {
      h.send({ type: 'openLock', slotId });
      h.send({ type: policy[used % policy.length] ? 'challenge' : 'skip', slotId });
      if (h.binding().rejection !== null) h.send({ type: 'skip', slotId });
      used += 1;
    } else if (state.finalDoor.available && !state.atFinalDoor) {
      h.send({ type: 'enterFinalDoor' });
      used += 1;
    } else return;
  }
}

describe('usePersistedRoom run status', () => {
  beforeAll(() => {
    // The repository builds key ranges from the global IDBKeyRange, which jsdom does not provide.
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  // Feature: persistence, Property 8: Reaching escaped or starting again sets status without losing events
  it('sets the run to escaped once the reducer reaches the escape', async () => {
    // **Validates: Requirements 3.3, 3.4**
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }), async (policy) => {
        const h = mountPersisted();
        try {
          h.send({ type: 'startRun' });
          const runId = h.runIds[0] ?? '';
          await waitSaved(h, runId);
          expect(await storedStatus(h, runId)).toBe('active');
          play(h, policy, 500);
          expect(h.binding().state?.status).toBe('escaped');
          await waitUntil(async () => (await storedStatus(h, runId)) === 'escaped');
          await waitSaved(h, runId);
          expect(await storedEvents(h, runId)).toEqual(h.binding().eventLog);
        } finally {
          h.unmount();
        }
      }),
      { numRuns: 6 },
    );
  }, 120_000);

  // Feature: persistence, Property 8: Reaching escaped or starting again sets status without losing events
  it('playAgain sets the old run to left, keeps its events and starts a new run', async () => {
    // **Validates: Requirements 3.3, 3.4**
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 0, max: 3 }),
        async (policy, steps) => {
          const h = mountPersisted();
          try {
            h.send({ type: 'startRun' });
            const oldId = h.runIds[0] ?? '';
            play(h, policy, steps);
            if (h.binding().state?.status !== 'in progress') return;
            await waitSaved(h, oldId);
            const before = await storedEvents(h, oldId);
            expect(before).toEqual(h.binding().eventLog);

            h.send({ type: 'playAgain' });
            await waitUntil(async () => (await storedStatus(h, oldId)) === 'left');
            const newId = h.runIds[1] ?? '';
            expect(newId).not.toBe('');
            expect(newId).not.toBe(oldId);
            await waitSaved(h, newId);
            expect(await storedStatus(h, newId)).toBe('active');
            expect(await storedEvents(h, oldId)).toEqual(before);
          } finally {
            h.unmount();
          }
        },
      ),
      { numRuns: 6 },
    );
  }, 120_000);
});

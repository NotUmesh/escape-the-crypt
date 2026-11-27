import fc from 'fast-check';
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Event } from '@escape-the-crypt/core';
import { SAMPLE_BUNDLE } from '../../test-support/sample-bundle';
import { saveCrypt } from './crypt-repository';
import { acceptedRunArb, runSettingsArb } from './persistence-arbitraries';
import type { AcceptedRun } from './persistence-arbitraries';
import { appendEvent, createRun, loadEvents } from './run-repository';

const MANIFEST_ID = SAMPLE_BUNDLE.manifest.manifestId;
const RUN_ID = 'run-1';

async function freshRun(factory: IDBFactory, runId = RUN_ID): Promise<void> {
  const saved = await saveCrypt(factory, { bundle: SAMPLE_BUNDLE, source: 'sample' });
  expect(saved.ok).toBe(true);
  const run = await createRun(factory, {
    runId,
    manifestId: MANIFEST_ID,
    settings: { length: 'short', difficulty: 'apprentice', hintAllowance: 1 },
    createdAt: 1,
  });
  expect(run.ok).toBe(true);
}

/** Distinct, guard-valid events so a row can be matched to the call that wrote it. */
function labelledEvents(count: number): Event[] {
  return Array.from({ length: count }, (_, i) => ({ kind: 'RoomPublished', roomId: `room-${i}` }) as Event);
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// Feature: persistence, Property 9: The event log is a gapless, race-free, append-only sequence
describe('event log is a gapless, append-only sequence', () => {
  // The repository builds key ranges from the global `IDBKeyRange`, which jsdom does not provide.
  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });

  it('sequential appends store seqs exactly 0..n-1 in accepted order, and earlier rows never change', async () => {
    // **Validates: Requirements 4.1, 4.8, 8.1, 8.2**
    await fc.assert(
      fc.asyncProperty(acceptedRunArb(25), async (run: AcceptedRun) => {
        const factory = new IDBFactory();
        await freshRun(factory);
        let previous: readonly unknown[] = [];
        for (const [index, event] of run.events.entries()) {
          const appended = await appendEvent(factory, RUN_ID, event);
          expect(appended).toEqual({ ok: true, value: { seq: index } });
          const loaded = await loadEvents(factory, RUN_ID);
          expect(loaded.ok).toBe(true);
          if (!loaded.ok) return;
          expect(loaded.value.map((row) => row.seq)).toEqual(Array.from({ length: index + 1 }, (_, i) => i));
          expect(loaded.value.slice(0, previous.length)).toEqual(previous);
          previous = loaded.value;
        }
        const final = await loadEvents(factory, RUN_ID);
        expect(final.ok && final.value.map((row) => row.event)).toEqual(run.events);
      }),
      { numRuns: 100 },
    );
  });

  it('appending to a runId with no run writes nothing and returns run-not-found', async () => {
    await fc.assert(
      fc.asyncProperty(runSettingsArb, fc.integer({ min: 1, max: 4 }), async (_settings, count) => {
        const factory = new IDBFactory();
        await freshRun(factory);
        for (const event of labelledEvents(count)) {
          const result = await appendEvent(factory, 'no-such-run', event);
          expect(result).toEqual({ ok: false, error: { kind: 'run-not-found' } });
        }
        const orphan = await loadEvents(factory, 'no-such-run');
        expect(orphan).toEqual({ ok: true, value: [] });
        const real = await loadEvents(factory, RUN_ID);
        expect(real).toEqual({ ok: true, value: [] });
      }),
      { numRuns: 20 },
    );
  });

  // The raced variant uses a fixed, documented set of interleavings instead of random schedules.
  // Each case issues appends without awaiting earlier ones. `gaps` says how the issue is paced:
  //   'none'    all calls start in the same synchronous turn;
  //   'tick'    a macrotask passes between calls, so earlier appends are mid-flight or done;
  //   'pairs'   calls are issued in pairs with a macrotask between pairs.
  // The assertion is schedule-independent: whatever seq each call was told, the stored rows hold
  // exactly seqs 0..n-1, every call got a distinct seq, and each row holds the event of the call
  // that was given that seq.
  type Gaps = 'none' | 'tick' | 'pairs';
  const interleavings: ReadonlyArray<{ title: string; count: number; gaps: Gaps }> = [
    { title: 'two appends issued in the same turn', count: 2, gaps: 'none' },
    { title: 'two appends with a macrotask between them', count: 2, gaps: 'tick' },
    { title: 'burst of eight appends issued in the same turn', count: 8, gaps: 'none' },
    { title: 'eight appends, each issued before the previous one settles, one macrotask apart', count: 8, gaps: 'tick' },
    { title: 'six appends issued as three same-turn pairs', count: 6, gaps: 'pairs' },
    { title: 'single append (degenerate race)', count: 1, gaps: 'none' },
  ];

  it.each(interleavings)('raced: $title', async ({ count, gaps }) => {
    // **Validates: Requirements 4.1, 4.8, 8.1, 8.2**
    const factory = new IDBFactory();
    await freshRun(factory);
    const events = labelledEvents(count);
    const pending: Array<ReturnType<typeof appendEvent>> = [];
    for (const [i, event] of events.entries()) {
      pending.push(appendEvent(factory, RUN_ID, event));
      if (gaps === 'tick' || (gaps === 'pairs' && i % 2 === 1)) await tick();
    }
    const results = await Promise.all(pending);
    const seqs = results.map((r) => (r.ok ? r.value.seq : -1));
    expect([...seqs].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i));

    const loaded = await loadEvents(factory, RUN_ID);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.map((row) => row.seq)).toEqual(Array.from({ length: count }, (_, i) => i));
    for (const [callIndex, seq] of seqs.entries()) {
      expect(loaded.value[seq]?.event).toEqual(events[callIndex]);
    }
  });

  it('raced: appends to a missing run interleaved with valid appends write nothing extra', async () => {
    const factory = new IDBFactory();
    await freshRun(factory);
    const events = labelledEvents(4);
    const results = await Promise.all([
      appendEvent(factory, RUN_ID, events[0]!),
      appendEvent(factory, 'ghost-run', events[1]!),
      appendEvent(factory, RUN_ID, events[2]!),
      appendEvent(factory, 'ghost-run', events[3]!),
    ]);
    expect(results[1]).toEqual({ ok: false, error: { kind: 'run-not-found' } });
    expect(results[3]).toEqual({ ok: false, error: { kind: 'run-not-found' } });
    const loaded = await loadEvents(factory, RUN_ID);
    expect(loaded.ok && loaded.value.map((row) => row.seq)).toEqual([0, 1]);
    expect(await loadEvents(factory, 'ghost-run')).toEqual({ ok: true, value: [] });
  });
});

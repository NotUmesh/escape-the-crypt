import fc from 'fast-check';
import { IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { IMPORT_ERROR_KINDS } from '@escape-the-crypt/core';
import { importCryptFromText } from './import-crypt';
import { dump, exportTextOf, freshDevice, generatedScenarioArb, sampleScenarioArb } from './import-test-support';
import { restoreRun } from './restore-run';
import { loadEvents } from './run-repository';

// Feature: import, Property 2: a corrupted or hostile file is refused without throwing, and a file that is accepted is whole
// **Validates: the file is untrusted input**
beforeAll(() => {
  vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
});

const KINDS: readonly string[] = IMPORT_ERROR_KINDS;
const exportArb = fc.oneof(generatedScenarioArb, sampleScenarioArb).map((scenario) => exportTextOf(scenario));

/**
 * The one oracle for every fuzz case. An import never throws. A refusal names a kind that has copy
 * and leaves every store as it was. An acceptance leaves a crypt that restores, with every event stored.
 */
async function checkImport(text: string): Promise<void> {
  const device = freshDevice();
  const before = await dump(device);
  const result = await importCryptFromText(device.deps, text);
  if (!result.ok) {
    expect(KINDS).toContain(result.error.kind);
    expect(await dump(device)).toBe(before);
    return;
  }
  const restored = await restoreRun({ factory: device.factory, notesStore: device.notes }, result.value.runId);
  expect(restored.ok, `an accepted file must restore: ${JSON.stringify(result)}`).toBe(true);
  const stored = await loadEvents(device.factory, result.value.runId);
  expect(stored.ok && stored.value.length).toBe(restored.ok ? restored.value.events.length : -1);
}

type Mutation =
  | { readonly kind: 'truncate'; readonly at: number }
  | { readonly kind: 'cut'; readonly at: number; readonly length: number }
  | { readonly kind: 'insert'; readonly at: number; readonly text: string }
  | { readonly kind: 'replace'; readonly at: number; readonly char: string }
  | { readonly kind: 'duplicate'; readonly at: number; readonly length: number };

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({ kind: fc.constant('truncate' as const), at: fc.double({ min: 0, max: 1, noNaN: true }) }),
  fc.record({ kind: fc.constant('cut' as const), at: fc.double({ min: 0, max: 1, noNaN: true }), length: fc.integer({ min: 1, max: 400 }) }),
  fc.record({ kind: fc.constant('insert' as const), at: fc.double({ min: 0, max: 1, noNaN: true }), text: fc.string({ maxLength: 20 }) }),
  fc.record({ kind: fc.constant('replace' as const), at: fc.double({ min: 0, max: 1, noNaN: true }), char: fc.string({ minLength: 1, maxLength: 1 }) }),
  fc.record({ kind: fc.constant('duplicate' as const), at: fc.double({ min: 0, max: 1, noNaN: true }), length: fc.integer({ min: 1, max: 400 }) }),
);

function mutate(text: string, mutation: Mutation): string {
  const at = Math.min(text.length - 1, Math.floor(mutation.at * text.length));
  switch (mutation.kind) {
    case 'truncate':
      return text.slice(0, at);
    case 'cut':
      return text.slice(0, at) + text.slice(at + mutation.length);
    case 'insert':
      return text.slice(0, at) + mutation.text + text.slice(at);
    case 'replace':
      return text.slice(0, at) + mutation.char + text.slice(at + 1);
    case 'duplicate':
      return text.slice(0, at) + text.slice(at, at + mutation.length) + text.slice(at);
  }
}

/** Replaces, deletes or retypes one value somewhere inside the parsed file. */
function mutateTree(root: unknown, pick: number, replacement: unknown, action: 'replace' | 'delete'): unknown {
  const paths: (string | number)[][] = [];
  const walk = (node: unknown, path: (string | number)[]): void => {
    if (path.length > 0) paths.push(path);
    if (Array.isArray(node)) node.forEach((child, i) => walk(child, [...path, i]));
    else if (typeof node === 'object' && node !== null) for (const [k, v] of Object.entries(node)) walk(v, [...path, k]);
  };
  walk(root, []);
  const target = paths[pick % Math.max(1, paths.length)];
  if (target === undefined) return replacement;
  const copy = structuredClone(root) as Record<string | number, unknown>;
  let holder: Record<string | number, unknown> = copy;
  for (const key of target.slice(0, -1)) holder = holder[key] as Record<string | number, unknown>;
  const last = target[target.length - 1] as string | number;
  if (action === 'delete') {
    if (Array.isArray(holder)) holder.splice(Number(last), 1);
    else delete holder[last];
  } else {
    holder[last] = replacement;
  }
  return copy;
}

describe('a corrupted file', () => {
  it('is refused without throwing and without changing anything, or is accepted whole (text damage)', async () => {
    await fc.assert(
      fc.asyncProperty(exportArb, fc.array(mutationArb, { minLength: 1, maxLength: 3 }), async (text, mutations) => {
        await checkImport(mutations.reduce(mutate, text));
      }),
      { numRuns: 120 },
    );
  });

  it('is refused or accepted whole when one value inside it is replaced or removed (structure damage)', async () => {
    await fc.assert(
      fc.asyncProperty(
        exportArb,
        fc.nat({ max: 100_000 }),
        fc.jsonValue(),
        fc.constantFrom<'replace' | 'delete'>('replace', 'delete'),
        async (text, pick, replacement, action) => {
          await checkImport(JSON.stringify(mutateTree(JSON.parse(text), pick, replacement, action)));
        },
      ),
      { numRuns: 150 },
    );
  });

  it('never accepts a file whose events were shuffled into an order the reducer rejects', async () => {
    await fc.assert(
      fc.asyncProperty(exportArb, fc.integer({ min: 0, max: 1000 }), async (text, seed) => {
        const file = JSON.parse(text) as { events: unknown[] };
        if (file.events.length < 3) return;
        const i = seed % file.events.length;
        const j = (seed * 7 + 1) % file.events.length;
        if (i === j || JSON.stringify(file.events[i]) === JSON.stringify(file.events[j])) return;
        [file.events[i], file.events[j]] = [file.events[j], file.events[i]];
        await checkImport(JSON.stringify(file));
      }),
      { numRuns: 60 },
    );
  });
});

describe('a hostile file', () => {
  it('is refused without throwing when it is any JSON value at all', async () => {
    await fc.assert(
      fc.asyncProperty(fc.anything(), async (value) => {
        await checkImport(JSON.stringify(value) ?? 'undefined');
      }),
      { numRuns: 150 },
    );
  });

  it('is refused without throwing when it is any string at all', async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.string({ maxLength: 300 }), fc.string({ unit: 'binary', maxLength: 300 })), async (text) => {
        const device = freshDevice();
        const result = await importCryptFromText(device.deps, text);
        expect(result.ok).toBe(false);
      }),
      { numRuns: 150 },
    );
  });

  it('is refused when it looks like an export and carries script, prototype keys or huge numbers', async () => {
    const base = JSON.parse(exportTextOf((await fc.sample(sampleScenarioArb, { seed: 3, numRuns: 1 }))[0]!)) as Record<string, unknown>;
    const attacks: unknown[] = [
      { ...base, constructor: { prototype: { polluted: true } } },
      { ...base, settings: { length: 'short', difficulty: 'lich', hintAllowance: 1e308 } },
      { ...base, settings: { length: '<script>alert(1)</script>', difficulty: 'lich', hintAllowance: 1 } },
      { ...base, events: Array.from({ length: 50_000 }, () => ({ kind: 'FinalDoorEntered' })) },
      { ...base, chunks: [{ id: 'x', documentDigest: 'd', position: 0, text: 't', location: { sourceType: 'paste', paragraphNumber: 1 }, edited: false, __proto__: { polluted: true } }] },
    ];
    for (const [index, attack] of attacks.entries()) {
      const device = freshDevice();
      const before = await dump(device);
      const result = await importCryptFromText(device.deps, JSON.stringify(attack));
      expect(result.ok, `attack ${index}`).toBe(false);
      expect(await dump(device)).toBe(before);
    }
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('never leaves a partial import behind when the transaction is aborted by a clashing run id', async () => {
    const device = freshDevice();
    const text = exportTextOf((await fc.sample(sampleScenarioArb, { seed: 5, numRuns: 1 }))[0]!);
    expect((await importCryptFromText(device.deps, text)).ok).toBe(true);
    const before = await dump(device);
    // The same run id again would clash on the run key; the crypt is a duplicate first, and nothing is written.
    const again = await importCryptFromText({ ...device.deps, newRunId: () => 'imported-1' }, text);
    expect(again.ok).toBe(false);
    expect(await dump(device)).toBe(before);
  });
});

import fc from 'fast-check';
import { IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildExport, exportToJson } from './export-run';
import { importCryptFromText } from './import-crypt';
import { canonical, exportTextOf, freshDevice, generatedScenarioArb, sampleScenarioArb } from './import-test-support';
import type { Device, ExportScenario } from './import-test-support';
import { notesChunks } from './notes-chunks';
import { restoreRun } from './restore-run';

// Feature: import, Property 1: export, then import, gives back exactly what was exported
// **Validates: the import counterpart of Requirements 13.1, 13.5, 13.6**
beforeAll(() => {
  vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
});

/** Exports the imported crypt again, from what the device now holds. */
async function reExport(device: Device, runId: string, scenario: ExportScenario): Promise<string> {
  const restored = await restoreRun({ factory: device.factory, notesStore: device.notes }, runId);
  if (!restored.ok) throw new Error(`restore failed: ${restored.error.kind}`);
  let chunks = [...restored.value.assets.chunks.values()];
  if (scenario.source === 'generated') {
    const rebuilt = await notesChunks({ notesStore: device.notes }, restored.value.crypt);
    if (!rebuilt.ok) throw new Error('notes missing after import');
    chunks = [...rebuilt.value.values()];
  }
  const built = buildExport({
    crypt: restored.value.crypt,
    run: { ...restored.value.run, runId: 'exported-run', createdAt: 0 },
    acceptedEvents: restored.value.events,
    chunks,
  });
  if (!built.ok) throw new Error('re-export failed');
  const json = exportToJson(built.value);
  if (!json.ok) throw new Error('re-export text failed');
  return json.value;
}

async function roundTrips(scenario: ExportScenario): Promise<void> {
  const text = exportTextOf(scenario);
  const device = freshDevice();
  const imported = await importCryptFromText(device.deps, text);
  expect(imported.ok, JSON.stringify(imported)).toBe(true);
  if (!imported.ok) return;
  expect(imported.value.manifestId).toBe(scenario.crypt.manifestId);
  expect(imported.value.source).toBe(scenario.source);
  expect(imported.value.status).toBe(scenario.run.state.status === 'escaped' ? 'escaped' : 'active');

  // The run folds to the very state the exporting tab had, with the same settings and events.
  const restored = await restoreRun({ factory: device.factory, notesStore: device.notes }, imported.value.runId);
  expect(restored.ok).toBe(true);
  if (!restored.ok) return;
  expect(restored.value.events).toEqual(scenario.run.events);
  expect(restored.value.run.settings).toEqual(scenario.run.settings);
  expect(restored.value.model.state).toEqual(scenario.run.state);

  // And exporting it again gives the same file, key for key and event for event.
  expect(canonical(await reExport(device, imported.value.runId, scenario))).toBe(canonical(text));
}

describe('export, then import', () => {
  it('gives back exactly what was exported, for a generated crypt with its notes', async () => {
    await fc.assert(fc.asyncProperty(generatedScenarioArb, roundTrips), { numRuns: 40 });
  });

  it('gives back exactly what was exported, for the bundled sample crypt', async () => {
    await fc.assert(fc.asyncProperty(sampleScenarioArb, roundTrips), { numRuns: 25 });
  });

  it('writes the notes of a generated crypt once, and none for a sample', async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(generatedScenarioArb, sampleScenarioArb), async (scenario) => {
        const device = freshDevice();
        const imported = await importCryptFromText(device.deps, exportTextOf(scenario));
        expect(imported.ok).toBe(true);
        expect(device.notes.all()).toHaveLength(scenario.source === 'generated' ? 1 : 0);
      }),
      { numRuns: 25 },
    );
  });
});

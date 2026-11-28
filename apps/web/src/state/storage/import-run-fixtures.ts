import fc from 'fast-check';
import { expect } from 'vitest';
import { SAMPLE_CRYPT } from '../../test-support/sample-bundle';
import { importCryptFromText } from './import-crypt';
import type { Chunk, ImportErrorKind } from '@escape-the-crypt/core';
import { dump, exportTextOf, freshDevice, generatedScenarioArb, notesChunksArb } from './import-test-support';
import type { ExportScenario } from './import-test-support';
import { playAccepted } from './persistence-arbitraries';

/** One fixed generated scenario, and a second set of notes that is not its own. Chosen by seed, so every run sees the same. */
export async function notesChunksFor(): Promise<{
  readonly generated: ExportScenario;
  readonly otherChunks: readonly Chunk[];
}> {
  const [generated] = fc.sample(generatedScenarioArb, { seed: 42, numRuns: 1 });
  const [otherChunks] = fc.sample(notesChunksArb, { seed: 7, numRuns: 1 });
  if (generated === undefined || otherChunks === undefined) throw new Error('no sample');
  return { generated, otherChunks };
}

export const SETTINGS = { length: 'short', difficulty: 'apprentice', hintAllowance: 3 } as const;

export const sampleScenario = (choices: readonly number[]): ExportScenario => ({
  run: playAccepted(SAMPLE_CRYPT.manifest, SETTINGS, choices),
  chunks: [...SAMPLE_CRYPT.chunks.values()],
  source: 'sample',
  crypt: {
    schemaVersion: 1,
    manifestId: SAMPLE_CRYPT.manifest.manifestId,
    manifest: SAMPLE_CRYPT.manifest,
    content: SAMPLE_CRYPT.content,
    source: 'sample',
  },
});

export const PLAYED = sampleScenario([0, 0, 1, 2]);
export const GOOD = exportTextOf(PLAYED);
export const parse = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;
export const stringify = (value: unknown): string => JSON.stringify(value);

/** Imports `text` into a fresh device and checks it was refused with `kind` and left the device as it was. */
export async function refused(text: string, kind: ImportErrorKind): Promise<void> {
  const device = freshDevice();
  const before = await dump(device);
  const result = await importCryptFromText(device.deps, text);
  expect(result).toEqual({ ok: false, error: { kind } });
  expect(await dump(device)).toBe(before);
}

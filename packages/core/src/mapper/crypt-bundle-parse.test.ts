import { beforeAll, describe, expect, it } from 'vitest';
import { buildHumanHeartSampleCrypt } from '../sample-crypt/human-heart';
import type { HumanHeartQuestionsFile } from '../sample-crypt/human-heart';
import type { CryptManifest } from '../runtime/manifest-types';
import type { CryptContent } from './crypt-content';
import { parseCryptBundle } from './crypt-bundle-parse';

// packages/core compiles without Node types, so load Node modules dynamically.
async function readSample(): Promise<{ notes: string; file: HumanHeartQuestionsFile }> {
  const fsSpecifier: string = 'node:fs';
  const urlSpecifier: string = 'node:url';
  const fs = (await import(fsSpecifier)) as unknown as {
    readFileSync(path: string, enc: string): string;
  };
  const url = (await import(urlSpecifier)) as unknown as { fileURLToPath(href: string): string };
  const href = (import.meta as unknown as { url: string }).url;
  const here = url.fileURLToPath(href).replace(/\\/g, '/').replace(/\/[^/]*$/, '');
  const root = `${here}/../../../..`;
  return {
    notes: fs.readFileSync(`${root}/samples/human-heart.txt`, 'utf8'),
    file: JSON.parse(
      fs.readFileSync(`${root}/samples/questions/human-heart.json`, 'utf8'),
    ) as HumanHeartQuestionsFile,
  };
}

let manifest: CryptManifest;
let content: CryptContent;

beforeAll(async () => {
  const { notes, file } = await readSample();
  const built = buildHumanHeartSampleCrypt(notes, file);
  if (!built.ok) throw new Error(`sample crypt did not build: ${built.error.kind}`);
  manifest = built.value.manifest;
  content = built.value.content;
});

/** A deep copy through JSON, as the bundle arrives over the network. */
function overTheWire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('parseCryptBundle', () => {
  it('accepts a valid bundle and ignores extra top-level keys', () => {
    const result = parseCryptBundle({
      status: 'completed',
      unplacedAccepted: [],
      manifest: overTheWire(manifest),
      content: overTheWire(content),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.manifest).toEqual(manifest);
      expect(result.value.content).toEqual(content);
    }
  });

  it.each([null, undefined, 'bundle', 42, [], {}])('rejects a non-bundle %p without throwing', (raw) => {
    const result = parseCryptBundle(raw);
    expect(result.ok).toBe(false);
  });

  it('rejects a manifest the publish gate rejects', () => {
    const bad = { ...overTheWire(manifest), rooms: 'not rooms' };
    const result = parseCryptBundle({ manifest: bad, content: overTheWire(content) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('manifest-schema-invalid');
  });

  it('rejects content with an answer key field, reporting only paths', () => {
    const c = overTheWire(content);
    const firstId = Object.keys(c.questions)[0] ?? '';
    const withKey = {
      ...c,
      questions: { ...c.questions, [firstId]: { ...c.questions[firstId], answer: 'secret' } },
    };
    const result = parseCryptBundle({ manifest: overTheWire(manifest), content: withKey });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('bundle-content-invalid');
      expect(JSON.stringify(result.error)).not.toContain('secret');
    }
  });

  it('rejects a bundle whose content lacks a manifest question', () => {
    const c = overTheWire(content);
    const questionId = manifest.rooms[0]?.lockSlots[0]?.primaryQuestion.questionId ?? '';
    const questions = Object.fromEntries(
      Object.entries(c.questions).filter(([id]) => id !== questionId),
    );
    const result = parseCryptBundle({ manifest: overTheWire(manifest), content: { ...c, questions } });
    expect(result).toEqual({ ok: false, error: { kind: 'bundle-content-missing', questionId } });
  });

  it('rejects a bundle whose content lacks a manifest concept title', () => {
    const c = overTheWire(content);
    const conceptId = manifest.rooms[0]?.lockSlots[0]?.conceptId ?? '';
    const concepts = Object.fromEntries(
      Object.entries(c.concepts).filter(([id]) => id !== conceptId),
    );
    const result = parseCryptBundle({ manifest: overTheWire(manifest), content: { ...c, concepts } });
    expect(result).toEqual({ ok: false, error: { kind: 'bundle-concept-missing', conceptId } });
  });
});

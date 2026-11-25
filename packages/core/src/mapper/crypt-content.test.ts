import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CryptContentConceptSchema,
  CryptContentEntrySchema,
  CryptContentSchema,
  parseCryptContentEntry,
} from './crypt-content';
import { cryptContentArb } from '../test-support/crypt-content-arbitraries';

// packages/core compiles without Node types, so load Node modules dynamically.
const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');

const validEntry = {
  prompt: 'According to your notes, what pumps blood?',
  options: { a: 'The heart', b: 'The liver' },
  excerpts: [
    { chunkId: 'c1', quote: 'The heart pumps blood.' },
    { chunkId: 'c2', quote: 'The liver filters blood.', optionId: 'b' },
  ],
  explanation: 'The heart pumps blood.',
};

describe('CryptContentEntrySchema', () => {
  it('accepts a valid entry', () => {
    expect(CryptContentEntrySchema.safeParse(validEntry).success).toBe(true);
  });

  it('rejects an extra answer or key field', () => {
    expect(CryptContentEntrySchema.safeParse({ ...validEntry, answer: 'a' }).success).toBe(false);
    expect(CryptContentEntrySchema.safeParse({ ...validEntry, key: 'a' }).success).toBe(false);
  });

  it('rejects empty excerpts', () => {
    expect(CryptContentEntrySchema.safeParse({ ...validEntry, excerpts: [] }).success).toBe(false);
  });

  it('accepts an excerpt without optionId', () => {
    const entry = { prompt: 'p', excerpts: [{ chunkId: 'c1', quote: 'q' }], explanation: '' };
    expect(CryptContentEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('rejects an optionId that is not in options', () => {
    const entry = { ...validEntry, excerpts: [{ chunkId: 'c1', quote: 'q', optionId: 'zzz' }] };
    expect(CryptContentEntrySchema.safeParse(entry).success).toBe(false);
  });

  it('rejects an optionId on an entry with no options', () => {
    const entry = {
      prompt: 'p',
      excerpts: [{ chunkId: 'c1', quote: 'q', optionId: 'a' }],
      explanation: '',
    };
    expect(CryptContentEntrySchema.safeParse(entry).success).toBe(false);
  });
});

describe('CryptContentConceptSchema', () => {
  it('rejects an empty or whitespace title', () => {
    expect(CryptContentConceptSchema.safeParse({ title: '' }).success).toBe(false);
    expect(CryptContentConceptSchema.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('rejects an extra field', () => {
    expect(CryptContentConceptSchema.safeParse({ title: 'Heart', extra: 1 }).success).toBe(false);
  });

  it('accepts a concepts record with plain-text titles', () => {
    const content = {
      questions: { q1: validEntry },
      concepts: { k1: { title: 'The heart' }, k2: { title: 'Blood <b>flow</b>' } },
    };
    expect(CryptContentSchema.safeParse(content).success).toBe(true);
  });
});

describe('CryptContentSchema round trip', () => {
  /**
   * Property 3: Crypt_Content survives a JSON round trip, including optionId.
   * **Validates: Requirements 6.11, 6.18, 6.23**
   */
  it('Property 3: parses to a deeply equal value after JSON round trip', () => {
    fc.assert(
      fc.property(cryptContentArb, (content) => {
        expect(CryptContentSchema.safeParse(content).success).toBe(true);
        const parsed = CryptContentSchema.safeParse(JSON.parse(JSON.stringify(content)));
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data).toEqual(content);
        for (const [id, concept] of Object.entries(content.concepts)) {
          expect(parsed.data.concepts[id]?.title).toBe(concept.title);
        }
        for (const [id, entry] of Object.entries(content.questions)) {
          const before = entry.excerpts.map((e) => e.optionId);
          expect(parsed.data.questions[id]?.excerpts.map((e) => e.optionId)).toEqual(before);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('parseCryptContentEntry', () => {
  it('returns a typed error naming the question', () => {
    const result = parseCryptContentEntry('q9', { ...validEntry, answer: 'a' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('crypt-content-schema-invalid');
      expect(result.error.questionId).toBe('q9');
    }
  });

  it('returns the entry when valid', () => {
    const result = parseCryptContentEntry('q1', validEntry);
    expect(result.ok).toBe(true);
  });

  it('never throws on malformed input', () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        expect(() => parseCryptContentEntry('q', raw)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});

describe('crypt-content.ts source', () => {
  const source = fs.readFileSync(`${here}/crypt-content.ts`, 'utf8');

  it("imports z from '../zod' and never from 'zod'", () => {
    expect(source).toContain("import { z } from '../zod';");
    expect(source).not.toMatch(/from\s+['"]zod['"]/);
  });
});

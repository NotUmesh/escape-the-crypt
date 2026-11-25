import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildHumanHeartSampleCrypt, type HumanHeartQuestionsFile } from './human-heart';

// packages/core compiles without Node types, so load Node modules dynamically.
const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as { readFileSync(path: string, enc: string): string };
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');
const root = `${here}/../../../..`;

// Only the public sample files are read, never the final test set.
const notesText = fs.readFileSync(`${root}/samples/human-heart.txt`, 'utf8');
const questionsText = fs.readFileSync(`${root}/samples/questions/human-heart.json`, 'utf8');

const SELECTED_IDS: ReadonlySet<string> = new Set([
  'hh-q01',
  'hh-q02',
  'hh-q03',
  'hh-q04',
  'hh-q06',
  'hh-q08',
  'hh-q12',
]);

function parseFile(): HumanHeartQuestionsFile {
  return JSON.parse(questionsText) as HumanHeartQuestionsFile;
}

function isSelected(q: unknown): boolean {
  return typeof q === 'object' && q !== null && SELECTED_IDS.has((q as { id: string }).id);
}

const baseline = buildHumanHeartSampleCrypt(notesText, parseFile());

describe('sample crypt determinism', () => {
  it('the baseline build succeeds', () => {
    expect(baseline.ok).toBe(true);
  });

  // Feature: generation-and-evaluation, Property 12: Sample crypt build is deterministic
  it('Property 12: Sample crypt build is deterministic', () => {
    // **Validates: Requirements 27.8**
    const baselineJson = JSON.stringify(baseline);
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 0, maxLength: 40 }),
        fc.array(fc.boolean(), { minLength: 0, maxLength: 40 }),
        fc.boolean(),
        (sortKeys, keepFlags, reverseSelected) => {
          const file = parseFile();
          const selected = file.questions.filter(isSelected);
          const others = file.questions.filter((q) => !isSelected(q));
          // Keep an arbitrary subset of unrelated questions, in an arbitrary order.
          const keptOthers = others
            .filter((_, i) => keepFlags[i] ?? true)
            .map((q, i) => ({ q, key: sortKeys[i] ?? i }))
            .sort((a, b) => a.key - b.key)
            .map((e) => e.q);
          const orderedSelected = reverseSelected ? [...selected].reverse() : selected;
          // Interleave: unrelated questions first or after, depending on the keys.
          const questions =
            (sortKeys[0] ?? 0) % 2 === 0
              ? [...keptOthers, ...orderedSelected]
              : [...orderedSelected, ...keptOthers];
          const reparsed = JSON.parse(JSON.stringify({ ...file, questions })) as HumanHeartQuestionsFile;

          const result = buildHumanHeartSampleCrypt(notesText, reparsed);
          expect(result).toEqual(baseline);
          expect(JSON.stringify(result)).toBe(baselineJson);
        },
      ),
      { numRuns: 100 },
    );
  });
});

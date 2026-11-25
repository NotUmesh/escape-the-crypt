import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  AuthoringQuestion,
  RuneCipherAuthoringQuestion,
  SeanceBoardAuthoringQuestion,
} from '../authoring/schema';
import type { CryptManifest } from '../runtime/manifest-types';
import { SAMPLE_CONCEPT_TITLES, buildHumanHeartSampleCrypt, type HumanHeartQuestionsFile } from '../sample-crypt/human-heart';
import { buildDocumentChunkMaps, mapAuthoringQuestionToSpec, type DocumentChunkMaps } from './manifest-mapper';
import type { CryptContent } from './crypt-content';

/*
 * Feature: room-play, Property 4: The mapper gives every question complete content
 * **Validates: Requirements 6.4, 6.5, 6.6, 6.8, 6.14, 6.17, 6.21, 6.24**
 *
 * `authoringQuestionArb` draws quotes from unrelated random text, so the mapper's blocking
 * checks would reject nearly every draw. These generators build the document first and cut
 * every quote from it, in the same shape as `authoringQuestionArb` (rune cipher and séance
 * board, per-option evidence).
 */

interface Doc {
  readonly maps: DocumentChunkMaps;
  readonly paragraphs: readonly (readonly string[])[];
}

const word = (n: number): string =>
  `${String.fromCharCode(97 + (n % 26), 97 + (Math.floor(n / 26) % 26), 97 + (Math.floor(n / 676) % 26))}x`;

const docArb: fc.Arbitrary<Doc> = fc
  .array(fc.integer({ min: 15, max: 25 }), { minLength: 3, maxLength: 5 })
  .map((lengths) => {
    let i = 0;
    const paragraphs = lengths.map((len) => Array.from({ length: len }, () => word(i++)));
    const maps = buildDocumentChunkMaps(paragraphs.map((p) => p.join(' ')).join('\n\n'));
    return { maps, paragraphs };
  });

interface Span {
  readonly paragraph: number;
  readonly words: readonly string[];
}

const spanArb = (doc: Doc): fc.Arbitrary<Span> =>
  fc
    .tuple(fc.integer({ min: 0, max: doc.paragraphs.length - 1 }), fc.nat(), fc.integer({ min: 5, max: 10 }))
    .map(([pi, seed, len]) => {
      const words = doc.paragraphs[pi]!;
      const start = seed % (words.length - len + 1);
      return { paragraph: pi + 1, words: words.slice(start, start + len) };
    });

const runeArb = (doc: Doc, conceptId: string): fc.Arbitrary<RuneCipherAuthoringQuestion> =>
  fc.tuple(spanArb(doc), fc.nat(), fc.boolean()).map(([span, seed, caseSensitive]) => ({
    id: 'r1',
    conceptId,
    role: 'primary' as const,
    lockType: 'rune-cipher' as const,
    prompt: 'Complete the line from your notes: ___ appears here',
    answer: span.words[seed % span.words.length]!,
    aliases: [],
    caseSensitive,
    evidence: [{ paragraph: span.paragraph, quote: span.words.join(' ') }],
    explanation: 'See the quoted line.',
  }));

const seanceArb = (doc: Doc, conceptId: string): fc.Arbitrary<SeanceBoardAuthoringQuestion> =>
  fc
    .tuple(fc.integer({ min: 3, max: 4 }), fc.nat(), fc.array(spanArb(doc), { minLength: 4, maxLength: 4 }))
    .map(([count, seed, spans]) => {
      const supportedAt = seed % count;
      const options = Array.from({ length: count }, (_, i) => ({
        id: `o${i + 1}`,
        text: `Claim number ${i + 1} about the topic`,
        label: i === supportedAt ? ('supported' as const) : ('contradicted' as const),
        evidence: { paragraph: spans[i]!.paragraph, quote: spans[i]!.words.join(' ') },
      }));
      return {
        id: 's1',
        conceptId,
        role: 'primary' as const,
        lockType: 'seance-board' as const,
        prompt: 'According to your notes, which claim is stated?',
        options,
        answer: `o${supportedAt + 1}`,
        explanation: 'See the quoted lines.',
      };
    });

interface Case {
  readonly doc: Doc;
  readonly questions: readonly AuthoringQuestion[];
  readonly titles: Readonly<Record<string, string>>;
}

/** One rune and one séance question on two different concepts, each concept with a title. */
const caseArb: fc.Arbitrary<Case> = docArb.chain((doc) =>
  fc.tuple(runeArb(doc, 'c-rune'), seanceArb(doc, 'c-seance')).map(([rune, seance]) => ({
    doc,
    questions: [rune, seance],
    titles: { 'c-rune': 'Rune concept', 'c-seance': 'Séance concept' },
  })),
);

describe('Property 4: The mapper gives every question complete content', () => {
  it('maps every question with content, matching evidenceRefs, per-option excerpts and a titled concept', () => {
    let seanceCount = 0;
    fc.assert(
      fc.property(caseArb, ({ doc, questions, titles }) => {
        const content: CryptContent = { questions: {}, concepts: {} };
        for (const question of questions) {
          const result = mapAuthoringQuestionToSpec(question, doc.maps, question.id, titles[question.conceptId]);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const { spec, content: entry, concept } = result.value;
          content.questions[question.id] = entry;
          content.concepts[concept.conceptId] = { title: concept.title };

          expect(entry.prompt.length).toBeGreaterThan(0);
          expect(entry.excerpts.length).toBeGreaterThan(0);
          const excerptChunkIds = new Set(entry.excerpts.map((e) => e.chunkId));
          expect(spec.evidenceRefs.length).toBeGreaterThan(0);
          for (const ref of spec.evidenceRefs) expect(excerptChunkIds.has(ref)).toBe(true);
          for (const chunkId of excerptChunkIds) expect(doc.maps.chunks.has(chunkId)).toBe(true);

          if (question.lockType === 'seance-board') {
            seanceCount++;
            const optionExcerpts = entry.excerpts.filter((e) => e.optionId !== undefined);
            expect(optionExcerpts.map((e) => e.optionId)).toEqual(question.options.map((o) => o.id));
            expect(Object.keys(entry.options ?? {})).toEqual(question.options.map((o) => o.id));
          }
        }
        for (const question of questions) {
          expect(content.concepts[question.conceptId]?.title.trim().length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
    expect(seanceCount).toBeGreaterThan(0);
  });

  it('returns concept-label-missing, with no spec and no content, when one title is removed', () => {
    fc.assert(
      fc.property(caseArb, fc.boolean(), ({ doc, questions, titles }, removeFirst) => {
        const removed = questions[removeFirst ? 0 : 1]!;
        const remaining: Record<string, string> = { ...titles };
        delete remaining[removed.conceptId];
        const result = mapAuthoringQuestionToSpec(removed, doc.maps, removed.id, remaining[removed.conceptId]);
        expect(result).toEqual({
          ok: false,
          error: { kind: 'concept-label-missing', questionId: removed.id, conceptId: removed.conceptId },
        });
      }),
      { numRuns: 50 },
    );
  });
});

describe('Property 4: sample crypt manifest-level content', () => {
  let manifest: CryptManifest;
  let content: CryptContent;
  let notes = '';
  let file: HumanHeartQuestionsFile;

  beforeAll(async () => {
    // packages/core compiles without Node types, so load Node modules dynamically.
    const fsSpecifier: string = 'node:fs';
    const urlSpecifier: string = 'node:url';
    const fs = (await import(fsSpecifier)) as unknown as { readFileSync(path: string, enc: string): string };
    const url = (await import(urlSpecifier)) as unknown as { fileURLToPath(href: string): string };
    const href = (import.meta as unknown as { url: string }).url;
    const here = url.fileURLToPath(href).replace(/\\/g, '/').replace(/\/[^/]*$/, '');
    const root = `${here}/../../../..`;
    notes = fs.readFileSync(`${root}/samples/human-heart.txt`, 'utf8');
    file = JSON.parse(fs.readFileSync(`${root}/samples/questions/human-heart.json`, 'utf8')) as HumanHeartQuestionsFile;
    const built = buildHumanHeartSampleCrypt(notes, file);
    if (!built.ok) throw new Error(`build failed: ${JSON.stringify(built.error)}`);
    manifest = built.value.manifest;
    content = built.value.content;
  });

  it('gives every manifest conceptId a non-empty title', () => {
    const ids = new Set<string>([
      ...manifest.rooms.flatMap((r) => r.lockSlots.map((s) => s.conceptId)),
      ...manifest.finalDoor.slots.map((s) => s.conceptId),
    ]);
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) {
      expect(content.concepts[id]?.title.trim().length).toBeGreaterThan(0);
      expect(content.concepts[id]?.title).toBe(SAMPLE_CONCEPT_TITLES[id]);
    }
  });

  it('returns concept-label-missing when a concept has no title in the sample build', () => {
    const copy = JSON.parse(JSON.stringify(file)) as HumanHeartQuestionsFile;
    const q = copy.questions.find((x) => (x as { id?: string }).id === 'hh-q01') as { conceptId: string };
    q.conceptId = 'hh-untitled';
    const result = buildHumanHeartSampleCrypt(notes, copy);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ kind: 'concept-label-missing', conceptId: 'hh-untitled' });
  });
});

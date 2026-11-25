import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import type {
  AuthoringQuestion,
  RuneCipherAuthoringQuestion,
  SeanceBoardAuthoringQuestion,
} from '../authoring/schema';
import { chunkDocument } from '../chunker';
import type { CryptManifest, QuestionSpec, RoomSpec } from '../runtime/manifest-types';
import { manifestCheck } from '../runtime/manifest-check';
import { parseManifest } from '../runtime/manifest-schema';
import {
  buildDocumentChunkMaps,
  mapAuthoringQuestionToSpec,
  type DocumentChunkMaps,
} from './manifest-mapper';

// packages/core compiles without Node types, so load Node modules dynamically.
interface FsLike {
  readFileSync(path: string, enc: string): string;
  readdirSync(path: string): string[];
}
const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as FsLike;
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');
const root = `${here}/../../../..`;

// Only eval/dev and samples are read here, never eval/holdout.
interface QuestionFile {
  readonly notes: string;
  readonly questions: Record<string, unknown>[];
}
function readJson(relative: string): QuestionFile {
  return JSON.parse(fs.readFileSync(`${root}/${relative}`, 'utf8')) as QuestionFile;
}

function parse(raw: unknown): AuthoringQuestion {
  const r = parseAuthoringQuestion(raw);
  if (!r.ok) throw new Error(`authoring question rejected at ${r.error.path}`);
  return r.value;
}

const heart = readJson('samples/questions/human-heart.json');
const heartMaps = buildDocumentChunkMaps(fs.readFileSync(`${root}/samples/${heart.notes}`, 'utf8'));

function heartRaw(id: string): Record<string, unknown> {
  const found = heart.questions.find((q) => q.id === id);
  if (!found) throw new Error(`no sample question ${id}`);
  return found;
}
function heartQuestion(id: string): AuthoringQuestion {
  return parse(heartRaw(id));
}
function chunkIdOfParagraph(maps: DocumentChunkMaps, paragraph: number): string {
  const id = maps.chunksByParagraph.get(paragraph);
  if (id === undefined) throw new Error(`no chunk for paragraph ${paragraph}`);
  return id;
}
function mapOk(question: AuthoringQuestion, maps: DocumentChunkMaps = heartMaps): QuestionSpec {
  const result = mapAuthoringQuestionToSpec(question, maps, question.id);
  if (!result.ok) throw new Error(`mapping failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('mapper-one-example-per-phase-1-lock-type', () => {
  it('maps the human-heart rune cipher hh-q01 with its code-assigned chunk ID', () => {
    const spec = mapOk(heartQuestion('hh-q01'));
    expect(spec).toEqual({
      questionId: 'hh-q01',
      lockType: 'rune-cipher',
      payload: { answer: 'atrioventricular', aliases: ['AV'], caseSensitive: false },
      evidenceRefs: [chunkIdOfParagraph(heartMaps, 6)],
      hintEffect: { kind: 'reveal-first-letter', firstLetter: 'a', length: 16 },
    });
  });

  it('maps the human-heart séance board hh-q03 and keeps option order', () => {
    const question = heartQuestion('hh-q03') as SeanceBoardAuthoringQuestion;
    const spec = mapOk(question);
    expect(spec.lockType).toBe('seance-board');
    expect(spec.payload).toEqual({ optionIds: ['a', 'b', 'c', 'd'], keyOptionId: 'b' });
    expect((spec.payload as { optionIds: string[] }).optionIds).toEqual(question.options.map((o) => o.id));
    // Option evidence sits in paragraphs 4, 5, 4, 5: de-duplicated, first-seen order.
    expect(spec.evidenceRefs).toEqual([chunkIdOfParagraph(heartMaps, 4), chunkIdOfParagraph(heartMaps, 5)]);
    expect(spec.hintEffect).toEqual({ kind: 'remove-option', optionId: 'a' });
  });

  it('keeps optionIds in authoring order for every sample séance question', () => {
    for (const raw of heart.questions) {
      if (raw.lockType !== 'seance-board') continue;
      const question = parse(raw);
      if (question.lockType !== 'seance-board') continue;
      expect((mapOk(question).payload as { optionIds: string[] }).optionIds).toEqual(
        question.options.map((o) => o.id),
      );
    }
  });
});

describe('mapper-errors', () => {
  it('returns paragraph-not-found naming the question and paragraph, with no spec', () => {
    const raw = heartRaw('hh-q01');
    const moved = parse({ ...raw, evidence: [{ paragraph: 99, quote: 'anything' }] });
    expect(mapAuthoringQuestionToSpec(moved, heartMaps, 'hh-q01')).toEqual({
      ok: false,
      error: { kind: 'paragraph-not-found', questionId: 'hh-q01', paragraph: 99 },
    });
  });

  it('returns paragraph-not-found for a missing séance option paragraph', () => {
    const raw = heartRaw('hh-q03') as { options: { evidence: { paragraph: number } }[] };
    const options = raw.options.map((o, i) =>
      i === 2 ? { ...o, evidence: { ...o.evidence, paragraph: 50 } } : o,
    );
    const result = mapAuthoringQuestionToSpec(parse({ ...raw, options }), heartMaps, 'hh-q03');
    expect(result).toEqual({
      ok: false,
      error: { kind: 'paragraph-not-found', questionId: 'hh-q03', paragraph: 50 },
    });
  });

  it('returns hint-mismatch when the authoring hint disagrees with the answer', () => {
    for (const hint of [
      { kind: 'first-letter-and-length', firstLetter: 'b', length: 16 },
      { kind: 'first-letter-and-length', firstLetter: 'a', length: 15 },
    ]) {
      const question = parse({ ...heartRaw('hh-q01'), hint });
      expect(mapAuthoringQuestionToSpec(question, heartMaps, 'hh-q01')).toEqual({
        ok: false,
        error: { kind: 'hint-mismatch', questionId: 'hh-q01' },
      });
    }
  });

  it('returns check-failed when a blocking check fails', () => {
    const question = parse({
      ...heartRaw('hh-q01'),
      evidence: [{ paragraph: 6, quote: 'This sentence is not in the notes at all' }],
    });
    const result = mapAuthoringQuestionToSpec(question, heartMaps, 'hh-q01');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('check-failed');
    expect(!result.ok && result.error.questionId).toBe('hh-q01');
  });
});

describe('mapper-hint-table', () => {
  const raw01 = heartRaw('hh-q01');
  const { hint: _authoringHint, ...rawWithoutHint } = raw01;

  it('rune cipher, hint absent: computes reveal-first-letter from the answer', () => {
    expect(_authoringHint).toBeDefined();
    const question = parse(rawWithoutHint) as RuneCipherAuthoringQuestion;
    expect(question.hint).toBeUndefined();
    expect(mapOk(question).hintEffect).toEqual({ kind: 'reveal-first-letter', firstLetter: 'a', length: 16 });
  });

  it('rune cipher without an authoring hint maps for the sample hh-q04, hh-q08 and hh-q12', () => {
    expect(mapOk(heartQuestion('hh-q04')).hintEffect).toEqual({
      kind: 'reveal-first-letter',
      firstLetter: 'l',
      length: 'left ventricle'.length,
    });
    expect(mapOk(heartQuestion('hh-q08')).hintEffect).toEqual({
      kind: 'reveal-first-letter',
      firstLetter: 'p',
      length: 'pulmonary artery'.length,
    });
    expect(mapOk(heartQuestion('hh-q12')).hintEffect).toEqual({
      kind: 'reveal-first-letter',
      firstLetter: 's',
      length: 'sinoatrial node'.length,
    });
  });

  it('rune cipher, hint agrees: produces the same computed reveal-first-letter', () => {
    const withHint = mapOk(parse(raw01));
    const without = mapOk(parse(rawWithoutHint));
    expect(withHint.hintEffect).toEqual({ kind: 'reveal-first-letter', firstLetter: 'a', length: 16 });
    expect(withHint).toEqual(without);
  });

  it('rune cipher, hint disagrees: typed hint-mismatch, no spec', () => {
    const question = parse({ ...raw01, hint: { kind: 'first-letter-and-length', firstLetter: 'x', length: 3 } });
    const result = mapAuthoringQuestionToSpec(question, heartMaps, 'hh-q01');
    expect(result).toEqual({ ok: false, error: { kind: 'hint-mismatch', questionId: 'hh-q01' } });
    expect('value' in result).toBe(false);
  });

  it('séance board with contradicted options: remove-option for the first one in authoring order', () => {
    // hh-q03 has contradicted options a, c, d.
    expect(mapOk(heartQuestion('hh-q03')).hintEffect).toEqual({ kind: 'remove-option', optionId: 'a' });
    // hh-q06: first contradicted option is b (a is supported).
    expect(mapOk(heartQuestion('hh-q06')).hintEffect).toEqual({ kind: 'remove-option', optionId: 'b' });
    // Reordering the options changes which one is first.
    const raw = heartRaw('hh-q03') as { options: unknown[] };
    const reversed = parse({ ...raw, options: [...raw.options].reverse() });
    expect(mapOk(reversed).hintEffect).toEqual({ kind: 'remove-option', optionId: 'd' });
  });

  it('séance board never removes the key option', () => {
    for (const raw of heart.questions) {
      if (raw.lockType !== 'seance-board') continue;
      const question = parse(raw);
      if (question.lockType !== 'seance-board') continue;
      const hint = mapOk(question).hintEffect;
      expect(hint?.kind).toBe('remove-option');
      if (hint?.kind === 'remove-option') expect(hint.optionId).not.toBe(question.answer);
    }
  });

  it('séance board with no contradicted option: check-failed, no spec', () => {
    const raw = heartRaw('hh-q06') as { options: { label: string }[] };
    const options = raw.options.map((o) => (o.label === 'contradicted' ? { ...o, label: 'supported' } : o));
    const result = mapAuthoringQuestionToSpec(parse({ ...raw, options }), heartMaps, 'hh-q06');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toEqual({
      kind: 'check-failed',
      questionId: 'hh-q06',
      checkId: 'not-exactly-one-supported',
    });
  });
});

describe('mapper-paragraph-map', () => {
  it('keeps the first chunk when a paragraph splits into several chunks', () => {
    const sentence = 'The crypt keeps careful records of every candle that was lit in the long dark. ';
    const long = sentence.repeat(40).trim();
    const text = `A short title\n\n${long}\n\nAn ending paragraph.`;
    const chunks = chunkDocument({ sourceType: 'paste', text, originalText: text });
    const second = chunks.filter((c) => c.location.sourceType === 'paste' && c.location.paragraphNumber === 2);
    expect(second.length).toBeGreaterThan(1);

    const maps = buildDocumentChunkMaps(text);
    expect(maps.chunksByParagraph.get(2)).toBe(second[0]?.id);
    expect(maps.chunksByParagraph.get(2)).not.toBe(second[1]?.id);
    // All chunks stay available by ID.
    expect(maps.chunks.size).toBe(chunks.length);
    // Paragraph numbers are not shifted by the split.
    expect(maps.chunksByParagraph.get(3)).toBe(chunks[chunks.length - 1]?.id);
  });

  it('includes heading paragraphs in the paragraph map', () => {
    // Paragraph 1 is the title; numbering matches citation labels and the gold set.
    const id = chunkIdOfParagraph(heartMaps, 1);
    expect(heartMaps.chunks.get(id)?.text).toBe('The human heart');
  });

  it('citing the title paragraph fails with quote-too-short', () => {
    const raw = heartRaw('hh-q01') as { evidence: { paragraph: number; quote: string }[] };
    const question = parse({ ...raw, evidence: [{ paragraph: 1, quote: 'The human heart' }] });
    const result = mapAuthoringQuestionToSpec(question, heartMaps, 'hh-q01');
    expect(result).toEqual({
      ok: false,
      error: { kind: 'check-failed', questionId: 'hh-q01', checkId: 'quote-too-short' },
    });
  });

  it('numbers paragraphs from 1 and has no entry for paragraph 0', () => {
    expect([0, 1].map((n) => heartMaps.chunksByParagraph.has(n))).toEqual([false, true]);
  });
});

describe('mapper-dev-set-manifest', () => {
  it('maps every accepted dev rune and séance question into a manifest that passes manifestCheck', () => {
    const files = fs.readdirSync(`${root}/eval/dev/questions`).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    const rooms: RoomSpec[] = [];
    for (const file of files) {
      const json = readJson(`eval/dev/questions/${file}`);
      const maps = buildDocumentChunkMaps(fs.readFileSync(`${root}/eval/dev/notes/${json.notes}`, 'utf8'));
      for (const raw of json.questions) {
        if (raw.lockType !== 'rune-cipher' && raw.lockType !== 'seance-board') continue;
        const question = parse(raw);
      if (question.lockType !== 'seance-board') continue;
        const spec = mapOk(question, maps);
        rooms.push({
          roomId: `room-${spec.questionId}`,
          lockSlots: [
            {
              slotId: `slot-${spec.questionId}`,
              stationType: spec.lockType,
              conceptId: question.conceptId,
              primaryQuestion: spec,
              alternateQuestion: null,
            },
          ],
        });
      }
    }
    expect(rooms.length).toBeGreaterThan(0);
    const manifest: CryptManifest = { manifestId: 'dev-set', rooms, finalDoor: { slots: [] } };
    expect(manifestCheck(manifest)).toEqual({ ok: true });
    expect(parseManifest(JSON.parse(JSON.stringify(manifest))).ok).toBe(true);
  });
});

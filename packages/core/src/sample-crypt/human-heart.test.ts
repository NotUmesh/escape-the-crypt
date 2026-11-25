import { beforeAll, describe, expect, it } from 'vitest';
import { manifestCheck } from '../runtime/manifest-check';
import type { CryptManifest, QuestionSpec } from '../runtime/manifest-types';
import { parseManifest } from '../runtime/manifest-schema';
import { CryptContentSchema } from '../mapper/crypt-content';
import type { Chunk } from '../types';
import type { SampleCryptResult } from './human-heart';
import { SAMPLE_CONCEPT_TITLES, buildHumanHeartSampleCrypt, isHumanReviewed } from './human-heart';
import type { HumanHeartQuestionsFile } from './human-heart';

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

function allQuestions(m: CryptManifest): QuestionSpec[] {
  const out: QuestionSpec[] = [];
  for (const room of m.rooms) {
    for (const slot of room.lockSlots) {
      out.push(slot.primaryQuestion);
      if (slot.alternateQuestion !== null) out.push(slot.alternateQuestion);
    }
  }
  for (const slot of m.finalDoor.slots) out.push(slot.question);
  return out;
}

describe('SAMPLE_CONCEPT_TITLES', () => {
  const PLACEHOLDER_PATTERNS = [/concept\s*\d+/i, /^heart concept/i, /placeholder|todo|tbd|lorem/i];

  it.each(Object.entries(SAMPLE_CONCEPT_TITLES))('%s has a real title', (conceptId, title) => {
    expect(title.trim()).not.toBe('');
    expect(title).not.toBe(conceptId);
    for (const pattern of PLACEHOLDER_PATTERNS) expect(title).not.toMatch(pattern);
  });

  it('covers hh-c01 to hh-c07', () => {
    expect(Object.keys(SAMPLE_CONCEPT_TITLES).sort()).toEqual(
      ['hh-c01', 'hh-c02', 'hh-c03', 'hh-c04', 'hh-c05', 'hh-c06', 'hh-c07'],
    );
  });
});

describe('human-heart sample crypt', () => {
  let notes = '';
  let file: HumanHeartQuestionsFile;
  let manifest: CryptManifest;
  let built: SampleCryptResult;

  beforeAll(async () => {
    ({ notes, file } = await readSample());
    const result = buildHumanHeartSampleCrypt(notes, file);
    if (!result.ok) throw new Error(`build failed: ${JSON.stringify(result.error)}`);
    built = result.value;
    manifest = result.value.manifest;
  });

  it('is accepted by the manifest schema and manifestCheck (Req 27.3)', () => {
    expect(parseManifest(JSON.parse(JSON.stringify(manifest))).ok).toBe(true);
    expect(manifestCheck(manifest)).toEqual({ ok: true });
  });

  it('has the exact room and final-door concept split (Req 27.1, 27.2)', () => {
    expect(manifest.rooms).toHaveLength(1);
    const slots = manifest.rooms[0]?.lockSlots ?? [];
    expect(
      slots.map((s) => [
        s.conceptId,
        s.stationType,
        s.primaryQuestion.questionId,
        s.alternateQuestion?.questionId,
      ]),
    ).toEqual([
      ['hh-c01', 'rune-cipher', 'hh-q01', 'hh-q02'],
      ['hh-c02', 'seance-board', 'hh-q03', 'hh-q04'],
    ]);
    expect(manifest.finalDoor.slots.map((s) => [s.conceptId, s.question.questionId])).toEqual([
      ['hh-c03', 'hh-q06'],
      ['hh-c04', 'hh-q08'],
      ['hh-c07', 'hh-q12'],
    ]);
  });

  it('gives every rune cipher question a reveal-first-letter hint', () => {
    const runes = allQuestions(manifest).filter((q) => q.lockType === 'rune-cipher');
    expect(runes.length).toBeGreaterThan(0);
    for (const q of runes) expect(q.hintEffect?.kind).toBe('reveal-first-letter');
  });

  it('gives every séance question with a contradicted option a remove-option hint', () => {
    const seances = allQuestions(manifest).filter((q) => q.lockType === 'seance-board');
    expect(seances.length).toBeGreaterThan(0);
    for (const q of seances) {
      const payload = q.payload as { optionIds: string[]; keyOptionId: string };
      // A contradicted option exists whenever there is more than the key option.
      expect(payload.optionIds.length).toBeGreaterThan(1);
      expect(q.hintEffect?.kind).toBe('remove-option');
      if (q.hintEffect?.kind === 'remove-option') {
        expect(payload.optionIds).toContain(q.hintEffect.optionId);
        expect(q.hintEffect.optionId).not.toBe(payload.keyOptionId);
      }
    }
  });

  it('reports human-reviewed only when the file status says so', () => {
    expect(isHumanReviewed({ ...file, status: 'human-reviewed' })).toBe(true);
    expect(isHumanReviewed({ ...file, status: 'draft' })).toBe(false);
    expect(isHumanReviewed({ ...file, status: 'Human-reviewed' })).toBe(false);
    expect(isHumanReviewed({ ...file, status: '' })).toBe(false);
    // The shipped file is a draft until a human reviews it (Req 27.9).
    expect(isHumanReviewed(file)).toBe(file.status === 'human-reviewed');
  });

  it('returns a typed error for a missing selected question', () => {
    const trimmed = { ...file, questions: file.questions.filter((q) => (q as { id?: string }).id !== 'hh-q01') };
    expect(buildHumanHeartSampleCrypt(notes, trimmed)).toEqual({
      ok: false,
      error: { kind: 'sample-question-missing', questionId: 'hh-q01' },
    });
  });

  it('returns content that passes CryptContentSchema (Req 6.5)', () => {
    expect(CryptContentSchema.safeParse(built.content).success).toBe(true);
  });

  it('has a content entry for every manifest question, Alternates and final-door questions included', () => {
    const ids = allQuestions(manifest).map((q) => q.questionId);
    expect(ids).toEqual(expect.arrayContaining(['hh-q02', 'hh-q04']));
    expect(Object.keys(built.content.questions).sort()).toEqual([...ids].sort());
    for (const n of [1, 2, 3]) {
      expect(manifest.finalDoor.slots.map((s) => s.slotId)).toContain(`hh-final-${n}`);
    }
  });

  it('gives each s�ance option exactly one Option_Excerpt (Req 6.6, 6.7)', () => {
    const seances = allQuestions(manifest).filter((q) => q.lockType === 'seance-board');
    expect(seances.length).toBeGreaterThan(0);
    for (const q of seances) {
      const entry = built.content.questions[q.questionId];
      const optionIds = (q.payload as { optionIds: string[] }).optionIds;
      const tagged = (entry?.excerpts ?? []).filter((e) => e.optionId !== undefined);
      expect(tagged.map((e) => e.optionId).sort()).toEqual([...optionIds].sort());
    }
  });

  it('reads the unedited questions file: every s�ance option carries its own evidence', () => {
    const seanceQs = file.questions.filter(
      (q) => (q as { lockType?: string }).lockType === 'seance-board',
    ) as { options: { evidence?: { paragraph?: number; quote?: string } }[] }[];
    expect(seanceQs.length).toBeGreaterThan(0);
    for (const q of seanceQs) {
      for (const o of q.options) {
        expect(o.evidence).toBeDefined();
        expect(typeof o.evidence?.paragraph).toBe('number');
        expect(o.evidence?.quote ?? '').not.toBe('');
      }
    }
  });

  it('holds a title for both manifest concepts, equal to the fixed table', () => {
    for (const id of ['hh-c01', 'hh-c02']) {
      expect(built.content.concepts[id]).toEqual({ title: SAMPLE_CONCEPT_TITLES[id] });
    }
    const manifestConcepts = [
      ...manifest.rooms.flatMap((r) => r.lockSlots.map((s) => s.conceptId)),
      ...manifest.finalDoor.slots.map((s) => s.conceptId),
    ];
    for (const id of manifestConcepts) expect(built.content.concepts[id]?.title).toBe(SAMPLE_CONCEPT_TITLES[id]);
  });

  it('returns concept-label-missing when a conceptId is not in the table', () => {
    const copy = JSON.parse(JSON.stringify(file)) as HumanHeartQuestionsFile;
    const q = copy.questions.find((x) => (x as { id?: string }).id === 'hh-q01') as { conceptId: string };
    q.conceptId = 'hh-c99';
    expect(buildHumanHeartSampleCrypt(notes, copy)).toEqual({
      ok: false,
      error: { kind: 'concept-label-missing', questionId: 'hh-q01', conceptId: 'hh-c99' },
    });
  });

  it('cites only chunk IDs that exist in the returned chunks', () => {
    const chunks: ReadonlyMap<string, Chunk> = built.chunks;
    for (const entry of Object.values(built.content.questions)) {
      for (const e of entry.excerpts) expect(chunks.has(e.chunkId)).toBe(true);
    }
  });

  it('is not human-reviewed while the file status is draft', () => {
    expect(isHumanReviewed(file)).toBe(false);
  });

  it('returns a typed error, never throws, on malformed input', () => {
    const bad = { ...file, questions: [{ id: 'hh-q01' }, ...file.questions.slice(1)] };
    let result: ReturnType<typeof buildHumanHeartSampleCrypt> | undefined;
    expect(() => {
      result = buildHumanHeartSampleCrypt(notes, bad);
    }).not.toThrow();
    expect(result?.ok).toBe(false);
  });
});
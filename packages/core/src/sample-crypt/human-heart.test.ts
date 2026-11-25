import { beforeAll, describe, expect, it } from 'vitest';
import { manifestCheck } from '../runtime/manifest-check';
import type { CryptManifest, QuestionSpec } from '../runtime/manifest-types';
import { parseManifest } from '../runtime/manifest-schema';
import { buildHumanHeartSampleCrypt, isHumanReviewed } from './human-heart';
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

describe('human-heart sample crypt', () => {
  let notes = '';
  let file: HumanHeartQuestionsFile;
  let manifest: CryptManifest;

  beforeAll(async () => {
    ({ notes, file } = await readSample());
    const built = buildHumanHeartSampleCrypt(notes, file);
    if (!built.ok) throw new Error(`build failed: ${JSON.stringify(built.error)}`);
    manifest = built.value;
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
});

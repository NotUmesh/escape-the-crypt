import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHumanHeartSampleCrypt } from '@escape-the-crypt/core';
import type { CryptManifest, HumanHeartQuestionsFile } from '@escape-the-crypt/core';
import { buildFirstQuestionByConcept } from './room-assets';

type Slot = CryptManifest['rooms'][number]['lockSlots'][number];
type Question = Slot['primaryQuestion'];

function q(questionId: string, lockType: Question['lockType'] = 'rune-cipher'): Question {
  return { questionId, lockType, payload: {}, evidenceRefs: [], hintEffect: null };
}

function lockSlot(slotId: string, conceptId: string, primary: string, alternate: string | null): Slot {
  return {
    slotId,
    stationType: 'rune-cipher',
    conceptId,
    primaryQuestion: q(primary),
    alternateQuestion: alternate === null ? null : q(alternate, 'seance-board'),
  };
}

function manifestOf(
  rooms: readonly (readonly Slot[])[],
  finalDoor: readonly { conceptId: string; questionId: string }[] = [],
): CryptManifest {
  return {
    manifestId: 'synthetic',
    rooms: rooms.map((lockSlots, i) => ({ roomId: `room-${i}`, lockSlots })),
    finalDoor: {
      slots: finalDoor.map((f, i) => ({ slotId: `final-${i}`, conceptId: f.conceptId, question: q(f.questionId) })),
    },
  };
}

function loadSample(): CryptManifest {
  // Vitest runs with apps/web as the working directory.
  const root = join(process.cwd(), '..', '..', 'samples');
  const notes = readFileSync(join(root, 'human-heart.txt'), 'utf8');
  const file = JSON.parse(
    readFileSync(join(root, 'questions', 'human-heart.json'), 'utf8'),
  ) as HumanHeartQuestionsFile;
  const built = buildHumanHeartSampleCrypt(notes, file);
  if (!built.ok) throw new Error(`sample crypt failed: ${built.error.kind}`);
  return built.value.manifest;
}

describe('buildFirstQuestionByConcept', () => {
  it('maps every concept of the sample manifest, using the first Lock_Slot primary where one exists', () => {
    const manifest = loadSample();
    const map = buildFirstQuestionByConcept(manifest);
    const conceptIds = new Set([
      ...manifest.rooms.flatMap((r) => r.lockSlots.map((s) => s.conceptId)),
      ...manifest.finalDoor.slots.map((s) => s.conceptId),
    ]);
    expect(Object.keys(map).sort()).toEqual([...conceptIds].sort());
    for (const room of manifest.rooms) {
      for (const slot of room.lockSlots) {
        expect(map[slot.conceptId]).toBe(slot.primaryQuestion.questionId);
      }
    }
  });

  it('never returns an Alternate', () => {
    const manifest = loadSample();
    const alternates = manifest.rooms.flatMap((r) =>
      r.lockSlots.flatMap((s) => (s.alternateQuestion === null ? [] : [s.alternateQuestion.questionId])),
    );
    expect(alternates.length).toBeGreaterThan(0);
    for (const id of Object.values(buildFirstQuestionByConcept(manifest))) {
      expect(alternates).not.toContain(id);
    }
  });

  it('prefers the Lock_Slot primary over an Alternate and a final-door question sharing the concept', () => {
    const manifest = manifestOf(
      [[lockSlot('s1', 'c1', 'p1', 'alt1')]],
      [{ conceptId: 'c1', questionId: 'final-q1' }],
    );
    expect(buildFirstQuestionByConcept(manifest)).toEqual({ c1: 'p1' });
  });

  it('keeps the first slot in manifest order when several slots share a concept', () => {
    const manifest = manifestOf([
      [lockSlot('s1', 'c1', 'p1', 'a1'), lockSlot('s2', 'c2', 'p2', null)],
      [lockSlot('s3', 'c1', 'p3', 'a3'), lockSlot('s4', 'c2', 'p4', null)],
    ]);
    expect(buildFirstQuestionByConcept(manifest)).toEqual({ c1: 'p1', c2: 'p2' });
  });

  it('gives a concept that has no Lock_Slot its reserved final-door question, first one winning', () => {
    const manifest = manifestOf(
      [[lockSlot('s1', 'c1', 'p1', null)]],
      [
        { conceptId: 'c2', questionId: 'f1' },
        { conceptId: 'c2', questionId: 'f2' },
      ],
    );
    expect(buildFirstQuestionByConcept(manifest)).toEqual({ c1: 'p1', c2: 'f1' });
  });
});

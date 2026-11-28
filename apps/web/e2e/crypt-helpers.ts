import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  ENTER_CRYPT_LABEL,
  FRONT_OF_HOUSE_COPY,
  LOCK_OBJECT_NAMES,
  ROOM_PLAY_LABELS,
  SLOT_STATUS_WORDS,
  buildHumanHeartSampleCrypt,
} from '@escape-the-crypt/core';
import type { CryptManifest, HumanHeartQuestionsFile, LockType, SampleCryptResult } from '@escape-the-crypt/core';

type LockSlotSpec = CryptManifest['rooms'][number]['lockSlots'][number];
type QuestionSpec = LockSlotSpec['primaryQuestion'];

/** The answer to a question, read from the manifest payload. No AI provider is involved. */
export type CorrectAnswer =
  | { readonly kind: 'rune-cipher'; readonly text: string }
  | { readonly kind: 'seance-board'; readonly optionId: string; readonly optionText: string };

const SAMPLES = fileURLToPath(new URL('../../../samples/', import.meta.url));

/** Two paragraphs of prose, long enough to pass the notes preview. The run itself uses the sample crypt. */
export const NOTES_TEXT =
  'Active recall means producing an answer from memory instead of re-reading the notes.\n\n' +
  'Spaced repetition schedules each review just before the learner would forget the item.';

/** Builds the Sample_Crypt from the bundled sample notes and questions. Throws if the build fails. */
export function buildSampleCrypt(): SampleCryptResult {
  const notes = readFileSync(`${SAMPLES}human-heart.txt`, 'utf8');
  const file = JSON.parse(readFileSync(`${SAMPLES}questions/human-heart.json`, 'utf8')) as HumanHeartQuestionsFile;
  const built = buildHumanHeartSampleCrypt(notes, file);
  if (!built.ok) throw new Error(`sample crypt failed: ${built.error.kind}`);
  return built.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Reads the correct answer for a question from its manifest payload. */
export function correctAnswerFor(crypt: SampleCryptResult, question: QuestionSpec): CorrectAnswer {
  const payload = question.payload;
  if (question.lockType === 'rune-cipher') {
    if (!isRecord(payload) || typeof payload['answer'] !== 'string') {
      throw new Error(`rune cipher payload unreadable: ${question.questionId}`);
    }
    return { kind: 'rune-cipher', text: payload['answer'] };
  }
  if (question.lockType === 'seance-board') {
    if (!isRecord(payload) || typeof payload['keyOptionId'] !== 'string') {
      throw new Error(`seance payload unreadable: ${question.questionId}`);
    }
    const optionId = payload['keyOptionId'];
    const optionText = crypt.content.questions[question.questionId]?.options?.[optionId];
    if (optionText === undefined) throw new Error(`seance option text missing: ${question.questionId}`);
    return { kind: 'seance-board', optionId, optionText };
  }
  throw new Error(`no e2e answer helper for lock type ${question.lockType}`);
}

/** Room 1's lock slots, in slot order. */
export function roomOneSlots(crypt: SampleCryptResult): readonly LockSlotSpec[] {
  const room = crypt.manifest.rooms[0];
  if (room === undefined) throw new Error('sample crypt has no rooms');
  return room.lockSlots;
}

/** The accessible name of an unsolved lock button, as the room screen draws it. */
export function openLockName(stationType: LockType): string {
  const { object, kind } = LOCK_OBJECT_NAMES[stationType];
  return `${object}: ${kind}, ${SLOT_STATUS_WORDS.open}`;
}

/**
 * Gets past the descent over a freshly started run. The room is drawn beneath the gate but is inert
 * until the gate is gone, so every spec that plays calls this first. Without a gate (reduced motion)
 * it only waits for the room.
 */
export async function skipDescent(page: Page): Promise<void> {
  await page.locator('.room-screen, [data-testid="descent-gate"]').first().waitFor();
  const skip = page.getByRole('button', { name: FRONT_OF_HOUSE_COPY.descent.skip, exact: true });
  if ((await skip.count()) > 0) await skip.click();
  await expect(page.getByTestId('descent-gate')).toHaveCount(0);
  await expect(page.locator('.crypt-stage')).not.toHaveAttribute('inert', /.*/);
  // The pointer is still where Skip was. Move it off, so no lock is hovered when the learner starts.
  await page.mouse.move(0, 0);
}

export async function skipEndgameClip(page: Page): Promise<void> {
  const gate = page.getByTestId('descent-gate');
  if ((await gate.count()) > 0) await page.keyboard.press('Escape');
  await expect(gate).toHaveCount(0);
}

/** From the start of the app: paste notes, confirm them, choose "Enter the crypt", then skip the descent. */
export async function enterCrypt(page: Page): Promise<void> {
  await page.goto('/ingest');
  await page.locator('.ingest-paste textarea').fill(NOTES_TEXT);
  await page.getByRole('button', { name: 'Confirm notes' }).click();
  await page.getByRole('button', { name: ENTER_CRYPT_LABEL }).click();
  await skipDescent(page);
  await page.locator('.room-screen').waitFor();
  // The lock buttons appear once the Scene_File has loaded (or failed to); wait for them so callers never read an empty room.
  await page.locator('.room-screen__lock-button').first().waitFor();
}

/** Opens the lock for a slot, then answers it by lock type. Does not press Continue. */
export async function answerSlot(page: Page, slot: LockSlotSpec, answer: CorrectAnswer): Promise<void> {
  await page.getByRole('button', { name: openLockName(slot.stationType), exact: true }).click();
  await submitAnswer(page, answer);
}

/** Answers the question in the open panel: type for a rune cipher, choose by option id for a séance. */
export async function submitAnswer(page: Page, answer: CorrectAnswer): Promise<void> {
  const panel = page.getByTestId('panel-slot');
  if (answer.kind === 'rune-cipher') {
    await panel.getByLabel('Your answer').fill(answer.text);
  } else {
    await panel.locator(`input[type="radio"][value="${answer.optionId}"]`).check();
  }
  await panel.getByRole('button', { name: ROOM_PLAY_LABELS.submitAnswer }).click();
}

/** Waits until the layered scene is drawn: the stage, its Hotspot_Buttons and every art image settled (loaded or removed after a failure). */
export async function waitForArtStage(page: Page): Promise<void> {
  await page.getByTestId('art-stage').waitFor();
  await page.locator('.room-hotspot').first().waitFor();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('img.art-layer')).every((img) => (img as HTMLImageElement).complete));
}

/** A Hotspot_Button by lock type. */
export function hotspot(page: Page, lock: LockType) {
  return page.locator(`.room-hotspot[data-lock="${lock}"]`);
}

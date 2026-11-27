import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { LockType } from '@escape-the-crypt/core';
import {
  NOTES_TEXT,
  answerSlot,
  buildSampleCrypt,
  correctAnswerFor,
  enterCrypt,
  hotspot,
  roomOneSlots,
  waitForArtStage,
} from './crypt-helpers';

const lockImage = (page: Page, lock: LockType, file: string) =>
  page.locator(`img[data-layer="lock"][data-lock="${lock}"][data-file="${file}"]`);
const lightImage = (page: Page, lock: LockType) => page.locator(`img[data-layer="light"][data-lock="${lock}"]`);
const progressFlame = (page: Page, lock: LockType) => page.locator(`[data-flame="progress"][data-lock="${lock}"]`);

function firstLockType(): LockType {
  const slot = roomOneSlots(buildSampleCrypt())[0];
  if (slot === undefined) throw new Error('room 1 needs a lock slot');
  return slot.stationType;
}

test('hover and focus swap the lock layer to the -hover image and back (Requirements 24.5, 8.3)', async ({ page }) => {
  const lock = firstLockType();
  await enterCrypt(page);
  await waitForArtStage(page);
  // After the descent, focus goes to the first lock, which shows its hover image. Start from rest.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const rest = `lock-${lock}.webp`;
  const hover = `lock-${lock}-hover.webp`;
  const shown = (file: string) => lockImage(page, lock, file);
  await expect(shown(rest)).toHaveAttribute('data-shown', 'true');
  await expect(shown(hover)).toHaveAttribute('data-shown', 'false');

  // Hover: Playwright scrolls the button into view and moves the mouse onto it; then move off.
  await hotspot(page, lock).hover();
  await expect(shown(hover)).toHaveAttribute('data-shown', 'true');
  await expect(shown(rest)).toHaveAttribute('data-shown', 'false');
  await page.mouse.move(0, 0);
  await expect(shown(hover)).toHaveAttribute('data-shown', 'false');
  await expect(shown(rest)).toHaveAttribute('data-shown', 'true');

  // Focus and blur.
  await hotspot(page, lock).focus();
  await expect(shown(hover)).toHaveAttribute('data-shown', 'true');
  await hotspot(page, lock).blur();
  await expect(shown(hover)).toHaveAttribute('data-shown', 'false');
  await expect(shown(rest)).toHaveAttribute('data-shown', 'true');
});

test('a solved lock gets its Light_Pass and a Flame; a settled lock gets neither (Requirements 24.6, 8.6, 9.1-9.3)', async ({
  page,
}) => {
  const crypt = buildSampleCrypt();
  const [first, second] = roomOneSlots(crypt);
  if (first === undefined || second === undefined) throw new Error('room 1 needs two lock slots');
  expect(second.alternateQuestion).not.toBeNull();
  await enterCrypt(page);
  await waitForArtStage(page);

  // Before anything is solved: no light pass and no progress flame.
  await expect(page.locator('img[data-layer="light"][data-lock]')).toHaveCount(0);
  await expect(page.locator('[data-flame="progress"]')).toHaveCount(0);

  // Solve the first lock.
  await answerSlot(page, first, correctAnswerFor(crypt, first.primaryQuestion));
  await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  await expect(hotspot(page, first.stationType)).toHaveAttribute('data-status', 'solved');
  await expect(lightImage(page, first.stationType)).toHaveCount(1);
  await expect(progressFlame(page, first.stationType)).toHaveCount(1);
  await expect(lockImage(page, first.stationType, `lock-${first.stationType}-solved.webp`)).toHaveCount(1);

  // Settle the second lock: challenge swaps in the Alternate, skipping that settles the slot.
  await hotspot(page, second.stationType).click();
  const panel = page.getByTestId('panel-slot');
  await panel.getByRole('button', { name: ROOM_PLAY_LABELS.challenge, exact: true }).click();
  await panel.getByRole('button', { name: ROOM_PLAY_LABELS.skip, exact: true }).click();
  await expect(hotspot(page, second.stationType)).toHaveAttribute('data-status', 'settled');
  await expect(lightImage(page, second.stationType)).toHaveCount(0);
  await expect(progressFlame(page, second.stationType)).toHaveCount(0);
  // The settled lock shows its solved art, and the solved one keeps its light.
  await expect(lockImage(page, second.stationType, `lock-${second.stationType}-solved.webp`)).toHaveCount(1);
  await expect(lightImage(page, first.stationType)).toHaveCount(1);
  await expect(page.locator('[data-flame="progress"]')).toHaveCount(1);
});

test('one art file that fails to load is logged once, without learner content, and the game stays playable (Requirements 24.7, 23.1, 23.2, 23.4)', async ({
  page,
}) => {
  const crypt = buildSampleCrypt();
  const [first] = roomOneSlots(crypt);
  if (first === undefined) throw new Error('room 1 needs a lock slot');
  const failing = `lock-${first.stationType}-hover.webp`;
  await page.route(`**/art/rooms/burial-chamber/desktop/${failing}`, (route) => route.abort());

  const logged: { text: string; json: unknown }[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    void (async () => {
      const arg = message.args()[0];
      const json: unknown = arg === undefined ? null : await arg.jsonValue().catch(() => null);
      logged.push({ text: message.text(), json });
    })();
  });

  await enterCrypt(page);
  await waitForArtStage(page);
  // The failed layer is removed; every other layer and every button stays.
  await expect(lockImage(page, first.stationType, failing)).toHaveCount(0);
  await expect(lockImage(page, first.stationType, `lock-${first.stationType}.webp`)).toHaveCount(1);
  await expect(page.getByTestId('art-stage').locator('img[data-layer="background"]')).toHaveCount(1);
  await expect(page.locator('.room-hotspot')).toHaveCount(roomOneSlots(crypt).length);

  // The game stays playable: open and answer the lock whose hover image failed.
  await answerSlot(page, first, correctAnswerFor(crypt, first.primaryQuestion));
  await expect(page.locator('.evidence-panel__result[data-result="correct"]')).toBeVisible();
  await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  await expect(hotspot(page, first.stationType)).toHaveAttribute('data-status', 'solved');

  // Exactly one structured message for the file (the browser's own network error line has no `file`).
  await expect.poll(() => logged.filter((m) => isArtLog(m.json)).length).toBe(1);
  const ours = logged.filter((m) => isArtLog(m.json));
  expect(ours[0]?.json).toEqual({ file: `desktop/${failing}`, errorType: 'art-load-failed' });

  // No learner content in any console error: notes, prompts, answers, option text.
  const everything = JSON.stringify(logged).toLowerCase();
  const learnerTexts = [
    ...NOTES_TEXT.split('\n\n'),
    ...Object.values(crypt.content.questions).flatMap((q) => [q.prompt, ...Object.values(q.options ?? {})]),
    correctAnswerText(crypt, first),
  ];
  for (const text of learnerTexts) {
    if (text.trim().length > 0) expect(everything).not.toContain(text.trim().toLowerCase());
  }
});

function isArtLog(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'file' in value && 'errorType' in value;
}

function correctAnswerText(crypt: ReturnType<typeof buildSampleCrypt>, slot: ReturnType<typeof roomOneSlots>[number]): string {
  const answer = correctAnswerFor(crypt, slot.primaryQuestion);
  return answer.kind === 'rune-cipher' ? answer.text : answer.optionText;
}

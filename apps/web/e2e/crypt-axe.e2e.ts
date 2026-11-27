import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FINAL_DOOR_BUTTON_TEXT, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { answerSlot, buildSampleCrypt, correctAnswerFor, enterCrypt, openLockName, roomOneSlots, submitAnswer } from './crypt-helpers';

// Requirement 25.5: no axe violations on the room with the question open, with the evidence open,
// at the final door and on the Autopsy.
const scan = async (page: Page): Promise<void> => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  // The rules really ran, so an empty list of violations is not a scan that did nothing.
  expect(results.passes.length).toBeGreaterThan(10);
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
};

const crypt = buildSampleCrypt();

test('room screen with the question panel open', async ({ page }) => {
  await enterCrypt(page);
  const slot = roomOneSlots(crypt)[0];
  if (slot === undefined) throw new Error('sample crypt room 1 has no slots');
  await page.getByRole('button', { name: openLockName(slot.stationType), exact: true }).click();
  await expect(page.getByTestId('panel-slot').getByRole('button', { name: ROOM_PLAY_LABELS.submitAnswer })).toBeVisible();
  await scan(page);
});

test('room screen with the evidence panel open', async ({ page }) => {
  await enterCrypt(page);
  const slot = roomOneSlots(crypt)[0];
  if (slot === undefined) throw new Error('sample crypt room 1 has no slots');
  await answerSlot(page, slot, correctAnswerFor(crypt, slot.primaryQuestion));
  await expect(page.locator('.evidence-panel')).toBeVisible();
  await scan(page);
});

async function solveRoomOne(page: Page): Promise<void> {
  for (const slot of roomOneSlots(crypt)) {
    await answerSlot(page, slot, correctAnswerFor(crypt, slot.primaryQuestion));
    await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  }
  await page.getByRole('button', { name: FINAL_DOOR_BUTTON_TEXT, exact: true }).click();
}

test('final door', async ({ page }) => {
  await enterCrypt(page);
  await solveRoomOne(page);
  await expect(page.locator('.final-door__seal')).toHaveCount(crypt.manifest.finalDoor.slots.length);
  await scan(page);
});

test('autopsy', async ({ page }) => {
  await enterCrypt(page);
  await solveRoomOne(page);
  const doorSlots = crypt.manifest.finalDoor.slots;
  for (const doorSlot of doorSlots) {
    await page.locator('.final-door__seal-button').first().click();
    await submitAnswer(page, correctAnswerFor(crypt, doorSlot.question));
    await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  }
  await expect(page.getByTestId('escape-view')).toBeVisible();
  await page.getByRole('button', { name: ROOM_PLAY_LABELS.openAutopsy, exact: true }).click();
  await page.getByTestId('autopsy-view').waitFor();
  // The page fades in over 600 ms. A scan during the fade reads blended colours, so it waits for the fade to end.
  await page.getByTestId('autopsy-view').evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
  await scan(page);
});

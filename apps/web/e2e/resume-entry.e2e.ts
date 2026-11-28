import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FINAL_DOOR_BUTTON_TEXT, FRONT_OF_HOUSE_COPY, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { answerSlot, buildSampleCrypt, correctAnswerFor, enterCrypt, roomOneSlots, skipEndgameClip, submitAnswer } from './crypt-helpers';

const CONTINUE_LABEL = 'Continue your crypt';

/**
 * A saved crypt shows on the desk's book stack, so open Your crypts on the return visit.
 */
async function backToDesk(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: FRONT_OF_HOUSE_COPY.hub.shelfTitle }).click();
}

test('an unfinished run offers "Continue your crypt" after a reload', async ({ page }) => {
  const crypt = buildSampleCrypt();
  await enterCrypt(page);
  const [first] = roomOneSlots(crypt);
  if (first === undefined) throw new Error('sample crypt room 1 has no slots');
  await answerSlot(page, first, correctAnswerFor(crypt, first.primaryQuestion));
  await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();

  await backToDesk(page);
  const entry = page.getByTestId('resume-entry');
  await expect(entry).toBeVisible();
  await expect(entry.getByRole('button', { name: CONTINUE_LABEL, exact: true })).toBeVisible();
  await expect(entry.getByRole('button', { name: 'Start again', exact: true })).toBeVisible();
});

test('after the run escapes, a reload shows no resume entry', async ({ page }) => {
  const crypt = buildSampleCrypt();
  await enterCrypt(page);
  for (const slot of roomOneSlots(crypt)) {
    await answerSlot(page, slot, correctAnswerFor(crypt, slot.primaryQuestion));
    await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  }
  await page.getByRole('button', { name: FINAL_DOOR_BUTTON_TEXT, exact: true }).click();
  await skipEndgameClip(page);
  for (const doorSlot of crypt.manifest.finalDoor.slots) {
    await page.locator('.final-door__seal-button').first().click();
    await submitAnswer(page, correctAnswerFor(crypt, doorSlot.question));
    await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  }
  await expect(page.getByTestId('escape-view')).toBeVisible();

  await backToDesk(page);
  // The escaped crypt stays on the shelf, marked as escaped, with nothing to continue.
  await page.getByTestId('book-card').waitFor();
  await expect(page.getByTestId('book-card')).toContainText(FRONT_OF_HOUSE_COPY.book.status.escaped);
  await expect(page.getByTestId('resume-entry')).toHaveCount(0);
  await expect(page.getByRole('button', { name: CONTINUE_LABEL })).toHaveCount(0);
});

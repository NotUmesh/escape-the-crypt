import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FINAL_DOOR_BUTTON_TEXT, FRONT_OF_HOUSE_COPY, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { answerSlot, buildSampleCrypt, correctAnswerFor, enterCrypt, roomOneSlots, submitAnswer } from './crypt-helpers';

const CONTINUE_LABEL = 'Continue your crypt';

/**
 * A saved crypt shows on the desk's book stack, so a return visit starts at `/`. The desk's own
 * "Bring your notes" link is the signal that the page has rendered.
 */
async function backToDesk(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('link', { name: FRONT_OF_HOUSE_COPY.hub.bringNotes }).waitFor();
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
  for (const doorSlot of crypt.manifest.finalDoor.slots) {
    await page.locator('.final-door__seal-button').first().click();
    await submitAnswer(page, correctAnswerFor(crypt, doorSlot.question));
    await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  }
  await expect(page.getByTestId('escape-view')).toBeVisible();

  await backToDesk(page);
  // The shelf loads from IndexedDB after the page renders. The first test shows the entry appears
  // for an unfinished run; here the shelf is given time to load before the absence is checked.
  await page.waitForTimeout(750);
  await expect(page.getByTestId('shelf-empty')).toBeVisible();
  await expect(page.getByTestId('resume-entry')).toHaveCount(0);
  await expect(page.getByRole('button', { name: CONTINUE_LABEL })).toHaveCount(0);
});

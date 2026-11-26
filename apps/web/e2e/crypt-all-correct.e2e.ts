import { expect, test } from '@playwright/test';
import { AUTOPSY_LABELS, FINAL_DOOR_BUTTON_TEXT, FINAL_DOOR_STATUS_LABELS, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { answerSlot, buildSampleCrypt, correctAnswerFor, enterCrypt, roomOneSlots, submitAnswer } from './crypt-helpers';

test('all answers correct: every evidence panel, the final door and the Autopsy', async ({ page }) => {
  const crypt = buildSampleCrypt();
  await enterCrypt(page);

  // Room 1: answer each lock, then read the evidence and continue.
  for (const slot of roomOneSlots(crypt)) {
    await answerSlot(page, slot, correctAnswerFor(crypt, slot.primaryQuestion));
    await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  }

  // The final door: open it, then answer every open seal in manifest order.
  await page.getByRole('button', { name: FINAL_DOOR_BUTTON_TEXT, exact: true }).click();
  const doorSlots = crypt.manifest.finalDoor.slots;
  await expect(page.locator('.final-door__seal')).toHaveCount(doorSlots.length);
  for (const [index, doorSlot] of doorSlots.entries()) {
    await page.locator('.final-door__seal-button').first().click();
    await submitAnswer(page, correctAnswerFor(crypt, doorSlot.question));
    // Every answer shows its Evidence_Panel, including the last one, which escapes the run.
    await expect(page.locator('.evidence-panel__citation').first()).toBeVisible();
    await expect(page.locator('.evidence-panel__excerpt blockquote').first()).not.toBeEmpty();
    if (index === doorSlots.length - 1) {
      // The escape view waits until this panel is dismissed; its Continue only closes the panel.
      await expect(page.getByTestId('escape-view')).toHaveCount(0);
    }
    await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  }

  // Escape view, then the Autopsy.
  await expect(page.locator('.evidence-panel')).toHaveCount(0);
  await expect(page.getByTestId('escape-view')).toBeVisible();
  await page.getByRole('button', { name: ROOM_PLAY_LABELS.openAutopsy, exact: true }).click();
  await page.getByTestId('autopsy-view').waitFor();

  // Two concept entries, each with a label from AUTOPSY_LABELS.
  const labels = Object.values(AUTOPSY_LABELS);
  const entries = page.locator('.autopsy-entry');
  await expect(entries).toHaveCount(2);
  for (let i = 0; i < 2; i += 1) {
    const text = (await entries.nth(i).locator('.autopsy-outcome__label').innerText()).trim();
    expect(labels).toContain(text);
  }

  // The final door section lists every door question with a final status.
  const doorEntries = page.locator('.autopsy-final-door__entry');
  await expect(doorEntries).toHaveCount(doorSlots.length);
  for (let i = 0; i < doorSlots.length; i += 1) {
    const entry = doorEntries.nth(i);
    await expect(entry).toHaveAttribute('data-status', 'solved');
    await expect(entry.locator('.autopsy-outcome__label')).toHaveText(FINAL_DOOR_STATUS_LABELS.solved);
  }
});

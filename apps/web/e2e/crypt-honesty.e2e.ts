import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FINAL_DOOR_BUTTON_TEXT, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { answerSlot, buildSampleCrypt, correctAnswerFor, enterCrypt, roomOneSlots, skipEndgameClip, submitAnswer } from './crypt-helpers';

const FORBIDDEN = ['Human-reviewed', 'Blind model review passed'];
const CITATION = /^Paragraph \d+ of the sample notes$/;

/** Asserts the forbidden labels are absent from the visible and the raw page text. */
async function expectNoForbiddenLabels(page: Page): Promise<void> {
  const { visible, raw } = await page.evaluate(() => ({
    visible: document.body.innerText,
    raw: document.body.textContent ?? '',
  }));
  for (const phrase of FORBIDDEN) {
    expect(visible.toLowerCase()).not.toContain(phrase.toLowerCase());
    expect(raw.toLowerCase()).not.toContain(phrase.toLowerCase());
  }
}

test('a full run shows no review labels, only sample-notes citations, and stays on one origin', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  const citations: string[] = [];

  const collectEvidenceCitations = async (): Promise<void> => {
    await page.locator('.evidence-panel').waitFor();
    const texts = await page.locator('.evidence-panel__citation').allInnerTexts();
    citations.push(...texts.map((text) => text.trim()));
  };

  const crypt = buildSampleCrypt();
  await enterCrypt(page);
  const appOrigin = new URL(page.url()).origin;
  await expectNoForbiddenLabels(page);

  for (const slot of roomOneSlots(crypt)) {
    await answerSlot(page, slot, correctAnswerFor(crypt, slot.primaryQuestion));
    await collectEvidenceCitations();
    await expectNoForbiddenLabels(page);
    await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
    await expectNoForbiddenLabels(page);
  }

  await page.getByRole('button', { name: FINAL_DOOR_BUTTON_TEXT, exact: true }).click();
  await skipEndgameClip(page);
  await expectNoForbiddenLabels(page);
  const doorSlots = crypt.manifest.finalDoor.slots;
  for (const [index, doorSlot] of doorSlots.entries()) {
    await page.locator('.final-door__seal-button').first().click();
    await expectNoForbiddenLabels(page);
    await submitAnswer(page, correctAnswerFor(crypt, doorSlot.question));
    // The last answer also shows its Evidence_Panel before the escape view, so its citation is collected too.
    await collectEvidenceCitations();
    await expectNoForbiddenLabels(page);
    if (index === doorSlots.length - 1) await expect(page.getByTestId('escape-view')).toHaveCount(0);
    await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  }

  await expect(page.getByTestId('escape-view')).toBeVisible();
  await skipEndgameClip(page);
  await expectNoForbiddenLabels(page);
  await page.getByRole('button', { name: ROOM_PLAY_LABELS.openAutopsy, exact: true }).click();
  await page.getByTestId('autopsy-view').waitFor();
  await expectNoForbiddenLabels(page);

  // Open every Autopsy excerpt and read its citation (the part before the matched label).
  const entries = page.locator('.autopsy-entry');
  const entryCount = await entries.count();
  expect(entryCount).toBeGreaterThan(0);
  for (let i = 0; i < entryCount; i += 1) {
    await entries.nth(i).getByRole('button', { name: ROOM_PLAY_LABELS.showExcerpt, exact: true }).click();
    const caption = entries.nth(i).locator('.autopsy-entry__excerpt figcaption');
    await caption.waitFor();
    const text = (await caption.innerText()).trim();
    citations.push(text.split(' · ')[0] ?? '');
  }
  await expectNoForbiddenLabels(page);

  expect(citations.length).toBeGreaterThan(0);
  for (const label of citations) expect(label).toMatch(CITATION);

  // Every request went to the app's own origin (data: and blob: URLs never leave the page).
  const foreign = requested.filter((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return false;
    return new URL(url).origin !== appOrigin;
  });
  expect(foreign).toEqual([]);
});

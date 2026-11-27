import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { FRONT_OF_HOUSE_COPY, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { answerSlot, buildSampleCrypt, correctAnswerFor, enterCrypt, roomOneSlots } from './crypt-helpers';

// Requirements 10.8 and 12.13: the resume entry has no axe violations, both buttons are at least
// 44 by 44 px, Tab reaches both, and Enter on "Continue your crypt" restores the run.
//
// In Playwright's Firefox, polling with expect(...).toBeVisible() around an axe scan of this
// screen crashes the page. The waits around the scan use locator.waitFor() and one-shot reads.

const CONTINUE_LABEL = 'Continue your crypt';
const START_AGAIN_LABEL = 'Start again';
const crypt = buildSampleCrypt();

test('resume entry: no axe violations, 44 by 44 px targets, keyboard reachable', async ({ page }) => {
  // Play a bit: solve the first lock and press Continue, so the run has saved events.
  await enterCrypt(page);
  const [first] = roomOneSlots(crypt);
  if (first === undefined) throw new Error('sample crypt room 1 has no slots');
  await answerSlot(page, first, correctAnswerFor(crypt, first.primaryQuestion));
  await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  await page.locator('.room-screen__lock-button[data-status="solved"]').first().waitFor();

  // Back to the desk: the saved crypt is a book on the stack, and its card shows the resume entry.
  await page.goto('/');
  await page.getByRole('link', { name: FRONT_OF_HOUSE_COPY.hub.bringNotes }).waitFor();
  const entry = page.getByTestId('resume-entry');
  const continueButton = entry.getByRole('button', { name: CONTINUE_LABEL, exact: true });
  const startAgain = entry.getByRole('button', { name: START_AGAIN_LABEL, exact: true });
  await continueButton.waitFor();
  await startAgain.waitFor();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.passes.length).toBeGreaterThan(10);
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);

  for (const button of [continueButton, startAgain]) {
    const box = await button.boundingBox();
    if (box === null) throw new Error('a resume button has no layout box');
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  // Tab from the top of the page reaches both buttons, "Continue your crypt" first.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const reached: string[] = [];
  for (let i = 0; i < 30 && reached.length < 2; i += 1) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => {
      const active = document.activeElement;
      return active?.closest('[data-testid="resume-entry"]') ? (active.textContent ?? '').trim() : '';
    });
    if (label !== '' && !reached.includes(label)) reached.push(label);
  }
  expect(reached).toEqual([CONTINUE_LABEL, START_AGAIN_LABEL]);

  // Back to "Continue your crypt" by keyboard; Enter restores the run with the first lock solved.
  await page.keyboard.press('Shift+Tab');
  expect(await continueButton.evaluate((el) => el === document.activeElement)).toBe(true);
  await page.keyboard.press('Enter');
  await page.locator('.room-screen').waitFor();
  await page.locator('.room-screen__lock-button[data-status="solved"]').first().waitFor();
});

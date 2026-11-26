import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { AUTOPSY_LABELS, FINAL_DOOR_BUTTON_TEXT, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { SampleCryptResult } from '@escape-the-crypt/core';
import { buildSampleCrypt, enterCrypt } from './crypt-helpers';

const WRONG_RUNE_TEXT = 'zzzxq';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Question prompt to séance key option id, read from the manifest (reserved, primary and Alternate). */
function seanceKeysByPrompt(crypt: SampleCryptResult): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();
  const questions = [
    ...crypt.manifest.rooms.flatMap((room) =>
      room.lockSlots.flatMap((slot) =>
        slot.alternateQuestion === undefined ? [slot.primaryQuestion] : [slot.primaryQuestion, slot.alternateQuestion],
      ),
    ),
    ...crypt.manifest.finalDoor.slots.map((slot) => slot.question),
  ];
  for (const question of questions) {
    if (question === null) continue;
    const payload = question.payload;
    const prompt = crypt.content.questions[question.questionId]?.prompt;
    if (question.lockType === 'seance-board' && isRecord(payload) && typeof payload['keyOptionId'] === 'string' && prompt !== undefined) {
      keys.set(prompt, payload['keyOptionId']);
    }
  }
  return keys;
}

/** Answers whatever question is in the open panel with a wrong answer. Does not press Continue. */
async function answerWrong(page: Page, keys: ReadonlyMap<string, string>): Promise<void> {
  const panel = page.getByTestId('panel-slot');
  const rune = panel.getByLabel('Your answer');
  const seance = panel.locator('.seance-board-panel');
  await expect(rune.or(seance)).toBeVisible();
  if ((await rune.count()) > 0) {
    await rune.fill(WRONG_RUNE_TEXT);
  } else {
    const prompt = (await seance.locator('.seance-board-panel__prompt').innerText()).trim();
    const key = keys.get(prompt);
    if (key === undefined) throw new Error('seance prompt not found in the manifest');
    const options = panel.locator('input[type="radio"]:not([disabled])');
    const count = await options.count();
    let chosen = false;
    for (let i = 0; i < count; i += 1) {
      const option = options.nth(i);
      if ((await option.getAttribute('value')) !== key) {
        await option.check();
        chosen = true;
        break;
      }
    }
    if (!chosen) throw new Error('no wrong séance option available');
  }
  await panel.getByRole('button', { name: ROOM_PLAY_LABELS.submitAnswer }).click();
}

const continueButton = (page: Page) => page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true });

test('all answers wrong: ghosts appear, return at the final door, and the escape still happens', async ({ page }) => {
  const crypt = buildSampleCrypt();
  const keys = seanceKeysByPrompt(crypt);
  await enterCrypt(page);

  // Room 1: answer every open lock (and any due Return_Slot) wrong.
  const openControls = page.locator(
    '.room-screen__lock-button[data-status="open"], .room-screen__return-button[data-status="open"]',
  );
  let sawGhost = false;
  for (let guard = 0; guard < 20 && (await openControls.count()) > 0; guard += 1) {
    await openControls.first().click();
    await answerWrong(page, keys);
    await expect(page.locator('.evidence-panel__result[data-result="wrong"]')).toBeVisible();
    await continueButton(page).click();
    if ((await page.locator('.ghost-list__ghost').count()) > 0) sawGhost = true;
  }
  // A wrong answer summons a ghost for its concept.
  expect(sawGhost).toBe(true);

  // The final door is always reachable.
  const pendingAtDoor = await page.locator('.ghost-list__ghost').count();
  await page.getByRole('button', { name: FINAL_DOOR_BUTTON_TEXT, exact: true }).click();
  await expect(page.getByTestId('final-door-seals')).toBeVisible();
  const reserved = crypt.manifest.finalDoor.slots.length;
  const seals = await page.locator('.final-door__seal').count();
  expect(seals).toBeGreaterThanOrEqual(reserved);
  // Pending ghosts come back as extra seals at the door.
  if (pendingAtDoor > 0) expect(seals).toBeGreaterThan(reserved);

  // Answer every open seal wrong, including returning ones, until the run ends.
  const escape = page.getByTestId('escape-view');
  const openSeals = page.locator('.final-door__seal-button');
  for (let guard = 0; guard < 30; guard += 1) {
    if (await escape.isVisible()) break;
    await openSeals.first().click();
    await answerWrong(page, keys);
    // Every judged answer opens an Evidence_Panel, including the one that settles the last seal and ends the run.
    await expect(continueButton(page)).toBeVisible();
    await expect(page.locator('.evidence-panel__citation').first()).toBeVisible();
    await expect(page.locator('.evidence-panel__excerpt blockquote').first()).not.toBeEmpty();
    // The escape view waits for that panel: it is not shown while the panel is open.
    await expect(escape).toHaveCount(0);
    await continueButton(page).click();
    // Either the next open seal or, after the last panel, the escape view.
    await expect(escape.or(openSeals.first())).toBeVisible();
  }

  // Escape view, then the Autopsy.
  await expect(escape).toBeVisible();
  await page.getByRole('button', { name: ROOM_PLAY_LABELS.openAutopsy, exact: true }).click();
  await page.getByTestId('autopsy-view').waitFor();
  const labels = Object.values(AUTOPSY_LABELS);
  const entries = page.locator('.autopsy-entry');
  await expect(entries).toHaveCount(2);
  for (let i = 0; i < 2; i += 1) {
    expect(labels).toContain((await entries.nth(i).locator('.autopsy-outcome__label').innerText()).trim());
  }
});

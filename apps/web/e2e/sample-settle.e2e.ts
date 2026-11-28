import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { FINAL_DOOR_BUTTON_TEXT, FINAL_DOOR_STATUS_LABELS, ROOM_PLAY_LABELS, SAMPLE_IDS } from '@escape-the-crypt/core';
import { button, enterDoor, modeFor, panelButton, panelSlot, press, startSample } from './sample-nav';
import type { InputMode } from './sample-nav';

// Every sample played from the shelf to the Autopsy by settling every question without answering it:
// Skip, or Challenge (which first swaps in the Alternate, whatever its lock type, then settles).
// Neither costs the learner anything, and the run must always be able to escape.
type How = 'skip' | 'challenge';
const OPEN_ROOM_CONTROLS = '.room-screen__lock-button[data-status="open"], .room-screen__return-button[data-status="open"]';

async function settle(page: Page, opener: Locator, how: How, mode: InputMode): Promise<void> {
  await press(page, opener, mode);
  const panel = panelSlot(page).locator('.question-panel');
  if (how === 'skip') {
    await press(page, panelButton(page, ROOM_PLAY_LABELS.skip), mode);
    await expect(panel).toHaveCount(0);
    return;
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const before = await panel.innerText();
    await press(page, panelButton(page, ROOM_PLAY_LABELS.challenge), mode);
    // After a challenge: the evidence opens, the panel closes (settled), or the Alternate replaced the question.
    await expect
      .poll(async () => {
        if ((await page.locator('.evidence-panel').count()) > 0) return 'evidence';
        if ((await panel.count()) === 0) return 'closed';
        return (await panel.innerText().catch(() => before)) !== before ? 'swapped' : 'same';
      })
      .not.toBe('same');
    if ((await page.locator('.evidence-panel').count()) > 0) {
      await press(page, panelButton(page, ROOM_PLAY_LABELS.continue), mode);
      await expect(page.locator('.evidence-panel')).toHaveCount(0);
      return;
    }
    if ((await panel.count()) === 0) return;
  }
  throw new Error('the question was still open after four challenges');
}

for (const how of ['skip', 'challenge'] as const) {
  for (const id of SAMPLE_IDS) {
    test(`${how} every question: ${id} reaches the escape and the Autopsy`, async ({ page }, testInfo) => {
      test.setTimeout(240_000);
      const mode = modeFor(testInfo.project.name);
      await startSample(page, id, mode);

      // Every room: settle each open lock (and any returning question), then go on.
      const door = button(page, FINAL_DOOR_BUTTON_TEXT);
      for (let guard = 0; guard < 60; guard += 1) {
        const open = page.locator(OPEN_ROOM_CONTROLS);
        if ((await open.count()) > 0) {
          await settle(page, open.first(), how, mode);
          continue;
        }
        const next = button(page, ROOM_PLAY_LABELS.nextRoom);
        if ((await next.count()) > 0) {
          await press(page, next, mode);
          await page.locator('.room-screen__lock-button').first().waitFor();
          continue;
        }
        if ((await door.count()) > 0) break;
        await page.waitForTimeout(100);
      }
      await expect(door).toBeVisible();

      // The final door: settle every seal, including any ghost that came back as one.
      await enterDoor(page, mode);
      for (let guard = 0; guard < 30 && (await page.locator('.final-door__seal-button').count()) > 0; guard += 1) {
        await settle(page, page.locator('.final-door__seal-button').first(), how, mode);
      }

      await expect(page.getByTestId('escape-view')).toBeVisible();
      await press(page, button(page, ROOM_PLAY_LABELS.openAutopsy), mode);
      await page.getByTestId('autopsy-view').waitFor();

      // Every door question reads as excluded from the score, and none as solved.
      const status = how === 'skip' ? 'settled' : 'challenged';
      const entries = page.locator('.autopsy-final-door__entry');
      expect(await entries.count()).toBeGreaterThanOrEqual(3);
      await expect(page.locator('.autopsy-final-door__entry[data-status="solved"]')).toHaveCount(0);
      for (let i = 0; i < (await entries.count()); i += 1) {
        await expect(entries.nth(i)).toHaveAttribute('data-status', status);
        await expect(entries.nth(i).locator('.autopsy-outcome__label')).toHaveText(FINAL_DOOR_STATUS_LABELS[status]);
      }
    });
  }
}

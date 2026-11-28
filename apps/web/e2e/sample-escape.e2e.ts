import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  ENTER_CRYPT_LABEL,
  FINAL_DOOR_BUTTON_TEXT,
  FRONT_OF_HOUSE_COPY,
  ROOM_PLAY_LABELS,
  SAMPLE_CRYPT_LABEL,
  SAMPLE_IDS,
} from '@escape-the-crypt/core';
import { SAMPLE_LIST } from '../src/features/desk/sample-list';
import { openLockName } from './crypt-helpers';
import { answerByKeyboard, tabTo } from './keyboard-answers';
import { button, buildSample } from './sample-nav';

// Every sample, played from the shelf to the Autopsy with the keyboard only, answering every question
// correctly. The answers come from the manifest the same builder produces for the app.

async function continueEvidence(page: Page): Promise<void> {
  await expect(page.locator('.evidence-panel__result[data-result="correct"]')).toBeVisible();
  await expect(page.locator('.evidence-panel__excerpt blockquote').first()).not.toBeEmpty();
  await tabTo(page, button(page, ROOM_PLAY_LABELS.continue));
  await page.keyboard.press('Enter');
}

for (const id of SAMPLE_IDS) {
  const title = SAMPLE_LIST.find((entry) => entry.id === id)?.title ?? id;
  test(`keyboard only: ${id} from the shelf to the Autopsy`, async ({ page }) => {
    test.setTimeout(300_000);
    const crypt = buildSample(id);

    // The shelf: Tab to the sample's button and press Enter.
    await page.goto('/');
    await tabTo(page, button(page, `${ENTER_CRYPT_LABEL}: ${title} ${SAMPLE_CRYPT_LABEL}`));
    await page.keyboard.press('Enter');
    // The descent: skip it with the keyboard when it plays.
    await page.locator('.room-screen, [data-testid="descent-gate"]').first().waitFor();
    const skip = button(page, FRONT_OF_HOUSE_COPY.descent.skip);
    if ((await skip.count()) > 0) {
      await tabTo(page, skip);
      await page.keyboard.press('Enter');
    }
    await expect(page.getByTestId('descent-gate')).toHaveCount(0);
    await page.locator('.room-screen__lock-button').first().waitFor();

    // The rooms, in order. After the last, the final door.
    for (const [index, room] of crypt.manifest.rooms.entries()) {
      for (const slot of room.lockSlots) {
        const lock = button(page, openLockName(slot.stationType));
        await tabTo(page, lock);
        await page.keyboard.press('Enter');
        await answerByKeyboard(page, slot.primaryQuestion, crypt.content);
        await continueEvidence(page);
        await expect(page.locator('.evidence-panel')).toHaveCount(0);
      }
      if (index < crypt.manifest.rooms.length - 1) {
        await tabTo(page, button(page, ROOM_PLAY_LABELS.nextRoom));
        await page.keyboard.press('Enter');
        const next = crypt.manifest.rooms[index + 1]?.lockSlots[0];
        if (next === undefined) throw new Error('next room has no lock');
        await expect(button(page, openLockName(next.stationType))).toBeVisible();
      }
    }
    await tabTo(page, button(page, FINAL_DOOR_BUTTON_TEXT));
    await page.keyboard.press('Enter');
    const door = crypt.manifest.finalDoor.slots;
    await expect(page.locator('.final-door__seal')).toHaveCount(door.length);
    for (const [index, slot] of door.entries()) {
      await tabTo(page, page.locator('.final-door__seal-button').first());
      await page.keyboard.press('Enter');
      await answerByKeyboard(page, slot.question, crypt.content);
      await expect(page.locator('.evidence-panel__citation').first()).toBeVisible();
      if (index === door.length - 1) await expect(page.getByTestId('escape-view')).toHaveCount(0);
      await continueEvidence(page);
    }

    // The escape view, then the Autopsy.
    await expect(page.getByTestId('escape-view')).toBeVisible();
    await tabTo(page, button(page, ROOM_PLAY_LABELS.openAutopsy));
    await page.keyboard.press('Enter');
    await page.getByTestId('autopsy-view').waitFor();
    await expect(page.locator('.autopsy-entry').first()).toBeVisible();
  });
}

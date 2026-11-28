import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FINAL_DOOR_BUTTON_TEXT, ROOM_ANNOUNCEMENT_COPY, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { enterCrypt, skipEndgameClip, waitForArtStage } from './crypt-helpers';
import { answerOpenPanel, continueButton, expectAnnounced, openFirstLock } from './haunting-flows';

// Haunting polish: each motion moment with motion allowed and with reduced motion. The names are read
// right after the action; the moment classes stay on the page until the next dispatch, so nothing here
// depends on timing. The text of each moment is checked in the live region.
const animationName = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).animationName);

for (const motion of ['no-preference', 'reduce'] as const) {
  const moving = motion === 'no-preference';
  test.describe(`motion moments, reduced motion ${moving ? 'off' : 'on'}`, () => {
    test.use({ reducedMotion: motion });

    test('candle-lit: the flame flares only when motion is allowed, and the candle text is announced', async ({ page }) => {
      await enterCrypt(page);
      await waitForArtStage(page);
      await openFirstLock(page);
      await answerOpenPanel(page, true);
      const flame = '[data-flame="progress"][data-ignite="true"] .flame__body';
      await expect(page.locator(flame)).toHaveCount(1);
      await expect(page.getByTestId('art-stage')).toHaveAttribute('data-moment', /candle-lit/);
      const name = await animationName(page, flame);
      if (moving) expect(name).toContain('flame-flare');
      else expect(name).toBe('none');
      await expect(page.locator('[data-flame="progress"]').first()).toBeVisible();
      await expectAnnounced(page, ROOM_ANNOUNCEMENT_COPY.notice.candleLit);
    });

    test('ghost-rises: the ghost rises only when motion is allowed, and it is there with its number', async ({ page }) => {
      await enterCrypt(page);
      await waitForArtStage(page);
      await openFirstLock(page);
      await answerOpenPanel(page, false);
      const ghost = page.locator('[data-ghost][data-state="rising"]');
      await expect(ghost).toHaveCount(1);
      await expect(page.getByTestId('art-stage')).toHaveAttribute('data-moment', /ghost-rises/);
      const name = await animationName(page, '[data-ghost][data-state="rising"]');
      if (moving) expect(name).toBe('ghost-rise');
      else expect(name).toBe('none');
      await expect(ghost).toHaveAttribute('data-return', /^[12]$/);
      // Still: fully drawn at once. Moving: the rise ends at full opacity within its 800 ms.
      const opacity = () => ghost.evaluate((el) => getComputedStyle(el).opacity);
      if (moving) await expect.poll(opacity, { timeout: 2000 }).toBe('1');
      else expect(await opacity()).toBe('1');
      await expectAnnounced(page, ROOM_ANNOUNCEMENT_COPY.notice.ghostSpawned);
    });

    test('ghost-laid-to-rest: the ghost fades only when motion is allowed, and it is gone', async ({ page }) => {
      // About 19 messages are queued by the time the ghost is laid to rest, shown 1.5 s apart.
      test.setTimeout(90_000);
      await enterCrypt(page);
      await waitForArtStage(page);
      // One wrong answer in room 1 summons a ghost; the other locks are answered right.
      await openFirstLock(page);
      await answerOpenPanel(page, false);
      await continueButton(page).click();
      await expect(continueButton(page)).toHaveCount(0);
      const rest = page.locator('.room-screen__lock-button[data-status="open"], .room-screen__return-button[data-status="open"]');
      for (let guard = 0; guard < 6 && (await rest.count()) > 0; guard += 1) {
        await rest.first().click();
        await answerOpenPanel(page, true);
        await continueButton(page).click();
        await expect(continueButton(page)).toHaveCount(0);
      }
      await page.getByRole('button', { name: FINAL_DOOR_BUTTON_TEXT, exact: true }).click();
      await skipEndgameClip(page);
      const seals = page.locator('.final-door__seal-button');
      await seals.first().waitFor();
      // The due ghost is drawn at the door until its returning question is answered.
      await expect(page.locator('[data-ghost]')).toHaveCount(1);
      const leaving = page.locator('[data-ghost][data-state="leaving"]');
      let sawRest = false;
      for (let guard = 0; guard < 12 && !sawRest && (await seals.count()) > 0; guard += 1) {
        await seals.first().click();
        await answerOpenPanel(page, true);
        sawRest = await leaving.waitFor({ timeout: 1000 }).then(() => true, () => false);
        if (sawRest) {
          await expect(page.getByTestId('art-stage')).toHaveAttribute('data-moment', /ghost-laid-to-rest/);
          const name = await animationName(page, '[data-ghost][data-state="leaving"]');
          if (moving) expect(name).toBe('ghost-fade');
          else expect(name).toBe('none');
          await expectAnnounced(page, ROOM_ANNOUNCEMENT_COPY.notice.ghostLaidToRest, 45_000);
          await expect(page.locator('[data-ghost]')).toHaveCount(0, { timeout: 3000 });
        }
        await continueButton(page).click();
      }
      expect(sawRest).toBe(true);
    });

    test('autopsy-opens: the page fades in only when motion is allowed, and every count and entry is there', async ({ page }) => {
      await enterCrypt(page);
      for (let guard = 0; guard < 8; guard += 1) {
        const open = page.locator('.room-screen__lock-button[data-status="open"]');
        if ((await open.count()) === 0) break;
        await open.first().click();
        await answerOpenPanel(page, true);
        await continueButton(page).click();
      }
      await page.getByRole('button', { name: FINAL_DOOR_BUTTON_TEXT, exact: true }).click();
      await skipEndgameClip(page);
      await page.locator('.final-door__seal-button').first().waitFor();
      for (let guard = 0; guard < 8 && (await page.locator('.final-door__seal-button').count()) > 0; guard += 1) {
        await page.locator('.final-door__seal-button').first().click();
        await answerOpenPanel(page, true);
        await continueButton(page).click();
      }
      await skipEndgameClip(page);
      await page.getByRole('button', { name: ROOM_PLAY_LABELS.openAutopsy, exact: true }).click();
      const view = page.getByTestId('autopsy-view');
      await view.waitFor();
      const name = await view.evaluate((el) => getComputedStyle(el).animationName);
      // The fade ends the moment focus is inside the page, so a focused heading reads "none" too.
      if (!moving) expect(name).toBe('none');
      else expect(['autopsy-open', 'none']).toContain(name);
      await expect(page.locator('[data-testid^="autopsy-count-"]')).toHaveCount(5);
      await expect(page.locator('.autopsy-entry').first()).toBeVisible();
      // The fade ends within its 600 ms; the page is then fully drawn.
      await expect.poll(() => view.evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 }).toBe('1');
    });
  });
}

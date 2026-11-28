import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { enterCrypt, waitForArtStage } from './crypt-helpers';
import { answerOpenPanel, continueButton, openAutopsy, openFirstLock, skipRooms, skipSealsToEscape } from './haunting-flows';
import { enterDoor, startSample } from './sample-nav';

// One picture per motion moment, with motion allowed and with reduced motion, for docs/build-log.md.
// Opt in with HAUNTING_SCREENSHOTS=1: the images are tracked files, so an ordinary run must not rewrite
// them. With motion allowed the picture is taken part way through the moment (about 250 ms in), so the
// frame is approximate; with reduced motion it shows the settled state, which is all there is.
const ENABLED = process.env['HAUNTING_SCREENSHOTS'] === '1';
const OUT = fileURLToPath(new URL('../../../docs/screenshots/haunting/', import.meta.url));
const MID_MOMENT_MS = 250;
const JPEG = { type: 'jpeg', quality: 70 } as const;

/** `near` crops the picture around a small thing (a flame) that a whole-room picture would lose. */
async function shoot(page: Page, name: string, moving: boolean, area: 'stage' | 'page', near?: Locator): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  if (moving) await page.waitForTimeout(MID_MOMENT_MS);
  const path = `${OUT}${name}-${moving ? 'motion' : 'reduced'}.jpg`;
  if (near !== undefined) {
    const box = await near.boundingBox();
    if (box === null) throw new Error(`${name}: nothing to crop around`);
    const x = Math.max(0, box.x - 150);
    const y = Math.max(0, box.y - 130);
    await page.screenshot({ path, ...JPEG, clip: { x, y, width: box.width + 300, height: box.height + 260 } });
  } else if (area === 'stage') await page.getByTestId('art-stage').screenshot({ path, ...JPEG });
  else await page.screenshot({ path, ...JPEG });
}

if (ENABLED) {
  for (const motion of ['no-preference', 'reduce'] as const) {
    const moving = motion === 'no-preference';
    test.describe(`screenshots, reduced motion ${moving ? 'off' : 'on'}`, () => {
      test.use({ reducedMotion: motion });
      test.skip(({ browserName }) => browserName !== 'chromium', 'one set of pictures, from chromium');

      // The flame is a few pixels wide, so this one is cropped around it and taken at double density.
      test.describe('the candle', () => {
        test.use({ deviceScaleFactor: 2 });
        test('candle-lit', async ({ page }) => {
          await enterCrypt(page);
          await waitForArtStage(page);
          await openFirstLock(page);
          await answerOpenPanel(page, true);
          await expect(page.locator('.flame--ignite')).toHaveCount(1);
          await shoot(page, 'candle-lit', moving, 'stage', page.locator('.flame--ignite'));
        });
      });

      test('ghost-rises', async ({ page }) => {
        await enterCrypt(page);
        await waitForArtStage(page);
        await openFirstLock(page);
        await answerOpenPanel(page, false);
        await expect(page.locator('[data-ghost][data-state="rising"]')).toHaveCount(1);
        await shoot(page, 'ghost-rises', moving, 'stage');
      });

      test('ghost-laid-to-rest', async ({ page }) => {
        test.setTimeout(90_000);
        await enterCrypt(page);
        await waitForArtStage(page);
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
        await enterDoor(page, 'click');
        const seals = page.locator('.final-door__seal-button');
        await seals.first().waitFor();
        const leaving = page.locator('[data-ghost][data-state="leaving"]');
        let shot = false;
        for (let guard = 0; guard < 12 && !shot && (await seals.count()) > 0; guard += 1) {
          await seals.first().click();
          await answerOpenPanel(page, true);
          shot = await leaving.waitFor({ timeout: 1000 }).then(() => true, () => false);
          if (shot) await shoot(page, 'ghost-laid-to-rest', moving, 'stage');
          await continueButton(page).click();
        }
        expect(shot).toBe(true);
      });

      test('autopsy-opens', async ({ page }) => {
        await startSample(page, 'human-heart', 'click');
        await skipRooms(page, 'click');
        await enterDoor(page, 'click');
        await skipSealsToEscape(page, 'click');
        await openAutopsy(page, 'click');
        await shoot(page, 'autopsy-opens', moving, 'page');
      });
    });
  }
}

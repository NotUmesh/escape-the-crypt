import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import {
  answerSlot,
  buildSampleCrypt,
  correctAnswerFor,
  enterCrypt,
  roomOneSlots,
  waitForArtStage,
} from './crypt-helpers';

const stage = (page: Page) => page.getByTestId('art-stage');

/** Solves the first lock so a progress Flame is drawn, then waits for it. */
async function solveFirstLock(page: Page): Promise<void> {
  const crypt = buildSampleCrypt();
  const [first] = roomOneSlots(crypt);
  if (first === undefined) throw new Error('room 1 needs a lock slot');
  await answerSlot(page, first, correctAnswerFor(crypt, first.primaryQuestion));
  await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
  await expect(page.locator(`[data-flame="progress"][data-lock="${first.stationType}"]`)).toHaveCount(1);
}

/** Computed values of every art layer and flame, read in the page. */
function readStyles(page: Page) {
  return page.evaluate(() => {
    const flames = Array.from(document.querySelectorAll('.flame__body')).map((el) => getComputedStyle(el).animationName);
    const layerTransforms = Array.from(document.querySelectorAll('.art-stage img.art-layer')).map(
      (el) => getComputedStyle(el).transform,
    );
    const crossfades = Array.from(document.querySelectorAll('.art-layer--rest, .art-layer--hover')).map(
      (el) => getComputedStyle(el).transitionDuration,
    );
    return { flames, layerTransforms, crossfades };
  });
}

test.describe('reduced motion (Requirements 25.6, 12.2-12.4)', () => {
  test.use({ reducedMotion: 'reduce' });

  test('nothing moves on pointer move, flames do not flicker and crossfades are instant', async ({
    page,
  }) => {
    await enterCrypt(page);
    await waitForArtStage(page);
    await solveFirstLock(page);

    await expect(stage(page)).toHaveAttribute('data-parallax', 'off');

    // Pointer moves across the stage do not shift any layer.
    const box = await stage(page).boundingBox();
    if (box === null) throw new Error('stage has no box');
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5, { steps: 5 });
    const styles = await readStyles(page);
    expect(styles.layerTransforms.length).toBeGreaterThan(3);
    expect(new Set(styles.layerTransforms)).toEqual(new Set(['none']));
    const flames = page.locator('.art-stage__flames');
    expect(await flames.evaluate((el) => getComputedStyle(el).transform)).toBe('none');

    // No flicker or flare on any flame, ambient or progress.
    expect(styles.flames.length).toBeGreaterThan(1);
    expect(new Set(styles.flames)).toEqual(new Set(['none']));

    // Crossfades are instant.
    expect(styles.crossfades.length).toBeGreaterThan(0);
    expect(new Set(styles.crossfades)).toEqual(new Set(['0s']));
  });
});

test('without reduced motion the same checks see motion, so the test above can fail', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await enterCrypt(page);
  await waitForArtStage(page);
  await solveFirstLock(page);
  await expect(stage(page)).toHaveAttribute('data-parallax', 'on');
  const styles = await readStyles(page);
  expect(styles.flames.some((name) => name !== 'none')).toBe(true);
  expect(styles.layerTransforms.some((value) => value !== 'none')).toBe(true);
  expect(styles.crossfades.some((value) => value !== '0s')).toBe(true);
});

test.describe('phone viewport (Requirements 25.13, 11.6, 12.9)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('every drawn Hotspot_Button is at least 44 by 44 and a lock can be opened and answered', async ({ page }) => {
    const crypt = buildSampleCrypt();
    const [first] = roomOneSlots(crypt);
    if (first === undefined) throw new Error('room 1 needs a lock slot');
    await enterCrypt(page);
    await waitForArtStage(page);
    await expect(stage(page)).toHaveAttribute('data-cropped', 'true');

    const buttons = page.locator('.room-hotspot');
    const count = await buttons.count();
    expect(count).toBe(roomOneSlots(crypt).length);
    for (let i = 0; i < count; i += 1) {
      const box = await buttons.nth(i).boundingBox();
      if (box === null) throw new Error(`hotspot ${i} has no box`);
      expect(box.width, `hotspot ${i} width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `hotspot ${i} height`).toBeGreaterThanOrEqual(44);
    }

    await answerSlot(page, first, correctAnswerFor(crypt, first.primaryQuestion));
    await expect(page.locator('.evidence-panel__result[data-result="correct"]')).toBeVisible();
    await page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true }).click();
    await expect(page.locator(`.room-hotspot[data-lock="${first.stationType}"]`)).toHaveAttribute('data-status', 'solved');
  });
});

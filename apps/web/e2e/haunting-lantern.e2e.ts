import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openAutopsy, skipRooms, skipSealsToEscape } from './haunting-flows';
import { enterDoor, startSample } from './sample-nav';

// One Lantern setting, one stored value, on every screen from the title to the Autopsy. The key is the
// only thing the app keeps in localStorage.
const KEY = 'escape-the-crypt:lantern';
const toggle = (page: Page) => page.locator('button.lantern-toggle');
const overlay = (page: Page) => page.locator('[data-testid="atmosphere"]');
const stored = (page: Page) =>
  page.evaluate((key) => ({ value: localStorage.getItem(key), keys: Object.keys(localStorage) }), KEY);

test.describe('motion allowed', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('the title, the crypt and a reload read and write one value', async ({ page }) => {
    await page.goto('/');
    await expect(toggle(page)).toHaveCount(1);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    expect(await stored(page)).toEqual({ value: null, keys: [] });

    // Switched on at the title: stored once, and the crypt starts in Lantern mode with no overlay.
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await stored(page)).toEqual({ value: 'on', keys: [KEY] });
    await startSample(page, 'human-heart', 'click');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('art-stage')).toHaveAttribute('data-lantern', 'true');
    await expect(overlay(page)).toHaveCount(0);

    // Switched off in the crypt: the overlay is back, the same key says off, and the title agrees after a reload.
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(overlay(page)).toHaveCount(1);
    expect(await stored(page)).toEqual({ value: 'off', keys: [KEY] });
    await page.goto('/');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    expect(await stored(page)).toEqual({ value: 'off', keys: [KEY] });
  });

  test('a choice made in the crypt holds at the final door, the escape view and the Autopsy', async ({ page }) => {
    await startSample(page, 'human-heart', 'click');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await skipRooms(page, 'click');
    await enterDoor(page, 'click');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(overlay(page)).toHaveCount(0);
    await skipSealsToEscape(page, 'click');
    await expect(toggle(page)).toHaveCount(1);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await openAutopsy(page, 'click');
    await expect(toggle(page)).toHaveCount(1);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(overlay(page)).toHaveCount(0);
    expect(await stored(page)).toEqual({ value: 'on', keys: [KEY] });
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('Lantern mode is on by default on every screen, with no overlay and nothing stored', async ({ page }) => {
    await page.goto('/');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await startSample(page, 'human-heart', 'click');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(overlay(page)).toHaveCount(0);
    await skipRooms(page, 'click');
    await enterDoor(page, 'click');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await skipSealsToEscape(page, 'click');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await openAutopsy(page, 'click');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(overlay(page)).toHaveCount(0);
    // A default is not a choice: nothing was written.
    expect(await stored(page)).toEqual({ value: null, keys: [] });
  });
});

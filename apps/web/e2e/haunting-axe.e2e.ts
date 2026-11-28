import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openAutopsy, skipRooms, skipSealsToEscape } from './haunting-flows';
import { enterDoor, startSample } from './sample-nav';

// Axe on every screen the haunting polish touches: the room with the overlay drawn, the room in Lantern
// mode, the final door, the escape view, and the Autopsy (with the quill and the toggle) after its fade
// and under reduced motion. Axe reports text drawn over an image as "incomplete", not as a violation;
// the contrast of the text that sits over the art is checked from the tokens in overlay-contrast.test.ts.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function scan(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  // The rules really ran, so an empty list of violations is not a scan that did nothing.
  expect(results.passes.length, `${label}: rules ran`).toBeGreaterThan(10);
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    label,
  ).toEqual([]);
}
const toggle = (page: Page) => page.locator('button.lantern-toggle');
const overlay = (page: Page) => page.locator('[data-testid="atmosphere"]');

test.describe('motion allowed', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('the room, with the overlay drawn and Lantern mode off', async ({ page }) => {
    await startSample(page, 'https', 'click');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(overlay(page)).toHaveCount(1);
    await scan(page, 'room, overlay present');
  });

  test('the room, in Lantern mode', async ({ page }) => {
    await startSample(page, 'https', 'click');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(overlay(page)).toHaveCount(0);
    await scan(page, 'room, Lantern mode');
  });

  test('the final door and the escape view', async ({ page }) => {
    await startSample(page, 'human-heart', 'click');
    await skipRooms(page, 'click');
    await enterDoor(page, 'click');
    await expect(overlay(page)).toHaveCount(1);
    await scan(page, 'final door, overlay present');
    await skipSealsToEscape(page, 'click');
    await scan(page, 'escape view');
  });

  test('the Autopsy, after its fade, with the quill and the toggle', async ({ page }) => {
    await startSample(page, 'human-heart', 'click');
    await skipRooms(page, 'click');
    await enterDoor(page, 'click');
    await skipSealsToEscape(page, 'click');
    await openAutopsy(page, 'click');
    const view = page.getByTestId('autopsy-view');
    await expect.poll(() => view.evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 }).toBe('1');
    await expect(page.locator('.autopsy-view .quill-mark')).toHaveAttribute('aria-hidden', 'true');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await scan(page, 'Autopsy, after the fade');
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the Autopsy with the quill at rest and the toggle pressed', async ({ page }) => {
    await startSample(page, 'human-heart', 'click');
    await skipRooms(page, 'click');
    await enterDoor(page, 'click');
    await skipSealsToEscape(page, 'click');
    await openAutopsy(page, 'click');
    // Nothing moves: the page is drawn at once and the quill shows its finished stroke.
    await expect(page.getByTestId('autopsy-view')).toHaveCSS('opacity', '1');
    await expect(page.locator('.quill-mark__stroke')).toHaveCSS('animation-name', 'none');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await scan(page, 'Autopsy, reduced motion, toggle pressed');
  });

  test('the room and the escape view in Lantern mode by default', async ({ page }) => {
    await startSample(page, 'human-heart', 'click');
    await expect(overlay(page)).toHaveCount(0);
    await scan(page, 'room, reduced motion');
    await skipRooms(page, 'click');
    await enterDoor(page, 'click');
    await skipSealsToEscape(page, 'click');
    await scan(page, 'escape view, reduced motion');
  });
});

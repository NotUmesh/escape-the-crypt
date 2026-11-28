import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { openAutopsy, skipRooms, skipSealsToEscape } from './haunting-flows';
import { enterDoor, panelSlot, startSample } from './sample-nav';

// Decorative art never takes the pointer or focus; playing a sample never calls an AI provider.
const HIT_SELECTORS = {
  room: '.room-hotspot, .room-screen__lock-button',
  panel: '.question-panel button, .question-panel input, .question-panel [role="spinbutton"]',
  seals: '.final-door__seal-button',
};

/** The control under the middle of each match is the control, never an overlay part. */
async function pointerReaches(page: Page, selector: string): Promise<{ checked: number; misses: string[] }> {
  return page.evaluate((sel) => {
    const misses: string[] = [];
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(
      (el) => el.getClientRects().length > 0 && el.closest('[hidden], [inert]') === null,
    );
    for (const el of nodes) {
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (hit === null || !(hit === el || el.contains(hit))) {
        const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.className;
        misses.push(`${name} -> ${hit === null ? 'nothing' : String(hit.className) || hit.tagName}`);
      }
    }
    return { checked: nodes.length, misses };
  }, selector);
}

/**
 * Tabs through the page and compares each stop with the DOM order of the tabbable elements. The first
 * Tab may land anywhere after the last click, so the stops must follow the list from there, in order.
 * Every stop must show focus: an outline or a shadow, and `:focus-visible` must apply.
 */
async function expectTabOrder(page: Page, label: string): Promise<void> {
  const expected = await page.evaluate(() => {
    const selector = 'a[href], button, input, select, textarea, [tabindex]';
    const tabbable = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((el) => {
      if (el.hasAttribute('disabled') || el.getAttribute('tabindex') === '-1') return false;
      if (el.closest('[inert], [hidden]') !== null || el.getClientRects().length === 0) return false;
      return getComputedStyle(el).visibility !== 'hidden';
    });
    tabbable.forEach((el, i) => el.setAttribute('data-tabi', String(i)));
    return tabbable.map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 24) ?? el.tagName);
  });
  expect(expected.length, `${label}: tabbable elements`).toBeGreaterThan(1);
  const stops: { index: number; boundary: boolean; visible: boolean; ring: boolean; name: string }[] = [];
  // One more press than there are controls: the extra stop is the page boundary, where focus leaves and wraps.
  for (let i = 0; i < Math.min(expected.length + 1, 41); i += 1) {
    await page.keyboard.press('Tab');
    stops.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (el === null || el === document.body) return { index: -1, boundary: true, visible: true, ring: true, name: 'boundary' };
        const style = getComputedStyle(el);
        const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
        return {
          index: el.hasAttribute('data-tabi') ? Number(el.getAttribute('data-tabi')) : -1,
          boundary: false,
          visible: el.matches(':focus-visible'),
          ring: outline || style.boxShadow !== 'none',
          name: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 24) ?? el.tagName,
        };
      }),
    );
  }
  const real = stops.filter((s) => !s.boundary);
  expect(real.filter((s) => s.index < 0).map((s) => s.name), `${label}: focus stops outside the tabbable list`).toEqual([]);
  const start = real[0]?.index ?? -1;
  expect(start, `${label}: the first Tab lands on a tabbable element`).toBeGreaterThanOrEqual(0);
  const order = real.map((s) => s.index);
  expect(order, `${label}: tab order`).toEqual(order.map((_, i) => (start + i) % expected.length));
  expect(new Set(order).size, `${label}: every control is reached`).toBe(expected.length);
  expect(real.filter((s) => !s.visible || !s.ring).map((s) => s.name), `${label}: stops without a visible focus`).toEqual([]);
}

test.describe('motion allowed', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('the pointer reaches controls in the room, the panel and at the door', async ({ page }) => {
    await startSample(page, 'https', 'click');
    const room = await pointerReaches(page, HIT_SELECTORS.room);
    expect(room.checked).toBeGreaterThanOrEqual(2);
    expect(room.misses).toEqual([]);

    await page.locator('.room-hotspot').first().click();
    await expect(panelSlot(page).locator('.question-panel')).toBeVisible();
    const panel = await pointerReaches(page, HIT_SELECTORS.panel);
    expect(panel.checked).toBeGreaterThanOrEqual(5);
    expect(panel.misses).toEqual([]);
    await page.keyboard.press('Escape');

    await skipRooms(page, 'click');
    await enterDoor(page, 'click');
    const door = await pointerReaches(page, HIT_SELECTORS.seals);
    expect(door.checked).toBeGreaterThanOrEqual(3);
    expect(door.misses).toEqual([]);
  });

  test('a click and a key press reach a lock', async ({ page }) => {
    await startSample(page, 'https', 'click');
    const lock = page.locator('.room-hotspot').first();
    await lock.click();
    await expect(panelSlot(page).locator('.question-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panelSlot(page).locator('.question-panel')).toHaveCount(0);
    await expect(lock).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panelSlot(page).locator('.question-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Space');
    await expect(panelSlot(page).locator('.question-panel')).toBeVisible();
  });

  test('the tab order is the page order, with focus visible, in the room and the Autopsy', async ({ page }) => {
    await startSample(page, 'human-heart', 'click');
    await expectTabOrder(page, 'room');
    await skipRooms(page, 'click');
    await enterDoor(page, 'click');
    await expectTabOrder(page, 'final door');
    await skipSealsToEscape(page, 'click');
    await openAutopsy(page, 'click');
    await expect(page.getByTestId('autopsy-view')).toHaveCSS('opacity', '1');
    await expectTabOrder(page, 'Autopsy');
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the tab order and focus in the Autopsy hold with the quill at rest', async ({ page }) => {
    await startSample(page, 'human-heart', 'click');
    await skipRooms(page, 'click');
    await enterDoor(page, 'click');
    await skipSealsToEscape(page, 'click');
    await openAutopsy(page, 'click');
    await expectTabOrder(page, 'Autopsy, reduced motion');
    // The quill takes no focus and no pointer.
    await expect(page.locator('.quill-mark')).toHaveCSS('pointer-events', 'none');
    expect(await page.locator('.quill-mark').evaluate((el) => el.querySelectorAll('[tabindex], a, button').length)).toBe(0);
  });
});

test('playing a sample from the shelf to the Autopsy makes no request that leaves the origin', async ({ page, baseURL }) => {
  const seen: { url: string; method: string }[] = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) seen.push({ url: request.url(), method: request.method() });
  });
  await startSample(page, 'human-heart', 'click');
  await skipRooms(page, 'click');
  await enterDoor(page, 'click');
  await skipSealsToEscape(page, 'click');
  await openAutopsy(page, 'click');
  await page.getByRole('button', { name: ROOM_PLAY_LABELS.playAgain, exact: true }).waitFor();
  const origin = new URL(baseURL ?? '').origin;
  expect(seen.length).toBeGreaterThan(5);
  expect(seen.filter((r) => new URL(r.url).origin !== origin).map((r) => r.url)).toEqual([]);
  expect(seen.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.url}`)).toEqual([]);
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ENTER_CRYPT_LABEL, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { NOTES_TEXT, buildSampleCrypt, correctAnswerFor, openLockName, roomOneSlots, submitAnswer } from './crypt-helpers';

// Requirements 7.8 and 12.13: the save banner has no axe violations and never overlaps the
// Question_Panel or the Evidence_Panel.
const crypt = buildSampleCrypt();

test('save banner: no axe violations and no overlap with the question or evidence panel', async ({ page }) => {
  await page.goto('/ingest');
  await page.locator('.ingest-paste textarea').fill(NOTES_TEXT);
  await page.getByRole('button', { name: 'Confirm notes' }).click();

  // From here on, saving to this device fails: new connections are refused and open ones throw.
  await page.evaluate(() => {
    IDBDatabase.prototype.transaction = function () {
      throw new DOMException('blocked for the test', 'QuotaExceededError');
    };
    IDBFactory.prototype.open = function () {
      const request = {
        result: undefined as unknown,
        error: new DOMException('blocked for the test', 'UnknownError'),
        onerror: null as ((event?: unknown) => void) | null,
        addEventListener: (type: string, fn: () => void) => {
          if (type === 'error') setTimeout(fn, 0);
        },
        removeEventListener: () => undefined,
      };
      setTimeout(() => request.onerror?.(), 0);
      return request as unknown as IDBOpenDBRequest;
    };
  });

  await page.getByRole('button', { name: ENTER_CRYPT_LABEL }).click();
  await page.locator('.room-screen').waitFor();
  await page.locator('.room-screen__lock-button').first().waitFor();

  const slot = roomOneSlots(crypt)[0];
  if (slot === undefined) throw new Error('sample crypt room 1 has no slots');
  await page.getByRole('button', { name: openLockName(slot.stationType), exact: true }).click();
  await expect(page.getByTestId('panel-slot').getByRole('button', { name: ROOM_PLAY_LABELS.submitAnswer })).toBeVisible();

  const banner = page.getByTestId('save-banner');
  await expect(banner).toContainText("isn't being saved");

  // In normal flow, not an ancestor of either panel, and not overlapping the panel that is open.
  const checkLayout = async (panelSelector: string): Promise<void> => {
    const layout = await banner.evaluate((el, selector) => {
      const region = el.querySelector('.save-banner') ?? el;
      const positions = [el, region].map((node) => getComputedStyle(node).position);
      const panels = Array.from(document.querySelectorAll(selector));
      const bannerBox = el.getBoundingClientRect();
      const overlaps = panels.map((panel) => {
        const box = panel.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          bannerBox.left < box.right &&
          bannerBox.right > box.left &&
          bannerBox.top < box.bottom &&
          bannerBox.bottom > box.top
        );
      });
      return { positions, panelCount: panels.length, containsPanel: panels.some((p) => el.contains(p)), overlaps };
    }, panelSelector);
    expect(layout.panelCount).toBeGreaterThan(0);
    expect(layout.containsPanel).toBe(false);
    for (const position of layout.positions) expect(['absolute', 'fixed']).not.toContain(position);
    expect(layout.overlaps.some(Boolean)).toBe(false);
  };

  await checkLayout('.question-panel');

  // Answer correctly so the Evidence_Panel opens while the banner is still showing.
  await submitAnswer(page, correctAnswerFor(crypt, slot.primaryQuestion));
  await expect(page.locator('.evidence-panel')).toBeVisible();
  await expect(banner).toContainText("isn't being saved");
  await expect(page.locator('.evidence-panel__excerpt blockquote').first()).not.toBeEmpty();
  expect(await page.locator('.evidence-panel').count()).toBeGreaterThan(0);
  await checkLayout('.evidence-panel');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.passes.length).toBeGreaterThan(10);
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
});

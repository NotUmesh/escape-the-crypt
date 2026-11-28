import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { chooseOption, payloadOf, setWheels, textOf, typeNumber } from './lock-actions';
import { buildSample, findTarget, panelButton, panelSlot, press, questionOf, routeTo, startSample } from './sample-nav';

// Accessibility evidence: axe on each newer Lock_Panel while it is open. Each type is scanned fresh,
// with a hint applied (where the type has one), and part way through an answer, so the selected,
// tied, fixed and typed states are scanned too. Phone and desktop layouts both run.
const SAMPLE = 'https';
const crypt = buildSample(SAMPLE);
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
async function open(page: Page, lockType: Parameters<typeof findTarget>[1]) {
  const target = findTarget(crypt, lockType);
  await startSample(page, SAMPLE, 'click');
  await routeTo(page, crypt, target, 'click');
  await expect(panelSlot(page).locator(`.${lockType}-panel`)).toBeVisible();
  return questionOf(target);
}
async function useHint(page: Page): Promise<void> {
  await press(page, panelButton(page, ROOM_PLAY_LABELS.hint), 'click');
  await expect(panelButton(page, ROOM_PLAY_LABELS.hint)).toBeDisabled();
}

test.describe('axe with each newer lock panel open', () => {
  test('bone ordering', async ({ page }) => {
    const question = await open(page, 'bone-ordering');
    await scan(page, 'bone ordering, fresh');
    await useHint(page);
    await expect(panelSlot(page).getByText(/Fixed by the hint/)).toBeVisible();
    await scan(page, 'bone ordering, hint applied');
    const text = textOf(crypt.content, question);
    const lastBone = (payloadOf(question)['keyOrder'] as string[]).at(-1) ?? '';
    await panelSlot(page).getByRole('button', { name: new RegExp(`^Move up: ${text(lastBone).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, position`) }).click();
    await scan(page, 'bone ordering, one bone moved');
  });

  test('bound threads', async ({ page }) => {
    const question = await open(page, 'bound-threads');
    await scan(page, 'bound threads, fresh');
    await useHint(page);
    await expect(panelSlot(page).getByText(/Tied by the hint/)).toBeVisible();
    await scan(page, 'bound threads, hint applied');
    const text = textOf(crypt.content, question);
    const pairs = payloadOf(question)['keyPairs'] as string[][];
    // Select the last left item and leave it selected: aria-pressed and the "selected" name.
    const last = pairs.at(-1)?.[0] ?? '';
    await panelSlot(page).getByRole('button', { name: new RegExp(`^${text(last).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, not tied`) }).click();
    await scan(page, 'bound threads, a left item selected');
  });

  // Playwright's Firefox build crashes the page when a text input and axe are used on the same page, in
  // either order (the existing rune cipher input does too; Playwright runs a fallback build on this OS).
  // So the typed-entry state is its own test, skipped on Firefox only, and scanned on chromium and pixel.
  test('combination dial', async ({ page }) => {
    await open(page, 'combination-dial');
    await scan(page, 'combination dial, fresh');
    await setWheels(page, 4, 'click');
    await scan(page, 'combination dial, a wheel turned');
  });

  test('combination dial, a number typed', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'firefox', 'Firefox crashes when axe and a text input share a page; scanned on chromium and pixel');
    const question = await open(page, 'combination-dial');
    await typeNumber(page, Number(payloadOf(question)['exactValue']), 'click');
    await scan(page, 'combination dial, a number typed');
  });

  test('cursed object', async ({ page }) => {
    const question = await open(page, 'cursed-object');
    await scan(page, 'cursed object, fresh');
    await useHint(page);
    await expect(panelSlot(page).getByText(/Removed by the hint/)).toBeVisible();
    await scan(page, 'cursed object, hint applied');
    await chooseOption(page, String(payloadOf(question)['oddOneOutId']), 'click');
    await scan(page, 'cursed object, an item chosen');
  });
});

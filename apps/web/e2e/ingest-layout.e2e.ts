import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../src/features/ingest/fixtures/${name}`, import.meta.url));

const PROSE =
  'Active recall means producing an answer from memory instead of re-reading the notes. ' +
  'Spaced repetition schedules each review just before the learner would forget the item.';

/** The red, green and blue values of a token in tokens.css. */
function tokenChannels(name: string): number[] {
  const css = readFileSync(fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url)), 'utf8');
  const hex = new RegExp(`${name}:\\s*#([0-9a-f]{6})`, 'i').exec(css)?.[1];
  if (hex === undefined) throw new Error(`token ${name} not found`);
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const TEAL_RING = tokenChannels('--spectre-300');
const INK_RING = tokenChannels('--ink-900');

/** Channels of a computed colour such as the text a browser reports for an outline. */
const channels = (computed: string | undefined): number[] => (computed?.match(/\d+/g) ?? []).slice(0, 3).map(Number);

// The parent is wider than a phone viewport at 720 and 1024, so give the page room.
async function open(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width: Math.max(width + 80, 480), height: 1000 });
  await page.goto(`/test-parent.html?width=${width}`);
  await expect(page.locator('.ingest-root')).toBeVisible();
}

async function pasteNotes(page: Page): Promise<void> {
  await page.locator('.ingest-paste textarea').fill(`${PROSE}\n\n${PROSE}`);
  await expect(page.locator('.ingest-preview')).toBeVisible();
}

/** Uploads a one-page PDF, chooses the page and reads it, ending on the preview. */
async function readPdf(page: Page, name: string): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(fixture(name));
  await expect(page.locator('.ingest-pdf-page')).toHaveCount(1);
  await page.locator('.ingest-pdf-page input').check();
  await page.getByRole('button', { name: 'Read these pages' }).click();
  await expect(page.locator('.ingest-preview')).toBeVisible();
}

/** The box a person must hit: a checkbox's label, otherwise the control itself. */
function target(control: Locator): Locator {
  return control.locator('xpath=self::input[@type="checkbox"]/ancestor::label[1] | self::*[not(self::input[@type="checkbox"])]');
}

async function checkControls(page: Page): Promise<number> {
  const controls = page.locator('.ingest-root button, .ingest-root input, .ingest-root textarea');
  const count = await controls.count();
  for (let i = 0; i < count; i += 1) {
    const hit = target(controls.nth(i));
    await hit.scrollIntoViewIfNeeded();
    await expect(hit).toBeVisible();
    const box = await hit.boundingBox();
    expect(box, `control ${i}`).not.toBeNull();
    expect(box?.width ?? 0, `control ${i} width`).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0, `control ${i} height`).toBeGreaterThanOrEqual(44);
    // Not covered: the element at the centre of the control is the control (or inside it).
    const covered = await hit.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return top === null || !(top === el || el.contains(top));
    });
    expect(covered, `control ${i} is covered`).toBe(false);
  }
  return count;
}

for (const width of [360, 720]) {
  test.describe(`in a ${width}px parent`, () => {
    test('every control is visible, uncovered and at least 44x44 (paste and preview)', async ({ page }) => {
      await open(page, width);
      await pasteNotes(page);
      expect(await checkControls(page)).toBeGreaterThanOrEqual(5);
    });

    test('every control is visible, uncovered and at least 44x44 (PDF page choice and flagged page)', async ({ page }) => {
      await open(page, width);
      await page.locator('input[type="file"]').setInputFiles(fixture('image-only.pdf'));
      await expect(page.locator('.ingest-pdf-page')).toHaveCount(1);
      await checkControls(page);
      await page.locator('.ingest-pdf-page input').check();
      await page.getByRole('button', { name: 'Read these pages' }).click();
      await expect(page.getByRole('button', { name: 'Remove page' })).toBeVisible();
      await checkControls(page);
    });

    test('components fill the width the parent gives', async ({ page }) => {
      await open(page, width);
      await pasteNotes(page);
      const parentInner = await page.locator('.ingest-root').evaluate((el) => el.getBoundingClientRect().width);
      const parent = await page.getByTestId('test-parent').evaluate((el) => {
        const style = getComputedStyle(el);
        return el.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      });
      expect(Math.abs(parentInner - parent)).toBeLessThanOrEqual(1);
      for (const selector of ['.ingest-privacy', '.ingest-paste', '.ingest-pdf', '.ingest-preview']) {
        const w = await page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().width);
        expect(Math.abs(w - parentInner), selector).toBeLessThanOrEqual(1);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
    });
  });
}

test('works by click', async ({ page }) => {
  await open(page, 360);
  await readPdf(page, 'image-only.pdf');
  await page.getByRole('button', { name: 'Remove page' }).click();
  await expect(page.getByRole('status')).toHaveText('Page 1 removed');
});

test('works by keyboard alone after the file is chosen', async ({ page }) => {
  await open(page, 360);
  await page.locator('input[type="file"]').setInputFiles(fixture('image-only.pdf'));
  const box = page.locator('.ingest-pdf-page input');
  await expect(box).toBeVisible();
  await box.focus();
  await page.keyboard.press('Space');
  await expect(box).toBeChecked();
  await page.keyboard.press('Tab');
  const read = page.getByRole('button', { name: 'Read these pages' });
  await expect(read).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ingest-preview')).toBeVisible();
  // Tab on to Remove page and press Enter.
  const remove = page.getByRole('button', { name: 'Remove page' });
  await remove.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Page 1 removed');
});

test.describe('style', () => {
  const computed = (locator: Locator, prop: string): Promise<string> =>
    locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

  test('uses the Title font on titles and the Body font elsewhere', async ({ page }) => {
    await open(page, 360);
    await pasteNotes(page);
    expect(await computed(page.locator('.ingest-title').first(), 'font-family')).toContain('Cinzel');
    for (const locator of [
      page.locator('.ingest-preview .ingest-hint'),
      page.locator('.ingest-paste textarea'),
      page.getByRole('button', { name: 'Confirm notes' }),
    ]) {
      const family = await computed(locator, 'font-family');
      expect(family).toContain('Crimson Pro');
      expect(family).not.toContain('Cinzel');
    }
  });

  for (const [width, size, lineHeight] of [
    [360, '16px', '24px'],
    [1024, '18px', '27px'],
  ] as const) {
    test(`sets ${size} text with line height 1.5 in a ${width}px parent`, async ({ page }) => {
      await open(page, width);
      await pasteNotes(page);
      for (const locator of [
        page.locator('.ingest-paste'),
        page.locator('.ingest-preview .ingest-hint'),
        page.locator('.ingest-paste textarea'),
        page.getByRole('button', { name: 'Confirm notes' }),
      ]) {
        expect(await computed(locator, 'font-size')).toBe(size);
        expect(await computed(locator, 'line-height')).toBe(lineHeight);
      }
    });
  }

  test('shows a 2px focus outline after Tab: dark on parchment, teal elsewhere', async ({ page }) => {
    await open(page, 360);
    await pasteNotes(page);
    const total = await page.locator('.ingest-root').locator('button:not(:disabled), input:not(:disabled), textarea').count();
    expect(total).toBeGreaterThanOrEqual(5);
    let sawLight = false;
    let sawDark = false;
    // The paste box has focus after typing; start there, then Tab through the rest.
    await page.locator('.ingest-paste textarea').focus();
    for (let i = 0; i < total; i += 1) {
      if (i > 0) await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (el === null || !el.closest('.ingest-root')) return null;
        const style = getComputedStyle(el);
        return {
          width: style.outlineWidth,
          style: style.outlineStyle,
          color: style.outlineColor,
          onLight: el.closest('.ingest-on-light') !== null,
        };
      });
      expect(info, `tab stop ${i}`).not.toBeNull();
      expect(info?.width).toBe('2px');
      expect(info?.style).toBe('solid');
      expect(channels(info?.color)).toEqual(info?.onLight ? INK_RING : TEAL_RING);
      if (info?.onLight) sawLight = true;
      else sawDark = true;
    }
    expect(sawLight && sawDark).toBe(true);
  });
});

test.describe('Stop button', () => {
  type Hooks = { releaseCount(): void; releaseStart(): void };
  const release = (page: Page, which: 'releaseCount' | 'releaseStart'): Promise<void> =>
    page.evaluate((name) => (globalThis as unknown as { ingestTest: Hooks }).ingestTest[name](), which);

  async function openHeld(page: Page): Promise<Locator> {
    await page.setViewportSize({ width: 480, height: 1000 });
    await page.goto('/test-parent.html?width=360&hold=1');
    await page.locator('input[type="file"]').setInputFiles(fixture('image-only.pdf'));
    return page.getByRole('button', { name: 'Stop reading' });
  }

  async function expectMeasurable(page: Page, stop: Locator): Promise<void> {
    await expect(stop).toBeVisible();
    // checkControls measures every control, Stop included, and checks none is covered.
    await checkControls(page);
    const box = await stop.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  test('is visible, 44x44, uncovered and keyboard-operable while the PDF is opened', async ({ page }) => {
    const stop = await openHeld(page);
    await expect(page.getByText('Opening your PDF')).toBeVisible();
    await expectMeasurable(page, stop);
    await stop.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toHaveText('Reading stopped. Nothing was kept.');
    await expect(stop).toHaveCount(0);
    await release(page, 'releaseCount');
    // A stopped count stays stopped after it is released.
    await expect(page.locator('.ingest-pdf-page')).toHaveCount(0);
  });

  test('is visible, 44x44, uncovered and keyboard-operable while pages are read', async ({ page }) => {
    const stop = await openHeld(page);
    await release(page, 'releaseCount');
    await expect(page.locator('.ingest-pdf-page')).toHaveCount(1);
    await page.locator('.ingest-pdf-page input').check();
    await page.getByRole('button', { name: 'Read these pages' }).click();
    await expect(page.getByText('Reading page 1 of 1')).toBeVisible();
    await expectMeasurable(page, stop);
    // Release the held read: Stop goes away and the preview appears.
    await release(page, 'releaseStart');
    await expect(page.locator('.ingest-preview')).toBeVisible();
    await expect(stop).toHaveCount(0);
  });

  test('stops a held read with the Space key', async ({ page }) => {
    const stop = await openHeld(page);
    await release(page, 'releaseCount');
    await page.locator('.ingest-pdf-page input').check();
    await page.getByRole('button', { name: 'Read these pages' }).click();
    await stop.focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('status')).toHaveText('Reading stopped. Nothing was kept.');
    await release(page, 'releaseStart');
    await expect(page.locator('.ingest-preview')).toHaveCount(0);
  });
});
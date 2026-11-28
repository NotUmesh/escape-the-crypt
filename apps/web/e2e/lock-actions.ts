import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { LOCK_PANEL_LABELS, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { CryptContent, CryptManifest } from '@escape-the-crypt/core';
import { tabTo } from './keyboard-answers';
import { panelButton, panelSlot, press } from './sample-nav';
import type { InputMode } from './sample-nav';

type Question = CryptManifest['finalDoor']['slots'][number]['question'];

/** Mode-aware answering for the four newer lock types. Answers are read from the manifest payload. */
const rx = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PLACES = ['ones', 'tens', 'hundreds', 'thousands'] as const;

export function payloadOf(question: Question): Record<string, unknown> {
  if (typeof question.payload !== 'object' || question.payload === null) throw new Error('payload unreadable');
  return question.payload as Record<string, unknown>;
}
export function textOf(content: CryptContent, question: Question): (id: string) => string {
  return (id) => {
    const found = content.questions[question.questionId]?.options?.[id];
    if (found === undefined) throw new Error(`item text missing: ${question.questionId} ${id}`);
    return found;
  };
}
export async function submit(page: Page, mode: InputMode): Promise<void> {
  await press(page, panelButton(page, ROOM_PLAY_LABELS.submitAnswer), mode);
}

/** Moves each bone up to its place: Alt+Arrow on the keyboard, the Move up button by tap or click. */
export async function orderBones(page: Page, keyOrder: readonly string[], text: (id: string) => string, mode: InputMode): Promise<void> {
  const panel = panelSlot(page);
  for (const [target, id] of keyOrder.entries()) {
    const up = panel.getByRole('button', { name: new RegExp(`^Move up: ${rx(text(id))}, position`) });
    if (mode === 'keyboard') await tabTo(page, up);
    for (let guard = 0; guard < keyOrder.length; guard += 1) {
      const label = (await up.getAttribute('aria-label')) ?? '';
      const position = Number(/position (\d+) of/.exec(label)?.[1] ?? target + 1);
      if (position - 1 <= target) break;
      if (mode === 'keyboard') await page.keyboard.press('Alt+ArrowUp');
      else if (mode === 'tap') await up.tap();
      else await up.click();
      await expect(up).not.toHaveAttribute('aria-label', label);
    }
  }
}

async function tie(page: Page, left: string, right: string, mode: InputMode): Promise<void> {
  const panel = panelSlot(page);
  await press(page, panel.getByRole('button', { name: new RegExp(`^${rx(left)}, (not tied|selected)`) }), mode);
  await press(page, panel.getByRole('button', { name: new RegExp(`^${rx(right)}, not tied`) }), mode);
  await expect(panel.getByRole('button', { name: new RegExp(`^${rx(left)}, tied to`) })).toBeVisible();
}
/** Ties every pair. With `undoFirst`, ties the first item to the wrong partner and undoes it before the real ties. */
export async function tieThreads(
  page: Page,
  pairs: readonly (readonly string[])[],
  text: (id: string) => string,
  mode: InputMode,
  undoFirst: boolean,
): Promise<void> {
  const panel = panelSlot(page);
  const first = pairs[0];
  const second = pairs[1];
  if (undoFirst && first?.[0] !== undefined && second?.[1] !== undefined) {
    await tie(page, text(first[0]), text(second[1]), mode);
    await press(page, panel.getByRole('button', { name: /^Undo:/ }).first(), mode);
    await expect(panel.getByRole('button', { name: new RegExp(`^${rx(text(first[0]))}, not tied`) })).toBeVisible();
    await expect(panel.getByRole('button', { name: new RegExp(`^${rx(text(second[1]))}, not tied`) })).toBeVisible();
  }
  for (const [left, right] of pairs) {
    if (left !== undefined && right !== undefined) await tie(page, text(left), text(right), mode);
  }
}

/** Chooses a radio: arrow keys on the keyboard, a tap or click otherwise. Used by the cursed object. */
export async function chooseOption(page: Page, optionId: string, mode: InputMode): Promise<void> {
  const panel = panelSlot(page);
  const target = panel.locator(`input[type="radio"][value="${optionId}"]`);
  if (mode === 'keyboard') {
    const radios = panel.locator('input[type="radio"]:not([disabled])');
    await tabTo(page, radios);
    const count = await radios.count();
    for (let i = 0; i <= count && !(await target.isChecked()); i += 1) await page.keyboard.press('ArrowDown');
  } else if (mode === 'tap') await target.tap();
  else await target.click();
  await expect(target).toBeChecked();
}

/** The place names of a number's digits, left to right: 443 reads hundreds, tens, ones. */
function digitsOf(value: number, wheelCount: number): { place: string; digit: number }[] {
  const text = String(value).padStart(wheelCount, '0');
  return Array.from(text, (ch, i) => ({ place: PLACES[text.length - 1 - i] ?? 'ones', digit: Number(ch) }));
}
/** Sets a whole number on the Wheels: ArrowUp on each wheel by keyboard, the Increase button otherwise. */
export async function setWheels(page: Page, value: number, mode: InputMode): Promise<void> {
  const panel = panelSlot(page);
  const wheels = await panel.getByRole('spinbutton').count();
  for (const { place, digit } of digitsOf(value, wheels)) {
    if (mode === 'keyboard') {
      const spin = panel.getByRole('spinbutton', { name: new RegExp(`^${place} wheel`) });
      await tabTo(page, spin);
      for (let i = 0; i < digit; i += 1) await page.keyboard.press('ArrowUp');
    } else {
      const increase = panel.getByRole('button', { name: new RegExp(`^Increase ${place} wheel`) });
      for (let i = 0; i < digit; i += 1) {
        if (mode === 'tap') await increase.tap();
        else await increase.click();
      }
    }
  }
}
export function typedEntry(page: Page) {
  return panelSlot(page).getByLabel(LOCK_PANEL_LABELS.typedEntryLabel);
}
/** Types a number in the typed entry. Typing is typing on a phone too, so the field is filled. */
export async function typeNumber(page: Page, value: number, mode: InputMode): Promise<void> {
  const entry = typedEntry(page);
  if (mode === 'keyboard') {
    await tabTo(page, entry);
    await page.keyboard.type(String(value));
  } else {
    await entry.fill(String(value));
  }
}
export async function expectWheelsRead(page: Page, value: number): Promise<void> {
  const panel = panelSlot(page);
  const wheels = await panel.getByRole('spinbutton').count();
  for (const { place, digit } of digitsOf(value, wheels)) {
    await expect(panel.getByRole('spinbutton', { name: new RegExp(`^${place} wheel`) })).toHaveAttribute('aria-valuenow', String(digit));
  }
}

/** Every control in the open panel is at least 44 by 44 CSS pixels. `atLeast` guards against a scan that finds nothing. */
export async function expectTouchTargets(page: Page, atLeast = 1): Promise<void> {
  const controls = panelSlot(page).locator('button:visible, input:visible, [role="spinbutton"]:visible');
  const count = await controls.count();
  expect(count).toBeGreaterThanOrEqual(atLeast);
  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    const box = await control.boundingBox();
    const name = (await control.getAttribute('aria-label')) ?? (await control.innerText().catch(() => '')) ?? '';
    expect(box, `control ${i} ${name}`).not.toBeNull();
    expect(box?.width ?? 0, `width of ${name}`).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0, `height of ${name}`).toBeGreaterThanOrEqual(44);
  }
}

/** The evidence shows the result, a citation, the matched excerpt and the explanation from the content. */
export async function expectEvidence(page: Page, question: Question, content: CryptContent): Promise<void> {
  const entry = content.questions[question.questionId];
  await expect(page.locator('.evidence-panel__result[data-result="correct"]')).toBeVisible();
  await expect(page.locator('.evidence-panel__citation').first()).toBeVisible();
  await expect(page.locator('.evidence-panel__excerpt blockquote').first()).not.toBeEmpty();
  await expect(page.locator('.evidence-panel__matched').first()).toHaveText(ROOM_PLAY_LABELS.excerptMatched);
  await expect(page.locator('.evidence-panel__explanation')).toHaveText(entry?.explanation ?? '');
}

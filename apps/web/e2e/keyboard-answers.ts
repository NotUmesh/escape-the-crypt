import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { LOCK_PANEL_LABELS, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { CryptContent, CryptManifest } from '@escape-the-crypt/core';

type QuestionSpec = CryptManifest['finalDoor']['slots'][number]['question'];

/** Keyboard-only answering for every lock type. The answer is read from the manifest payload: no AI provider is involved. */
const MAX_TABS = 120;

function isFocused(locator: Locator): Promise<boolean> {
  return locator.first().evaluate((el) => el === document.activeElement);
}
/** Moves focus to the target with Tab, then with Shift+Tab. Fails if neither reaches it. */
export async function tabTo(page: Page, target: Locator): Promise<void> {
  await expect(target.first()).toBeVisible();
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < MAX_TABS; i += 1) {
      if (await isFocused(target)) return;
      await page.keyboard.press(key);
    }
  }
  if (!(await isFocused(target))) throw new Error('target was not reached by keyboard');
}
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
const panelOf = (page: Page) => page.getByTestId('panel-slot');

/** Chooses a radio by arrow keys, then submits with Enter. Used by the séance board and the cursed object. */
async function chooseRadio(page: Page, optionId: string): Promise<void> {
  const panel = panelOf(page);
  const radios = panel.locator('input[type="radio"]:not([disabled])');
  const target = panel.locator(`input[type="radio"][value="${optionId}"]`);
  await tabTo(page, radios);
  const count = await radios.count();
  for (let i = 0; i <= count && !(await target.isChecked()); i += 1) await page.keyboard.press('ArrowDown');
  await expect(target).toBeChecked();
}
async function submit(page: Page): Promise<void> {
  await tabTo(page, panelOf(page).getByRole('button', { name: ROOM_PLAY_LABELS.submitAnswer, exact: true }));
  await page.keyboard.press('Enter');
}
async function orderBones(page: Page, keyOrder: readonly string[], text: (id: string) => string): Promise<void> {
  const panel = panelOf(page);
  for (const [target, id] of keyOrder.entries()) {
    const up = panel.getByRole('button', { name: new RegExp(`^Move up: ${escaped(text(id))}, position`) });
    await tabTo(page, up);
    for (let guard = 0; guard < keyOrder.length; guard += 1) {
      const label = (await up.getAttribute('aria-label')) ?? '';
      const position = Number(/position (\d+) of/.exec(label)?.[1] ?? target + 1);
      if (position - 1 <= target) break;
      await page.keyboard.press('Enter');
      await expect(up).not.toHaveAttribute('aria-label', label);
    }
  }
}
async function tieThreads(page: Page, pairs: readonly (readonly string[])[], text: (id: string) => string): Promise<void> {
  const panel = panelOf(page);
  for (const [left, right] of pairs) {
    if (left === undefined || right === undefined) continue;
    const l = panel.getByRole('button', { name: new RegExp(`^${escaped(text(left))}, (not tied|selected)`) });
    await tabTo(page, l);
    await page.keyboard.press('Enter');
    const r = panel.getByRole('button', { name: new RegExp(`^${escaped(text(right))}, not tied`) });
    await tabTo(page, r);
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('button', { name: new RegExp(`^${escaped(text(left))}, tied to`) })).toBeVisible();
  }
}

/** Answers the question in the open panel correctly, by keyboard only, and presses Submit. Does not press Continue. */
export async function answerByKeyboard(page: Page, question: QuestionSpec, content: CryptContent): Promise<void> {
  const panel = panelOf(page);
  const payload = question.payload;
  if (!isRecord(payload)) throw new Error(`payload unreadable: ${question.questionId}`);
  const options = content.questions[question.questionId]?.options ?? {};
  const text = (id: string): string => {
    const found = options[id];
    if (found === undefined) throw new Error(`item text missing: ${question.questionId} ${id}`);
    return found;
  };
  await expect(panel.locator(`.${question.lockType}-panel`)).toBeVisible();
  switch (question.lockType) {
    case 'rune-cipher':
      await tabTo(page, panel.getByLabel('Your answer'));
      await page.keyboard.type(String(payload['answer']));
      await submit(page);
      return;
    case 'seance-board':
      await chooseRadio(page, String(payload['keyOptionId']));
      await submit(page);
      return;
    case 'cursed-object':
      await chooseRadio(page, String(payload['oddOneOutId']));
      await submit(page);
      return;
    case 'combination-dial':
      await tabTo(page, panel.getByLabel(LOCK_PANEL_LABELS.typedEntryLabel));
      await page.keyboard.type(String(payload['exactValue']));
      await submit(page);
      return;
    case 'bone-ordering':
      await orderBones(page, strings(payload['keyOrder']), text);
      await submit(page);
      return;
    case 'bound-threads':
      await tieThreads(page, Array.isArray(payload['keyPairs']) ? (payload['keyPairs'] as string[][]) : [], text);
      await submit(page);
      return;
  }
}

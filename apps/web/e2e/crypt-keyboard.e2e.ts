import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { FINAL_DOOR_BUTTON_TEXT, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { CorrectAnswer } from './crypt-helpers';
import { buildSampleCrypt, correctAnswerFor, enterCrypt, roomOneSlots } from './crypt-helpers';

const MAX_TABS = 80;

async function isFocused(locator: Locator): Promise<boolean> {
  return locator.first().evaluate((el) => el === document.activeElement);
}

/** Moves focus to the target with Tab (or Shift+Tab). Fails if the target is not reached. */
async function tabTo(page: Page, target: Locator, key: 'Tab' | 'Shift+Tab' = 'Tab'): Promise<void> {
  await expect(target.first()).toBeVisible();
  for (let i = 0; i < MAX_TABS; i += 1) {
    if (await isFocused(target)) return;
    await page.keyboard.press(key);
  }
  if (!(await isFocused(target))) throw new Error(`target was not reached with ${key}`);
}

/** Types or chooses the answer with the keyboard (arrow keys for a séance), then submits with Enter. */
async function answerWithKeyboard(page: Page, answer: CorrectAnswer): Promise<void> {
  const panel = page.getByTestId('panel-slot');
  if (answer.kind === 'rune-cipher') {
    await tabTo(page, panel.getByLabel('Your answer'));
    await page.keyboard.type(answer.text);
  } else {
    const radios = panel.locator('input[type="radio"]:not([disabled])');
    const target = panel.locator(`input[type="radio"][value="${answer.optionId}"]`);
    await tabTo(page, radios);
    const count = await radios.count();
    for (let i = 0; i <= count && !(await target.isChecked()); i += 1) {
      await page.keyboard.press('ArrowDown');
    }
    await expect(target).toBeChecked();
  }
  await tabTo(page, panel.getByRole('button', { name: ROOM_PLAY_LABELS.submitAnswer }));
  await page.keyboard.press('Enter');
}

const panelSlot = (page: Page) => page.getByTestId('panel-slot');
const panelHeading = (page: Page) => panelSlot(page).getByRole('heading', { level: 3 });
const panelButton = (page: Page, name: string) => panelSlot(page).getByRole('button', { name, exact: true });

test('keyboard only: hint, skip and challenge, with focus moving into each panel and back', async ({ page }) => {
  const crypt = buildSampleCrypt();
  const [first, second] = roomOneSlots(crypt);
  if (first === undefined || second === undefined) throw new Error('room 1 needs two lock slots');
  // The challenge below swaps in the Alternate, so the second slot must have one.
  expect(second.alternateQuestion).not.toBeNull();
  await enterCrypt(page);

  const lockButton = (index: number) => page.locator('.room-screen__lock-button').nth(index);
  const hints = page.locator('.room-screen__hints');

  // Lock 1: Enter opens it and focus moves to the panel heading; Escape returns focus to the lock.
  await tabTo(page, lockButton(0));
  await page.keyboard.press('Enter');
  await expect(panelHeading(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panelSlot(page).locator('.question-panel')).toHaveCount(0);
  await expect(lockButton(0)).toBeFocused();

  // Space reopens it. Use a hint, answer, and read the evidence.
  await page.keyboard.press('Space');
  await expect(panelHeading(page)).toBeFocused();
  const hintsBefore = (await hints.innerText()).trim();
  await tabTo(page, panelButton(page, ROOM_PLAY_LABELS.hint));
  await page.keyboard.press('Enter');
  await expect(hints).not.toHaveText(hintsBefore);
  await answerWithKeyboard(page, correctAnswerFor(crypt, first.primaryQuestion));
  await expect(page.locator('.evidence-panel')).toBeFocused();
  await expect(page.locator('.evidence-panel__result[data-result="correct"]')).toBeVisible();
  await tabTo(page, panelButton(page, ROOM_PLAY_LABELS.continue));
  await page.keyboard.press('Space');
  await expect(panelSlot(page).locator('.evidence-panel')).toHaveCount(0);
  await expect(lockButton(0)).toBeFocused();
  await expect(lockButton(0)).toHaveAttribute('data-status', 'solved');

  // Lock 2: Challenge swaps in the Alternate, the panel stays open and focus returns to its heading.
  await tabTo(page, lockButton(1));
  await page.keyboard.press('Enter');
  await expect(panelHeading(page)).toBeFocused();
  const firstPrompt = (await panelSlot(page).locator('.question-panel').innerText()).trim();
  await tabTo(page, panelButton(page, ROOM_PLAY_LABELS.challenge));
  await page.keyboard.press('Enter');
  await expect(panelHeading(page)).toBeFocused();
  await expect(panelSlot(page).locator('.question-panel')).not.toHaveText(firstPrompt);

  // Skip the Alternate: the panel closes and focus returns to the lock.
  await tabTo(page, panelButton(page, ROOM_PLAY_LABELS.challenge));
  await tabTo(page, panelButton(page, ROOM_PLAY_LABELS.skip), 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(panelSlot(page).locator('.question-panel')).toHaveCount(0);
  await expect(lockButton(1)).toBeFocused();
  await expect(lockButton(1)).toHaveAttribute('data-status', 'settled');

  // The final door opens with the keyboard too, and a seal's panel takes focus.
  const door = page.getByRole('button', { name: FINAL_DOOR_BUTTON_TEXT, exact: true });
  await tabTo(page, door);
  await page.keyboard.press('Enter');
  const seal = page.locator('.final-door__seal-button').first();
  await tabTo(page, seal);
  await page.keyboard.press('Enter');
  await expect(panelHeading(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(seal).toBeFocused();
});

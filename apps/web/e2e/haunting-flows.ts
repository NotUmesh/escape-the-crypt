import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { buildSampleCrypt, correctAnswerFor, skipEndgameClip } from './crypt-helpers';
import type { CorrectAnswer } from './crypt-helpers';
import { button, enterDoor, press } from './sample-nav';
import type { InputMode } from './sample-nav';

// Flows shared by the haunting-polish specs. Answers are read from the manifest of the human-heart sample.
export const crypt = buildSampleCrypt();
const WRONG_RUNE = 'zzzxq';
export const continueButton = (page: Page) => page.getByRole('button', { name: ROOM_PLAY_LABELS.continue, exact: true });
export const liveRegion = (page: Page) => page.getByTestId('room-live-region');

/** The live region shows the sentence. It shows one queued message every 1.5 s, so a backlog can take a while. */
export async function expectAnnounced(page: Page, text: string, ms = 20000): Promise<void> {
  await expect(liveRegion(page)).toHaveText(text, { timeout: ms });
}

/** Every question's answer, by prompt, read from the manifest (primary, Alternate and final door). */
function answersByPrompt(): ReadonlyMap<string, CorrectAnswer> {
  const out = new Map<string, CorrectAnswer>();
  const questions = [
    ...crypt.manifest.rooms.flatMap((r) =>
      r.lockSlots.flatMap((s) => (s.alternateQuestion == null ? [s.primaryQuestion] : [s.primaryQuestion, s.alternateQuestion])),
    ),
    ...crypt.manifest.finalDoor.slots.map((s) => s.question),
  ];
  for (const q of questions) {
    const prompt = crypt.content.questions[q.questionId]?.prompt;
    if (prompt !== undefined) out.set(prompt, correctAnswerFor(crypt, q));
  }
  return out;
}
const ANSWERS = answersByPrompt();

/** Answers the question in the open panel, right or wrong. Does not press Continue. */
export async function answerOpenPanel(page: Page, correct: boolean): Promise<void> {
  const panel = page.getByTestId('panel-slot');
  const rune = panel.getByLabel('Your answer');
  const seance = panel.locator('.seance-board-panel');
  await expect(rune.or(seance)).toBeVisible();
  const isRune = (await rune.count()) > 0;
  const prompt = (await panel.locator(isRune ? '.rune-cipher-panel__prompt' : '.seance-board-panel__prompt').innerText()).trim();
  const answer = ANSWERS.get(prompt);
  if (answer === undefined) throw new Error('prompt not found in the manifest');
  if (answer.kind === 'rune-cipher') {
    await rune.fill(correct ? answer.text : WRONG_RUNE);
  } else {
    const options = panel.locator('input[type="radio"]:not([disabled])');
    for (let i = 0; i < (await options.count()); i += 1) {
      const option = options.nth(i);
      if (((await option.getAttribute('value')) === answer.optionId) === correct) {
        await option.check();
        break;
      }
    }
  }
  await panel.getByRole('button', { name: ROOM_PLAY_LABELS.submitAnswer }).click();
}
export async function openFirstLock(page: Page): Promise<void> {
  await page.locator('.room-screen__lock-button[data-status="open"]').first().click();
}

const OPEN_ROOM_CONTROLS = '.room-screen__lock-button[data-status="open"], .room-screen__return-button[data-status="open"]';
const SKIP = (page: Page) => page.getByTestId('panel-slot').getByRole('button', { name: ROOM_PLAY_LABELS.skip, exact: true });

async function skipOne(page: Page, opener: ReturnType<Page['locator']>, mode: InputMode): Promise<void> {
  await press(page, opener, mode);
  await press(page, SKIP(page), mode);
  await expect(page.getByTestId('panel-slot').locator('.question-panel')).toHaveCount(0);
}
/** Skips every lock and goes through every room, until the final door button is there. Does not enter the door. */
export async function skipRooms(page: Page, mode: InputMode): Promise<void> {
  for (let guard = 0; guard < 60; guard += 1) {
    const open = page.locator(OPEN_ROOM_CONTROLS);
    if ((await open.count()) > 0) {
      await skipOne(page, open.first(), mode);
      continue;
    }
    const next = button(page, ROOM_PLAY_LABELS.nextRoom);
    if ((await next.count()) > 0) {
      await press(page, next, mode);
      await page.locator('.room-screen__lock-button').first().waitFor();
      continue;
    }
    if ((await page.locator('.room-screen__door-button').count()) > 0) return;
    await page.waitForTimeout(100);
  }
  throw new Error('the rooms were not finished');
}
/** At the open final door, skips every seal, until the escape view shows. */
export async function skipSealsToEscape(page: Page, mode: InputMode): Promise<void> {
  for (let guard = 0; guard < 30 && (await page.locator('.final-door__seal-button').count()) > 0; guard += 1) {
    await skipOne(page, page.locator('.final-door__seal-button').first(), mode);
  }
  await expect(page.getByTestId('escape-view')).toBeVisible();
  await skipEndgameClip(page);
}
/** Enters the final door and skips every seal, until the escape view shows. */
export async function skipDoorToEscape(page: Page, mode: InputMode): Promise<void> {
  await enterDoor(page, mode);
  await skipSealsToEscape(page, mode);
}
/** From the escape view, opens the Autopsy. */
export async function openAutopsy(page: Page, mode: InputMode): Promise<void> {
  await press(page, button(page, ROOM_PLAY_LABELS.openAutopsy), mode);
  await page.getByTestId('autopsy-view').waitFor();
}

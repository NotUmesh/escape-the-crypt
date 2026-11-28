import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import {
  chooseOption,
  expectEvidence,
  expectTouchTargets,
  expectWheelsRead,
  orderBones,
  payloadOf,
  setWheels,
  submit,
  textOf,
  tieThreads,
  typeNumber,
  typedEntry,
} from './lock-actions';
import { buildSample, findTarget, modeFor, panelButton, panelSlot, press, questionOf, routeTo, startSample } from './sample-nav';
import type { InputMode } from './sample-nav';

// One test per newer lock type, on chromium, firefox and pixel. The desktop projects use the keyboard
// (Tab, Alt+Arrow, arrows, Enter); the phone project taps and checks every control is 44 by 44 px.
// All four types sit in the HTTPS sample: skipping reaches each one, and its answer is read from the manifest.
const SAMPLE = 'https';
const crypt = buildSample(SAMPLE);

async function open(page: Page, lockType: Parameters<typeof findTarget>[1], mode: InputMode) {
  const target = findTarget(crypt, lockType);
  const question = questionOf(target);
  await startSample(page, SAMPLE, mode);
  await routeTo(page, crypt, target, mode);
  await expect(panelSlot(page).locator(`.${lockType}-panel`)).toBeVisible();
  // Hint, Skip and Challenge, Submit, and the type's own controls.
  if (mode === 'tap') await expectTouchTargets(page, 5);
  return question;
}
async function finish(page: Page, question: ReturnType<typeof questionOf>, mode: InputMode): Promise<void> {
  await submit(page, mode);
  await expectEvidence(page, question, crypt.content);
  if (mode === 'tap') await expectTouchTargets(page);
  await press(page, panelButton(page, ROOM_PLAY_LABELS.continue), mode);
  await expect(page.locator('.evidence-panel')).toHaveCount(0);
}

test.describe('the four newer lock types', () => {
  test('bone ordering: Alt+Arrow or Move up puts the bones in order', async ({ page }, testInfo) => {
    const mode = modeFor(testInfo.project.name);
    const question = await open(page, 'bone-ordering', mode);
    const payload = payloadOf(question);
    await orderBones(page, payload['keyOrder'] as string[], textOf(crypt.content, question), mode);
    if (mode === 'tap') await expectTouchTargets(page);
    await finish(page, question, mode);
  });

  test('bound threads: select a left item, then a right one; undo a thread; tie every pair', async ({ page }, testInfo) => {
    const mode = modeFor(testInfo.project.name);
    const question = await open(page, 'bound-threads', mode);
    const payload = payloadOf(question);
    await tieThreads(page, payload['keyPairs'] as string[][], textOf(crypt.content, question), mode, true);
    if (mode === 'tap') await expectTouchTargets(page);
    await finish(page, question, mode);
  });

  test('combination dial: the Wheels set the number and the typed entry shows it', async ({ page }, testInfo) => {
    const mode = modeFor(testInfo.project.name);
    const question = await open(page, 'combination-dial', mode);
    const value = Number(payloadOf(question)['exactValue']);
    await setWheels(page, value, mode);
    await expect(typedEntry(page)).toHaveValue(String(value));
    if (mode === 'tap') await expectTouchTargets(page);
    await finish(page, question, mode);
  });

  test('combination dial: a typed number moves the Wheels', async ({ page }, testInfo) => {
    const mode = modeFor(testInfo.project.name);
    const question = await open(page, 'combination-dial', mode);
    const value = Number(payloadOf(question)['exactValue']);
    await typeNumber(page, value, mode);
    await expectWheelsRead(page, value);
    await finish(page, question, mode);
  });

  test('cursed object: choose the odd one out', async ({ page }, testInfo) => {
    const mode = modeFor(testInfo.project.name);
    const question = await open(page, 'cursed-object', mode);
    await chooseOption(page, String(payloadOf(question)['oddOneOutId']), mode);
    if (mode === 'tap') await expectTouchTargets(page);
    await finish(page, question, mode);
  });
});

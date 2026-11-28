import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  ENTER_CRYPT_LABEL,
  FINAL_DOOR_BUTTON_TEXT,
  FRONT_OF_HOUSE_COPY,
  ROOM_PLAY_LABELS,
  SAMPLE_CRYPT_LABEL,
  getSampleBuilder,
} from '@escape-the-crypt/core';
import type { CryptManifest, LockType, SampleCryptResult, SampleQuestionsFile } from '@escape-the-crypt/core';
import { SAMPLE_LIST } from '../src/features/desk/sample-list';
import { openLockName, skipEndgameClip } from './crypt-helpers';
import { tabTo } from './keyboard-answers';

// Shared navigation for the sample crypts: start one from the shelf, skip to any question by lock
// type, and press controls by keyboard, by tap or by click. The answers are read from the manifest.
const SAMPLES = fileURLToPath(new URL('../../../samples/', import.meta.url));

export type InputMode = 'keyboard' | 'tap' | 'click';
type LockSlot = CryptManifest['rooms'][number]['lockSlots'][number];
type DoorSlot = CryptManifest['finalDoor']['slots'][number];

/** Keyboard on the desktop projects, tap on the phone project. */
export function modeFor(projectName: string): InputMode {
  return projectName === 'pixel' ? 'tap' : 'keyboard';
}
export function buildSample(id: string): SampleCryptResult {
  const notes = readFileSync(`${SAMPLES}${id}.txt`, 'utf8');
  const file = JSON.parse(readFileSync(`${SAMPLES}questions/${id}.json`, 'utf8')) as SampleQuestionsFile;
  const builder = getSampleBuilder(id);
  if (!builder.ok) throw new Error(`no builder for ${id}`);
  const built = builder.value(notes, file);
  if (!built.ok) throw new Error(`${id} failed: ${built.error.kind}`);
  return built.value;
}
export const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
export const panelSlot = (page: Page) => page.getByTestId('panel-slot');
export const panelButton = (page: Page, name: string) => panelSlot(page).getByRole('button', { name, exact: true });

/** Presses a control the way the mode says: Tab then Enter, a tap, or a click. */
export async function press(page: Page, target: Locator, mode: InputMode): Promise<void> {
  if (mode === 'keyboard') {
    await tabTo(page, target);
    await page.keyboard.press('Enter');
  } else if (mode === 'tap') {
    await target.tap();
  } else {
    await target.click();
  }
}

/** From the shelf to a playing room: choose the sample, get past the descent. */
export async function startSample(page: Page, id: string, mode: InputMode): Promise<void> {
  const title = SAMPLE_LIST.find((entry) => entry.id === id)?.title ?? id;
  await page.goto('/');
  await press(page, button(page, FRONT_OF_HOUSE_COPY.hub.samplesTitle), mode);
  await press(page, button(page, `${ENTER_CRYPT_LABEL}: ${title} ${SAMPLE_CRYPT_LABEL}`), mode);
  await page.locator('.room-screen, [data-testid="descent-gate"]').first().waitFor();
  const skip = button(page, FRONT_OF_HOUSE_COPY.descent.skip);
  if ((await skip.count()) > 0) await press(page, skip, mode);
  await expect(page.getByTestId('descent-gate')).toHaveCount(0);
  await page.locator('.room-screen__lock-button').first().waitFor();
}

async function closed(page: Page): Promise<void> {
  await expect(panelSlot(page).locator('.question-panel')).toHaveCount(0);
}
/** Opens a lock and skips it. The panel closes and the lock is settled. */
export async function skipLock(page: Page, slot: LockSlot, mode: InputMode): Promise<void> {
  await press(page, button(page, openLockName(slot.stationType)), mode);
  await press(page, panelButton(page, ROOM_PLAY_LABELS.skip), mode);
  await closed(page);
}
export async function nextRoom(page: Page, mode: InputMode): Promise<void> {
  await press(page, button(page, ROOM_PLAY_LABELS.nextRoom), mode);
}
export async function enterDoor(page: Page, mode: InputMode): Promise<void> {
  await press(page, button(page, FINAL_DOOR_BUTTON_TEXT), mode);
  await skipEndgameClip(page);
  await page.locator('.final-door__seal-button').first().waitFor();
}
export async function skipFirstSeal(page: Page, mode: InputMode): Promise<void> {
  await press(page, page.locator('.final-door__seal-button').first(), mode);
  await press(page, panelButton(page, ROOM_PLAY_LABELS.skip), mode);
  await closed(page);
}

export type Target =
  | { readonly kind: 'lock'; readonly roomIndex: number; readonly slotIndex: number; readonly slot: LockSlot }
  | { readonly kind: 'door'; readonly index: number; readonly slot: DoorSlot };

/** The first slot primary or final-door question of a lock type, in play order. */
export function findTarget(crypt: SampleCryptResult, lockType: LockType): Target {
  for (const [roomIndex, room] of crypt.manifest.rooms.entries()) {
    for (const [slotIndex, slot] of room.lockSlots.entries()) {
      if (slot.primaryQuestion.lockType === lockType) return { kind: 'lock', roomIndex, slotIndex, slot };
    }
  }
  for (const [index, slot] of crypt.manifest.finalDoor.slots.entries()) {
    if (slot.question.lockType === lockType) return { kind: 'door', index, slot };
  }
  throw new Error(`no ${lockType} question in this sample`);
}
export function questionOf(target: Target) {
  return target.kind === 'lock' ? target.slot.primaryQuestion : target.slot.question;
}

/** Skips everything before the target, then opens the target's panel. */
export async function routeTo(page: Page, crypt: SampleCryptResult, target: Target, mode: InputMode): Promise<void> {
  const rooms = crypt.manifest.rooms;
  for (const [roomIndex, room] of rooms.entries()) {
    if (target.kind === 'lock' && roomIndex === target.roomIndex) {
      for (const slot of room.lockSlots.slice(0, target.slotIndex)) await skipLock(page, slot, mode);
      await press(page, button(page, openLockName(target.slot.stationType)), mode);
      return;
    }
    for (const slot of room.lockSlots) await skipLock(page, slot, mode);
    if (roomIndex < rooms.length - 1) await nextRoom(page, mode);
  }
  await enterDoor(page, mode);
  if (target.kind !== 'door') throw new Error('target room not found');
  for (let i = 0; i < target.index; i += 1) await skipFirstSeal(page, mode);
  await press(page, page.locator('.final-door__seal-button').first(), mode);
}

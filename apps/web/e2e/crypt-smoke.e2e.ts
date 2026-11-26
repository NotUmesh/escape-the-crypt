import { expect, test } from '@playwright/test';
import { SAMPLE_CRYPT_LABEL, roomDisplayName } from '@escape-the-crypt/core';
import { buildSampleCrypt, correctAnswerFor, enterCrypt, openLockName, roomOneSlots } from './crypt-helpers';

test('helpers enter the crypt and show room 1 with its locks', async ({ page }) => {
  const crypt = buildSampleCrypt();
  const slots = roomOneSlots(crypt);
  expect(slots.length).toBeGreaterThan(0);

  await enterCrypt(page);

  await expect(page.getByRole('heading', { name: roomDisplayName(0) })).toBeVisible();
  await expect(page.locator('.room-screen__sample-label')).toHaveText(SAMPLE_CRYPT_LABEL);
  for (const slot of slots) {
    await expect(page.getByRole('button', { name: openLockName(slot.stationType), exact: true })).toBeVisible();
    // The answer is readable from the manifest without any provider.
    expect(correctAnswerFor(crypt, slot.primaryQuestion).kind).toBe(slot.stationType);
  }
});

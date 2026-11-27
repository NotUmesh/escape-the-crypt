import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENTER_CRYPT_LABEL,
  GENERATION_COPY,
  ROOM_PLAY_LABELS,
  RUN_SETUP_COPY,
  lengthAvailabilityForNotes,
} from '@escape-the-crypt/core';
import { fakeWorker } from '../../test-support/fake-worker-client';
import type { FakeWorker } from '../../test-support/fake-worker-client';
import { clickButton, useMount } from '../../test-support/flow-dom';
import { SAMPLE_BUNDLE, SAMPLE_NOTES_TEXT } from '../../test-support/sample-bundle';
import { failedSceneLoader } from '../../test-support/scene-fixtures';
import { CryptFlow } from './crypt-flow';

const SHORT_NOTES = 'The heart pumps blood around the body through a network of vessels called arteries and veins.';

function flow(worker: FakeWorker, notesText: string = SAMPLE_NOTES_TEXT): ReactNode {
  return createElement(CryptFlow, {
    loadSceneImpl: failedSceneLoader,
    notesText,
    generate: { origin: 'http://localhost:8787', client: worker.client, intervalMs: 2000 },
  });
}
async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function radioByLabel(root: ParentNode, label: string): HTMLInputElement {
  const row = Array.from(root.querySelectorAll('label.run-settings__option')).find(
    (l) => l.querySelector('.run-settings__label')?.textContent === label,
  );
  const input = row?.querySelector<HTMLInputElement>('input[type="radio"]');
  if (input == null) throw new Error(`no option ${label}`);
  return input;
}
function choose(root: ParentNode, label: string): void {
  act(() => radioByLabel(root, label).click());
}
const legends = (root: ParentNode): string[] => Array.from(root.querySelectorAll('legend')).map((l) => l.textContent ?? '');

describe('the length and difficulty choice on the start view', () => {
  const mount = useMount();
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sits before the buttons, with Short and Apprentice chosen', () => {
    mount.render(flow(fakeWorker([{ kind: 'running' }])));
    const section = mount.container.querySelector('.crypt-start') as HTMLElement;
    expect(legends(section)).toEqual([RUN_SETUP_COPY.lengthLegend, RUN_SETUP_COPY.difficultyLegend]);
    expect(radioByLabel(section, 'Short').checked).toBe(true);
    expect(radioByLabel(section, 'Apprentice').checked).toBe(true);
    const all = Array.from(section.querySelectorAll('*'));
    const settings = all.indexOf(section.querySelector('[data-testid="run-settings"]') as Element);
    const firstButton = all.indexOf(section.querySelector('button') as Element);
    expect(settings).toBeLessThan(firstButton);
  });

  it('sends the chosen length and starts the run with the chosen difficulty', async () => {
    expect(lengthAvailabilityForNotes(SAMPLE_NOTES_TEXT).enabled.long).toBe(true);
    const worker = fakeWorker([{ kind: 'completed', bundle: SAMPLE_BUNDLE }]);
    mount.render(flow(worker));
    choose(mount.container, 'Long');
    choose(mount.container, 'Lich');
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    expect(worker.startLengths).toEqual(['long']);
    await tick(2000);
    await vi.waitFor(() => expect(mount.container.querySelector('.room-screen')).not.toBeNull());
    // Lich: no hints, so no hint count.
    expect(mount.container.querySelector('.room-screen__hints')).toBeNull();
    // The sample bundle has one room: the Long crypt is honestly shortened.
    expect(mount.container.querySelector('[data-testid="crypt-shortened"]')?.textContent).toBe(
      ROOM_PLAY_LABELS.cryptShortened(1, 4),
    );
  });

  it('hides the choice while the job runs', async () => {
    mount.render(flow(fakeWorker([{ kind: 'running' }])));
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    expect(mount.container.querySelector('[data-testid="run-settings"]')).toBeNull();
  });

  it('switches off lengths short notes cannot fill, and sends Short', async () => {
    const worker = fakeWorker([{ kind: 'running' }]);
    mount.render(flow(worker, SHORT_NOTES));
    expect(radioByLabel(mount.container, 'Standard').disabled).toBe(true);
    expect(radioByLabel(mount.container, 'Long').disabled).toBe(true);
    expect(mount.container.textContent).toContain(RUN_SETUP_COPY.onlyShort);
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    expect(worker.startLengths).toEqual(['short']);
  });

  it('gives the sample crypt the chosen difficulty and its own fixed size', async () => {
    mount.render(flow(fakeWorker([{ kind: 'running' }])));
    choose(mount.container, 'Gravedigger');
    await clickButton(mount.container, ENTER_CRYPT_LABEL);
    expect(mount.container.querySelector('.room-screen__hints')?.textContent).toBe(ROOM_PLAY_LABELS.hintsLeft(2));
    expect(mount.container.querySelector('[data-testid="crypt-shortened"]')).toBeNull();
  });

  it('offers only the difficulty when there is nothing to generate', () => {
    mount.render(createElement(CryptFlow, { loadSceneImpl: failedSceneLoader }));
    expect(legends(mount.container)).toEqual([RUN_SETUP_COPY.difficultyLegend]);
  });
});

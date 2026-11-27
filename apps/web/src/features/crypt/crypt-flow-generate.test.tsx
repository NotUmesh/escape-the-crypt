import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENTER_CRYPT_LABEL,
  GENERATION_COPY,
  REVIEW_PASSED_LABEL,
  SAMPLE_CRYPT_LABEL,
} from '@escape-the-crypt/core';
import type { GenerationFailureKind } from '@escape-the-crypt/core';
import { fakeWorker } from '../../test-support/fake-worker-client';
import type { FakeWorker } from '../../test-support/fake-worker-client';
import { buttonByText, clickButton, useMount } from '../../test-support/flow-dom';
import { SAMPLE_BUNDLE, SAMPLE_NOTES_TEXT } from '../../test-support/sample-bundle';
import { failedSceneLoader } from '../../test-support/scene-fixtures';
import type { GenerateSeams } from '../generate/generate-seams';
import { CryptFlow } from './crypt-flow';

function flow(worker: FakeWorker, seams: GenerateSeams = {}): ReactNode {
  return createElement(CryptFlow, {
    loadSceneImpl: failedSceneLoader,
    notesText: SAMPLE_NOTES_TEXT,
    generate: { origin: 'http://localhost:8787', client: worker.client, intervalMs: 2000, ...seams },
  });
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const buttonNames = (root: ParentNode): string[] =>
  Array.from(root.querySelectorAll('button')).map((b) => b.textContent ?? '');
const hasButton = (root: ParentNode, name: string): boolean => buttonNames(root).includes(name);
const liveRegions = (root: ParentNode): number => root.querySelectorAll('[aria-live], [role="status"]').length;

describe('Generate from my notes', () => {
  const mount = useMount();
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is hidden when no worker origin is set', () => {
    mount.render(flow(fakeWorker([{ kind: 'running' }]), { origin: null }));
    expect(hasButton(mount.container, ENTER_CRYPT_LABEL)).toBe(true);
    expect(hasButton(mount.container, GENERATION_COPY.generateButton)).toBe(false);
  });

  it('is hidden when there is no confirmed notes text', () => {
    mount.render(
      createElement(CryptFlow, {
        loadSceneImpl: failedSceneLoader,
        generate: { origin: 'http://localhost:8787', client: fakeWorker([]).client },
      }),
    );
    expect(hasButton(mount.container, GENERATION_COPY.generateButton)).toBe(false);
  });

  it('sits beside "Enter the crypt" with one Enter button', () => {
    mount.render(flow(fakeWorker([{ kind: 'running' }])));
    const section = mount.container.querySelector('.crypt-start');
    expect(section).not.toBeNull();
    expect(buttonNames(section as ParentNode)).toEqual([ENTER_CRYPT_LABEL, GENERATION_COPY.generateButton]);
  });

  it('shows progress as plain text with Cancel, moves focus to it, and mounts no live region of its own', async () => {
    const worker = fakeWorker([{ kind: 'running' }]);
    mount.render(flow(worker));
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    const status = mount.container.querySelector('[data-testid="generation-progress"] p');
    expect(status?.textContent).toBe(GENERATION_COPY.progress);
    expect(document.activeElement).toBe(status);
    expect(liveRegions(mount.container)).toBe(0);
    expect(buttonNames(mount.container)).toEqual([GENERATION_COPY.cancel]);
    expect(worker.startTexts).toEqual([SAMPLE_NOTES_TEXT]);
  });

  it('Cancel shows the stopped message, both buttons again, and sends nothing more', async () => {
    const worker = fakeWorker([{ kind: 'running' }]);
    mount.render(flow(worker));
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    await tick(2000);
    expect(worker.polls).toHaveLength(1);
    await clickButton(mount.container, GENERATION_COPY.cancel);
    const stopped = mount.container.querySelector('[data-testid="generation-cancelled"]');
    expect(stopped?.textContent).toBe(GENERATION_COPY.cancelled);
    expect(document.activeElement).toBe(stopped);
    expect(buttonNames(mount.container)).toEqual([ENTER_CRYPT_LABEL, GENERATION_COPY.generateButton]);
    await tick(30_000);
    expect(worker.polls).toHaveLength(1);
    expect(worker.startKeys).toHaveLength(1);
  });

  it('a new press after Cancel uses a new key', async () => {
    let n = 0;
    const worker = fakeWorker([{ kind: 'running' }]);
    mount.render(flow(worker, { newKey: () => `k${(n += 1)}` }));
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    await clickButton(mount.container, GENERATION_COPY.cancel);
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    expect(worker.startKeys).toEqual(['k1', 'k2']);
  });

  const failures: readonly (readonly [string, GenerationFailureKind, Parameters<typeof fakeWorker>])[] = [
    ['failed: expired', 'expired', [[{ kind: 'failed', failure: 'expired' }]]],
    ['failed: budget-exhausted', 'budget-exhausted', [[{ kind: 'failed', failure: 'budget-exhausted' }]]],
    ['failed: not-enough-material', 'not-enough-material', [[{ kind: 'failed', failure: 'not-enough-material' }]]],
    ['failed: generation-failed', 'generation-failed', [[{ kind: 'failed', failure: 'generation-failed' }]]],
    ['expired job', 'expired', [[{ kind: 'expired' }]]],
    ['network error on poll', 'generation-failed', [[{ kind: 'network' }]]],
    ['timeout on poll', 'generation-failed', [[{ kind: 'timeout' }]]],
    ['not-found on poll', 'generation-failed', [[{ kind: 'not-found' }]]],
    ['rejected on poll', 'generation-failed', [[{ kind: 'rejected', status: 403 }]]],
    ['invalid response on poll', 'generation-failed', [[{ kind: 'invalid-response', reason: 'schema' }]]],
    ['rejected start', 'generation-failed', [[{ kind: 'running' }], [{ kind: 'rejected', status: 400 }]]],
    ['bundle with unknown chunk ids', 'generation-failed', [[{ kind: 'completed', bundle: SAMPLE_BUNDLE }]]],
  ];

  it.each(failures)('%s shows what and next with the sample offer', async (name, kind, [polls, starts]) => {
    const worker = fakeWorker(polls, starts);
    // The last case sends different notes than the bundle was built from.
    mount.render(
      createElement(CryptFlow, {
        loadSceneImpl: failedSceneLoader,
        notesText: name.startsWith('bundle') ? 'Other notes.\n\nSecond paragraph of other notes.' : SAMPLE_NOTES_TEXT,
        generate: { origin: 'http://localhost:8787', client: worker.client, intervalMs: 2000 },
      }),
    );
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    // Network and timeout poll errors are tolerated three times in a row, so the fourth poll fails.
    await tick(2000 * 4);
    const copy = GENERATION_COPY.failures[kind];
    const failure = mount.container.querySelector('[data-testid="generation-failed"]');
    expect(failure?.querySelector('h3')?.textContent).toBe(copy.what);
    expect(failure?.querySelector('p')?.textContent).toBe(copy.next);
    expect(document.activeElement).toBe(failure?.querySelector('h3'));
    expect(hasButton(mount.container, GENERATION_COPY.sampleOffer)).toBe(true);
    expect(hasButton(mount.container, GENERATION_COPY.generateButton)).toBe(true);
    expect(liveRegions(mount.container)).toBe(1);
  });

  it('the sample offer starts the sample crypt', async () => {
    mount.render(flow(fakeWorker([{ kind: 'failed', failure: 'budget-exhausted' }])));
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    await tick(2000);
    await clickButton(mount.container, GENERATION_COPY.sampleOffer);
    expect(mount.container.querySelector('.room-screen')).not.toBeNull();
    expect(mount.container.textContent).toContain(SAMPLE_CRYPT_LABEL);
    expect(mount.container.textContent).not.toContain(REVIEW_PASSED_LABEL);
  });

  it('a finished job starts room 1 of the generated crypt', async () => {
    mount.render(flow(fakeWorker([{ kind: 'running' }, { kind: 'completed', bundle: SAMPLE_BUNDLE }])));
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    await tick(2000);
    expect(mount.container.querySelector('.room-screen')).toBeNull();
    await tick(2000);
    expect(mount.container.querySelector('.room-screen')).not.toBeNull();
    expect(mount.container.textContent).not.toContain(SAMPLE_CRYPT_LABEL);
    const opener = mount.container.querySelector<HTMLButtonElement>('.room-screen__lock-button');
    if (opener === null) throw new Error('no lock button');
    await act(async () => opener.click());
    expect(mount.container.textContent).toContain(REVIEW_PASSED_LABEL);
    // Enter and Generate are gone once the run has started.
    expect(hasButton(mount.container, GENERATION_COPY.generateButton)).toBe(false);
    expect(buttonByText(mount.container, 'Skip')).not.toBeNull();
  });
});

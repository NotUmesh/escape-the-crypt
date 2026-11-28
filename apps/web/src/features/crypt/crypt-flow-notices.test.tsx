import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERATION_COPY, chunkDocument, conflictLeftOut } from '@escape-the-crypt/core';
import { fakeWorker } from '../../test-support/fake-worker-client';
import { clickButton, useMount } from '../../test-support/flow-dom';
import { SAMPLE_BUNDLE, SAMPLE_NOTES_TEXT } from '../../test-support/sample-bundle';
import { failedSceneLoader } from '../../test-support/scene-fixtures';
import type { WorkerNotices } from '../generate/generated-notices';
import { CryptFlow } from './crypt-flow';

// A finished job that left a topic out: the passages are real chunks of the notes that were sent.
const CHUNKS = chunkDocument({ sourceType: 'paste', text: SAMPLE_NOTES_TEXT, originalText: SAMPLE_NOTES_TEXT });
const [A, B] = [CHUNKS[1], CHUNKS[2]];
if (A === undefined || B === undefined) throw new Error('the sample notes need three chunks');
const firstWords = (text: string): string => text.split(/\s+/).slice(0, 8).join(' ');
const NOTICES: WorkerNotices = {
  excluded: [
    {
      conceptId: 'c-left-out',
      conceptTitle: 'The valves',
      source: 'model',
      passages: [
        { chunkId: A.id, quote: firstWords(A.text) },
        { chunkId: B.id, quote: firstWords(B.text) },
      ],
    },
  ],
  sufficiency: null,
};

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('a generated crypt that left a topic out', () => {
  const mount = useMount();
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function generate(notices: WorkerNotices | undefined): Promise<void> {
    const worker = fakeWorker([{ kind: 'completed', bundle: SAMPLE_BUNDLE, ...(notices === undefined ? {} : { notices }) }]);
    mount.render(
      createElement(CryptFlow, {
        loadSceneImpl: failedSceneLoader,
        notesText: SAMPLE_NOTES_TEXT,
        generate: { origin: 'http://localhost:8787', client: worker.client, intervalMs: 2000 },
      }),
    );
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    await tick(2000);
  }
  const notice = (): Element | null => mount.container.querySelector('[data-testid="conflict-notice"]');

  it('shows one notice above the room, with both passages behind the disclosure', async () => {
    await generate(NOTICES);
    expect(mount.container.querySelector('.room-screen')).not.toBeNull();
    expect(notice()?.textContent).toContain(conflictLeftOut('The valves'));
    const quotes = Array.from(notice()?.querySelectorAll('blockquote') ?? []).map((q) => q.textContent);
    expect(quotes).toEqual([firstWords(A.text), firstWords(B.text)]);
    expect(mount.container.querySelectorAll('[data-testid="conflict-notice"]')).toHaveLength(1);
  });

  it('reads the notice once through the one live region', async () => {
    await generate(NOTICES);
    await tick(100);
    // The notice is read by the crypt's live region and by nothing else (the export control's own
    // region is empty here, and the notice itself has none).
    const regions = Array.from(mount.container.querySelectorAll('[aria-live], [role="status"]'));
    expect(regions.filter((region) => (region.textContent ?? '').includes(conflictLeftOut('The valves')))).toHaveLength(1);
    expect(notice()?.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });

  it('shows no notice when the worker sent none', async () => {
    await generate(undefined);
    expect(mount.container.querySelector('.room-screen')).not.toBeNull();
    expect(notice()).toBeNull();
  });

  it('shows the topic but no passages when a passage is not in the learner\'s notes', async () => {
    const [first, second] = NOTICES.excluded[0]?.passages ?? [];
    if (first === undefined || second === undefined) throw new Error('fixture');
    await generate({ ...NOTICES, excluded: [{ ...(NOTICES.excluded[0] as WorkerNotices['excluded'][number]), passages: [first, { ...second, chunkId: 'chk_not_yours_9' }] }] });
    expect(notice()?.textContent).toContain(conflictLeftOut('The valves'));
    expect(notice()?.querySelector('details')).toBeNull();
  });
});

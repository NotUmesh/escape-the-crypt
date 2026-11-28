import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERATION_COPY } from '@escape-the-crypt/core';
import type { GenerationState } from '../generate/generation-flow';
import { useMount } from '../../test-support/flow-dom';
import { DigScreen } from './dig-screen';
import type { DigScreenProps } from './dig-screen';

const POLLING: GenerationState = { status: 'polling', key: 'k', jobId: 'job-1' };
const NOTES = { pieces: 6, words: 412 };

describe('DigScreen', () => {
  const mount = useMount();
  let time = 0;
  const announce = vi.fn<(message: string) => void>();

  beforeEach(() => {
    vi.useFakeTimers();
    time = 5_000_000;
    announce.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  function render(extra: Partial<DigScreenProps> = {}): void {
    mount.render(<DigScreen state={POLLING} onCancel={() => undefined} notes={NOTES} announce={announce} now={() => time} {...extra} />);
  }
  const tick = (ms: number): void => {
    time += ms;
    act(() => vi.advanceTimersByTime(ms));
  };
  const q = (id: string): HTMLElement | null => mount.container.querySelector(`[data-testid="${id}"]`);

  it('has one h1, the existing progress sentence and a Cancel button', () => {
    const onCancel = vi.fn();
    render({ onCancel });
    expect(mount.container.querySelectorAll('h1')).toHaveLength(1);
    expect(mount.container.querySelector('h1')?.textContent).toBe('Digging your crypt');
    expect(q('generation-progress')?.textContent).toContain(GENERATION_COPY.progress);
    const cancel = Array.from(mount.container.querySelectorAll('button')).find((b) => b.textContent === GENERATION_COPY.cancel);
    expect(cancel).toBeDefined();
    act(() => cancel?.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the progress sentence when it appears, as before', () => {
    render();
    expect(document.activeElement?.textContent).toBe(GENERATION_COPY.progress);
  });

  it('shows the real elapsed time and counts it with the clock', () => {
    render();
    expect(q('dig-elapsed')?.textContent).toBe('0:00');
    tick(42_000);
    expect(q('dig-elapsed')?.textContent).toBe('0:42');
    tick(23_000);
    expect(q('dig-elapsed')?.textContent).toBe('1:05');
    expect(q('dig-elapsed')?.getAttribute('role')).toBe('timer');
  });

  it('shows the size of the notes that were sent', () => {
    render();
    expect(q('dig-notes')?.textContent).toBe('Your notes 6 pieces · 412 words');
  });

  it('shows no stage list, bar or percentage until the job reports stages', () => {
    render();
    expect(q('dig-stages')).toBeNull();
    expect(mount.container.querySelector('[role="progressbar"], progress, meter')).toBeNull();
    expect(mount.container.textContent).not.toMatch(/%/);
  });

  it('shows the stages with real counts when the job reports them', () => {
    render({
      stages: [
        { id: 'finding-concepts', status: 'done', done: 5, total: 5 },
        { id: 'writing-questions', status: 'active', done: 6, total: 9 },
        { id: 'checking', status: 'waiting' },
        { id: 'building-rooms', status: 'waiting' },
      ],
    });
    const items = Array.from(mount.container.querySelectorAll('.dig-stage')).map((li) => li.textContent);
    expect(items).toEqual([
      'Finding conceptsDone, 5 of 5',
      'Writing questionsIn progress, 6 of 9',
      'Checking against your notesWaiting',
      'Building roomsWaiting',
    ]);
    expect(mount.container.querySelector('ol')?.getAttribute('aria-label')).toBe('Where your crypt is');
    expect(mount.container.querySelector('[role="progressbar"], progress, meter')).toBeNull();
  });

  it('announces the progress sentence once, a stage when it changes, and each full minute', () => {
    render({ stages: [{ id: 'finding-concepts', status: 'active' }] });
    expect(announce.mock.calls.map((c) => c[0])).toEqual([GENERATION_COPY.progress, 'Finding concepts.']);
    render({ stages: [{ id: 'finding-concepts', status: 'active', done: 2, total: 5 }] });
    expect(announce).toHaveBeenCalledTimes(2);
    render({ stages: [{ id: 'writing-questions', status: 'active', done: 1, total: 9 }] });
    expect(announce).toHaveBeenLastCalledWith('Writing questions, 1 of 9.');
    tick(60_000);
    expect(announce).toHaveBeenLastCalledWith('Still working. 1 minute so far.');
    tick(60_000);
    expect(announce).toHaveBeenLastCalledWith('Still working. 2 minutes so far.');
  });

  it('does not announce the seconds', () => {
    render();
    announce.mockClear();
    tick(30_000);
    expect(announce).not.toHaveBeenCalled();
  });

  it('owns no live region, and the cavern is hidden decoration', () => {
    render();
    expect(mount.container.querySelectorAll('[aria-live], [role="status"], [role="alert"]')).toHaveLength(0);
    expect(q('cavern')?.getAttribute('aria-hidden')).toBe('true');
    expect(q('cavern')?.closest('main')).toBeNull();
  });

  it('keeps all text inside the one solid panel', () => {
    render();
    const main = mount.container.querySelector('main') as HTMLElement;
    const panel = main.querySelector('.fh-panel') as HTMLElement;
    const outside = Array.from(main.querySelectorAll('h1, p, span, li, button')).filter((el) => !panel.contains(el));
    expect(outside).toEqual([]);
  });

  it('stops counting and stays quiet once the job is no longer running', () => {
    render();
    tick(5000);
    render({ state: { status: 'cancelled' } });
    announce.mockClear();
    tick(120_000);
    expect(announce).not.toHaveBeenCalled();
    expect(q('dig-elapsed')?.textContent).toBe('0:05');
  });
});

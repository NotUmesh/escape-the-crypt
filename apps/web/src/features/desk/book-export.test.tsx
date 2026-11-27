import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { RestoreDeps, RestoredRun } from '../../state/storage/restore-run';
import { useMount } from '../../test-support/flow-dom';
import { EXPORT_BUTTON_LABEL, EXPORT_DONE_TEXT, EXPORT_FAILED_TEXT, EXPORT_NO_NOTES_TEXT } from '../start/export-control';
import type { ExportOutcome } from '../start/export-support';
import { BookExport } from './book-export';

const DEPS = { factory: undefined, notesStore: { save: vi.fn(), load: vi.fn() } } as unknown as RestoreDeps;
const RESTORED = { model: { state: { marker: 'state' } }, assets: { marker: 'assets' }, events: [{ marker: 'event' }] } as unknown as RestoredRun;
const flush = (): Promise<void> => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

function setup(overrides: Partial<React.ComponentProps<typeof BookExport>> = {}) {
  const onStatus = vi.fn();
  const download = vi.fn();
  const restore = vi.fn().mockResolvedValue({ ok: true, value: RESTORED });
  const prepare = vi.fn<(input: unknown) => Promise<ExportOutcome>>().mockResolvedValue({ ok: true, json: '{}', withNotes: true });
  const element = <BookExport runId="run-9" deps={DEPS} onStatus={onStatus} restore={restore} prepare={prepare} download={download} {...overrides} />;
  return { element, onStatus, download, restore, prepare };
}

describe('BookExport', () => {
  const mount = useMount();
  const button = (): HTMLButtonElement => mount.container.querySelector('button') as HTMLButtonElement;
  const status = (): string => mount.container.querySelector('[data-testid="book-export-status"]')?.textContent ?? '';

  it('shows the label that says the file holds the notes, and no live region', () => {
    mount.render(setup().element);
    expect(button().textContent).toBe(EXPORT_BUTTON_LABEL);
    expect(button().textContent).toContain('this file contains your notes');
    expect(mount.container.querySelectorAll('[aria-live], [role="status"]')).toHaveLength(0);
  });

  it('restores the run, exports it from the restored data and downloads the file', async () => {
    const s = setup();
    mount.render(s.element);
    act(() => button().click());
    await flush();
    expect(s.restore).toHaveBeenCalledWith(DEPS, 'run-9');
    expect(s.prepare).toHaveBeenCalledWith({
      state: { marker: 'state' },
      assets: { marker: 'assets' },
      eventLog: [{ marker: 'event' }],
      runId: 'run-9',
      deps: DEPS,
    });
    expect(s.download).toHaveBeenCalledExactlyOnceWith('{}');
    expect(status()).toBe(EXPORT_DONE_TEXT);
    expect(s.onStatus).toHaveBeenLastCalledWith(EXPORT_DONE_TEXT);
    expect(button().disabled).toBe(false);
  });

  it('says so when the copy had to leave the notes out', async () => {
    const s = setup();
    s.prepare.mockResolvedValue({ ok: true, json: '{}', withNotes: false });
    mount.render(s.element);
    act(() => button().click());
    await flush();
    expect(status()).toBe(EXPORT_NO_NOTES_TEXT);
    expect(s.onStatus).toHaveBeenLastCalledWith(EXPORT_NO_NOTES_TEXT);
  });

  it('reports a failed restore, a failed export and a failed download without downloading', async () => {
    const restoreFails = setup();
    restoreFails.restore.mockResolvedValue({ ok: false, error: { kind: 'record-unreadable' } });
    mount.render(restoreFails.element);
    act(() => button().click());
    await flush();
    expect(status()).toBe(EXPORT_FAILED_TEXT);
    expect(restoreFails.prepare).not.toHaveBeenCalled();

    const prepareFails = setup();
    prepareFails.prepare.mockResolvedValue({ ok: false });
    mount.render(prepareFails.element);
    act(() => button().click());
    await flush();
    expect(status()).toBe(EXPORT_FAILED_TEXT);
    expect(prepareFails.download).not.toHaveBeenCalled();

    const downloadFails = setup();
    downloadFails.download.mockImplementation(() => {
      throw new Error('blocked');
    });
    mount.render(downloadFails.element);
    act(() => button().click());
    await flush();
    expect(status()).toBe(EXPORT_FAILED_TEXT);
    expect(downloadFails.onStatus).toHaveBeenLastCalledWith(EXPORT_FAILED_TEXT);
  });

  it('disables the button while the copy is being made', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const s = setup();
    s.restore.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    mount.render(s.element);
    act(() => button().click());
    expect(button().disabled).toBe(true);
    await act(async () => finish({ ok: false, error: { kind: 'record-unreadable' } }));
    expect(button().disabled).toBe(false);
  });
});

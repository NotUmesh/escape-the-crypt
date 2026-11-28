import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { IMPORT_COPY, IMPORT_ERROR_KINDS, renderError } from '@escape-the-crypt/core';
import type { ImportErrorKind } from '@escape-the-crypt/core';
import type { ImportDeps } from '../../state/storage/import-crypt';
import type { ImportResult, ImportedCrypt } from '../../state/storage/import-result';
import { useMount } from '../../test-support/flow-dom';
import { ImportCrypt } from './import-crypt';

const DEPS = { factory: undefined, notesStore: { save: vi.fn(), load: vi.fn() } } as unknown as ImportDeps;
const IMPORTED: ImportedCrypt = { manifestId: 'm-1', runId: 'r-1', status: 'active', source: 'sample', withNotes: false };
const file = (text = '{}', name = 'my-private-notes-export.json'): File => new File([text], name, { type: 'application/json' });

function setup(result: ImportResult<ImportedCrypt> | Error = { ok: true, value: IMPORTED }) {
  const onImported = vi.fn();
  const announce = vi.fn();
  const importFile = vi.fn<(deps: ImportDeps, f: Blob) => Promise<ImportResult<ImportedCrypt>>>(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  );
  const element = <ImportCrypt deps={DEPS} onImported={onImported} announce={announce} importFile={importFile} />;
  return { element, onImported, announce, importFile };
}

describe('ImportCrypt', () => {
  const mount = useMount();
  const button = (): HTMLButtonElement => mount.container.querySelector('button') as HTMLButtonElement;
  const input = (): HTMLInputElement => mount.container.querySelector('input[type="file"]') as HTMLInputElement;
  const status = (): string => mount.container.querySelector('[data-testid="import-status"]')?.textContent ?? '';

  async function choose(chosen: File): Promise<void> {
    Object.defineProperty(input(), 'files', { value: [chosen], configurable: true });
    await act(async () => {
      input().dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => vi.waitFor(() => expect(button().disabled).toBe(false)));
  }

  it('is a button named "Import a crypt" with a hint, and a hidden JSON-only file input', () => {
    mount.render(setup().element);
    expect(button().textContent).toBe(IMPORT_COPY.button);
    expect(input().hidden).toBe(true);
    expect(input().accept).toContain('.json');
    expect(input().multiple).toBe(false);
    expect(button().getAttribute('aria-describedby')).toBe(mount.container.querySelector('.fh-note')?.id);
    expect(mount.container.textContent).toContain(IMPORT_COPY.hint);
  });

  it('draws no live region of its own: the shell announcer reads the result', () => {
    mount.render(setup().element);
    expect(mount.container.querySelectorAll('[aria-live], [role="status"], [role="alert"]')).toHaveLength(0);
  });

  it('opens the file chooser from the button', () => {
    mount.render(setup().element);
    const click = vi.spyOn(input(), 'click');
    act(() => button().click());
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('hands the chosen file to the importer, then shows, announces and reports the success', async () => {
    const s = setup();
    mount.render(s.element);
    const chosen = file();
    await choose(chosen);
    expect(s.importFile).toHaveBeenCalledWith(DEPS, chosen);
    expect(status()).toBe(IMPORT_COPY.done.active);
    expect(s.announce).toHaveBeenLastCalledWith(IMPORT_COPY.done.active);
    expect(s.onImported).toHaveBeenCalledWith(IMPORTED);
  });

  it('says so when the crypt that came in had already escaped', async () => {
    const s = setup({ ok: true, value: { ...IMPORTED, status: 'escaped' } });
    mount.render(s.element);
    await choose(file());
    expect(status()).toBe(IMPORT_COPY.done.escaped);
  });

  it('shows the typed copy for every kind of refusal, reports nothing imported, and never shows the file name or text', async () => {
    for (const kind of IMPORT_ERROR_KINDS as readonly ImportErrorKind[]) {
      const s = setup({ ok: false, error: { kind } });
      mount.render(s.element);
      await choose(file('SECRET NOTES TEXT'));
      expect(status(), kind).toBe(renderError(IMPORT_COPY.errors[kind]));
      expect(s.announce).toHaveBeenLastCalledWith(renderError(IMPORT_COPY.errors[kind]));
      expect(s.onImported).not.toHaveBeenCalled();
      expect(mount.container.textContent).not.toContain('SECRET NOTES TEXT');
      expect(mount.container.textContent).not.toContain('my-private-notes-export');
    }
  });

  it('falls back to the write-failed copy if the importer itself throws', async () => {
    const s = setup(new Error('boom: SECRET'));
    mount.render(s.element);
    await choose(file());
    expect(status()).toBe(renderError(IMPORT_COPY.errors['write-failed']));
    expect(mount.container.textContent).not.toContain('SECRET');
    expect(s.onImported).not.toHaveBeenCalled();
  });

  it('disables the button while a file is being read, and lets the same file be chosen again afterwards', async () => {
    let release: (result: ImportResult<ImportedCrypt>) => void = () => undefined;
    const importFile = vi.fn(() => new Promise<ImportResult<ImportedCrypt>>((resolve) => (release = resolve)));
    mount.render(<ImportCrypt deps={DEPS} onImported={vi.fn()} announce={vi.fn()} importFile={importFile} />);
    Object.defineProperty(input(), 'files', { value: [file()], configurable: true });
    await act(async () => {
      input().dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(button().disabled).toBe(true);
    expect(status()).toBe(IMPORT_COPY.working);
    await act(async () => release({ ok: false, error: { kind: 'duplicate' } }));
    expect(button().disabled).toBe(false);
    expect(input().value).toBe('');
  });

  it('ignores a change event with no file', async () => {
    const s = setup();
    mount.render(s.element);
    Object.defineProperty(input(), 'files', { value: [], configurable: true });
    await act(async () => {
      input().dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(s.importFile).not.toHaveBeenCalled();
  });
});

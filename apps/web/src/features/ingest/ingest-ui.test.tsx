import { act } from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ANNOUNCEMENT_COPY,
  PAGE_FLAG_COPY,
  PRIVACY_NOTICE,
  errorMessage,
} from '@escape-the-crypt/core';
import {
  announcement,
  chooseFile,
  clickButton,
  setTextarea,
  typeNotes,
  useMount,
} from '../../test-support/flow-dom';
import { createRealPdfjsClient } from '../../test-support/real-pdfjs-client';
import type { IngestUnit } from './ingest-machine';
import { IngestFlow } from './ingest-flow';
import { createSessionStore } from './notes-store';
import type { NotesStore } from './notes-store';
import { createMemoryStore } from './notes-store-memory';
import { PageList } from './page-list';
import { PreviewEditor } from './preview-editor';

const mount = useMount();
const FIXTURES = join(import.meta.dirname, 'fixtures');
const SCRIPT_TEXT = '<img src=x onerror=alert(1)>';
const PROSE =
  'Active recall means producing an answer from memory instead of re-reading the notes. ' +
  'Spaced repetition schedules each review just before the learner would forget the item.';

const fixtureFile = (name: string): File =>
  new File([new Uint8Array(readFileSync(join(FIXTURES, name)))], 'notes.pdf', { type: 'application/pdf' });

/** Non-test source files of the ingest feature. */
function ingestSources(): Array<{ name: string; text: string }> {
  return readdirSync(import.meta.dirname)
    .filter((n) => /\.(?:tsx?|css)$/.test(n) && !/\.test\.tsx?$/.test(n))
    .map((name) => ({ name, text: readFileSync(join(import.meta.dirname, name), 'utf8') }));
}

const unit = (i: number, flag: IngestUnit['flag'], included = true): IngestUnit => ({
  id: `pdf-${i}`,
  kind: 'pdf',
  pdfPageIndex: i,
  printedPageLabel: null,
  originalText: 'text',
  currentText: 'text',
  flag,
  included,
});

describe('preview text is plain text (5.7)', () => {
  it('shows markup-looking text as the textarea value and creates no element', () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const units = [{ ...unit(0, 'ok'), currentText: SCRIPT_TEXT, originalText: SCRIPT_TEXT }];
    mount.render(<PreviewEditor units={units} canConfirm onTextEdited={() => undefined} onConfirm={() => undefined} />);
    expect(mount.container.querySelector('img')).toBeNull();
    expect(mount.container.querySelector('textarea')?.value).toBe(SCRIPT_TEXT);
    expect(alert).not.toHaveBeenCalled();
  });

  it('does the same for pasted text typed into the flow', () => {
    mount.render(<IngestFlow store={createMemoryStore()} />);
    typeNotes(mount.container, `${SCRIPT_TEXT}\n\n${PROSE}`);
    expect(mount.container.querySelector('img')).toBeNull();
    const values = Array.from(mount.container.querySelectorAll('.ingest-preview textarea')).map(
      (t) => (t as HTMLTextAreaElement).value,
    );
    expect(values).toContain(SCRIPT_TEXT);
  });

  it('never uses dangerouslySetInnerHTML in features/ingest', () => {
    const offenders = ingestSources().filter((s) => s.text.includes('dangerouslySetInnerHTML'));
    expect(offenders.map((s) => s.name)).toEqual([]);
  });
});

describe('page flags (4.6, 9.5)', () => {
  it('shows an icon and a text label for every flag, and Remove only on flagged pages', () => {
    const units = [unit(0, 'ok'), unit(1, 'low-text'), unit(2, 'suspicious')];
    mount.render(<PageList units={units} onRemove={() => undefined} />);
    const items = Array.from(mount.container.querySelectorAll('li'));
    expect(items).toHaveLength(3);
    const flags = ['ok', 'low-text', 'suspicious'] as const;
    items.forEach((item, i) => {
      const flag = flags[i] as (typeof flags)[number];
      const badge = item.querySelector('.ingest-flag');
      expect(badge?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(badge?.textContent).toBe(PAGE_FLAG_COPY[flag].label);
      expect(item.querySelector('button') !== null).toBe(flag !== 'ok');
    });
  });

  it('gives each flag a different icon shape', () => {
    mount.render(<PageList units={[unit(0, 'ok'), unit(1, 'low-text'), unit(2, 'suspicious')]} onRemove={() => undefined} />);
    const shapes = Array.from(mount.container.querySelectorAll('.ingest-flag path')).map((p) => p.getAttribute('d'));
    expect(new Set(shapes).size).toBe(3);
  });
});

describe('live region announcements (9.3)', () => {
  it('announces a page flag, then the page removal, for a real flagged PDF', async () => {
    mount.render(<IngestFlow store={createMemoryStore()} createClient={createRealPdfjsClient} />);
    chooseFile(mount.container, fixtureFile('table-like.pdf'));
    await vi.waitFor(() => expect(mount.container.querySelectorAll('.ingest-pdf-page')).toHaveLength(1));
    await act(async () => mount.container.querySelector<HTMLInputElement>('.ingest-pdf-page input')?.click());
    await clickButton(mount.container, 'Read these pages');
    await vi.waitFor(() => expect(announcement(mount.container)).toBe(ANNOUNCEMENT_COPY.pageSuspicious(1)));
    await clickButton(mount.container, 'Remove page');
    expect(announcement(mount.container)).toBe(ANNOUNCEMENT_COPY.pageRemoved(1));
  });

  it('announces a low-text flag for an image-only page', async () => {
    mount.render(<IngestFlow store={createMemoryStore()} createClient={createRealPdfjsClient} />);
    chooseFile(mount.container, fixtureFile('image-only.pdf'));
    await vi.waitFor(() => expect(mount.container.querySelectorAll('.ingest-pdf-page')).toHaveLength(1));
    await act(async () => mount.container.querySelector<HTMLInputElement>('.ingest-pdf-page input')?.click());
    await clickButton(mount.container, 'Read these pages');
    await vi.waitFor(() => expect(announcement(mount.container)).toBe(ANNOUNCEMENT_COPY.pageLowText(1)));
  });

  it('announces an edit and the confirmation', async () => {
    mount.render(<IngestFlow store={createMemoryStore()} />);
    typeNotes(mount.container, PROSE);
    const area = mount.container.querySelector<HTMLTextAreaElement>('.ingest-preview textarea');
    if (area === null) throw new Error('no preview textarea');
    setTextarea(area, `${PROSE} Added.`);
    expect(announcement(mount.container)).toBe(ANNOUNCEMENT_COPY.edited);
    await clickButton(mount.container, 'Confirm notes');
    expect(announcement(mount.container)).toContain('Notes confirmed');
  });

  it('uses a polite, atomic status region', () => {
    mount.render(<IngestFlow store={createMemoryStore()} />);
    const region = mount.container.querySelector('[role="status"]');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.getAttribute('aria-atomic')).toBe('true');
  });
});

describe('privacy notice (10.1, 10.2, 10.3)', () => {
  it('shows both statements and says "your notes" on the upload screen', () => {
    mount.render(<IngestFlow store={createMemoryStore()} />);
    const text = mount.container.textContent ?? '';
    expect(text).toContain(PRIVACY_NOTICE.stays);
    expect(text).toContain(PRIVACY_NOTICE.sent);
    expect(PRIVACY_NOTICE.stays + PRIVACY_NOTICE.sent).toContain('your notes');
    expect(text).toContain('your notes');
  });
});

describe('native elements and no drag (17.4, 9.7)', () => {
  it('has no non-button element with a button role in any state of the flow', async () => {
    mount.render(<IngestFlow store={createMemoryStore()} createClient={createRealPdfjsClient} />);
    const check = (): void => {
      for (const el of Array.from(mount.container.querySelectorAll('[role="button"]'))) {
        expect(el.tagName).toBe('BUTTON');
      }
      expect(mount.container.querySelectorAll('div[role="button"], span[role="button"]')).toHaveLength(0);
    };
    check();
    chooseFile(mount.container, fixtureFile('image-only.pdf'));
    await vi.waitFor(() => expect(mount.container.querySelectorAll('.ingest-pdf-page')).toHaveLength(1));
    check();
    await act(async () => mount.container.querySelector<HTMLInputElement>('.ingest-pdf-page input')?.click());
    await clickButton(mount.container, 'Read these pages');
    await vi.waitFor(() => expect(mount.container.querySelector('.ingest-preview')).not.toBeNull());
    check();
  });

  it('uses no role="button", drag attribute or drag handler in the source', () => {
    for (const { name, text } of ingestSources()) {
      expect(text, name).not.toMatch(/role=["']button["']/);
      expect(text, name).not.toMatch(/draggable|onDrag|onDrop|dragstart|dataTransfer/);
    }
  });

  it('puts the interactive controls in native elements only', () => {
    mount.render(<IngestFlow store={createMemoryStore()} />);
    typeNotes(mount.container, PROSE);
    const allowed = new Set(['BUTTON', 'INPUT', 'TEXTAREA', 'FORM', 'LABEL', 'FIELDSET', 'A']);
    for (const el of Array.from(mount.container.querySelectorAll('[tabindex], [onclick], [role]'))) {
      if (el.getAttribute('role') === 'status') continue;
      expect(allowed.has(el.tagName), el.outerHTML).toBe(true);
    }
  });
});

describe('storage failure keeps the flow usable (18.8)', () => {
  it('announces the storage message and keeps the chunks in the session store', async () => {
    const failing: NotesStore = {
      save: () => Promise.resolve({ ok: false, error: { kind: 'storage-unavailable' } }),
      load: () => Promise.resolve({ ok: true, value: null }),
    };
    const memory = createMemoryStore();
    let digest = '';
    mount.render(
      <IngestFlow
        store={createSessionStore(failing, memory)}
        onConfirmed={(chunks) => (digest = chunks[0]?.documentDigest ?? '')}
      />,
    );
    typeNotes(mount.container, PROSE);
    await clickButton(mount.container, 'Confirm notes');
    expect(announcement(mount.container)).toBe(errorMessage({ kind: 'storage-unavailable' }));
    expect(mount.container.textContent).toContain('1 piece of your notes');
    const kept = await memory.load(digest);
    expect(kept.ok && kept.value?.chunks.length).toBe(1);
  });
});
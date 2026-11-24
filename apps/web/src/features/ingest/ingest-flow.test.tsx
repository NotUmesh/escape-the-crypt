import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MAX_FILE_SIZE_BYTES, citationLabel, errorMessage } from '@escape-the-crypt/core';
import type { Chunk } from '@escape-the-crypt/core';
import {
  announcement,
  chooseFile,
  clickButton,
  typeNotes,
  useMount,
} from '../../test-support/flow-dom';
import { createRealPdfjsClient } from '../../test-support/real-pdfjs-client';
import type { CountRequest, ExtractionClient } from './extraction-client';
import { IngestFlow } from './ingest-flow';
import type { NotesStore } from './notes-store';
import { createMemoryStore } from './notes-store-memory';

const mount = useMount();

const PROSE =
  'Active recall means producing an answer from memory instead of re-reading the notes. ' +
  'Spaced repetition schedules each review just before the learner would forget the item.';

function fakeClient() {
  const requests: CountRequest[] = [];
  const count = vi.fn(async (request: CountRequest) => {
    requests.push(request);
    return { ok: true as const, value: true as const };
  });
  const client: ExtractionClient = {
    count,
    start: vi.fn(async () => ({ ok: true as const, value: true as const })),
    cancel: vi.fn(),
    terminate: vi.fn(),
  };
  return { client, count, requests };
}

function pdfFile(size: number): File {
  const file = new File(['x'], 'notes.pdf', { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('IngestFlow', () => {
  it('has the .ingest-root class', () => {
    mount.render(<IngestFlow store={createMemoryStore()} createClient={() => fakeClient().client} />);
    expect(mount.container.firstElementChild?.classList.contains('ingest-root')).toBe(true);
  });

  it('checks the file size first and never opens an oversized PDF', () => {
    const fake = fakeClient();
    mount.render(<IngestFlow store={createMemoryStore()} createClient={() => fake.client} />);
    chooseFile(mount.container, pdfFile(MAX_FILE_SIZE_BYTES + 1));
    expect(fake.count).not.toHaveBeenCalled();
    expect(mount.container.textContent).toContain('larger than 5 MB');
  });

  it('counts pages through the client for a file within the limit, then shows the page choices', () => {
    const fake = fakeClient();
    mount.render(<IngestFlow store={createMemoryStore()} createClient={() => fake.client} />);
    chooseFile(mount.container, pdfFile(1000));
    expect(fake.count).toHaveBeenCalledTimes(1);
    expect(mount.container.textContent).toContain('Opening your PDF');
    act(() => fake.requests[0]?.onMessage({ type: 'counted', pageCount: 3, labels: [null, null, null] }));
    expect(mount.container.querySelectorAll('.ingest-pdf-page')).toHaveLength(3);
  });

  it('shows the encrypted message when the count reports an encrypted file', () => {
    const fake = fakeClient();
    mount.render(<IngestFlow store={createMemoryStore()} createClient={() => fake.client} />);
    chooseFile(mount.container, pdfFile(1000));
    act(() => fake.requests[0]?.onMessage({ type: 'error', error: { kind: 'encrypted' } }));
    expect(mount.container.textContent).toContain('protected with a password');
  });

  it('saves confirmed notes and announces it', async () => {
    const store = createMemoryStore();
    const saved = vi.spyOn(store, 'save');
    mount.render(<IngestFlow store={store} createClient={() => fakeClient().client} />);
    typeNotes(mount.container, PROSE);
    await clickButton(mount.container, 'Confirm notes');
    expect(saved).toHaveBeenCalledTimes(1);
    expect(announcement(mount.container)).toBe('Notes confirmed and saved on this device');
  });

  it('keeps going and announces the storage message when saving fails', async () => {
    const failing: NotesStore = {
      save: () => Promise.resolve({ ok: false, error: { kind: 'storage-unavailable' } }),
      load: () => Promise.resolve({ ok: true, value: null }),
    };
    mount.render(<IngestFlow store={failing} createClient={() => fakeClient().client} />);
    typeNotes(mount.container, PROSE);
    await clickButton(mount.container, 'Confirm notes');
    expect(announcement(mount.container)).toBe(errorMessage({ kind: 'storage-unavailable' }));
    expect(mount.container.textContent).toContain('1 piece of your notes');
  });

  it('carries the printed page label from a real PDF to the chunk citation', async () => {
    const bytes = readFileSync(join(import.meta.dirname, 'fixtures', 'printed-labels.pdf'));
    const file = new File([new Uint8Array(bytes)], 'notes.pdf', { type: 'application/pdf' });
    let confirmed: readonly Chunk[] = [];
    mount.render(
      <IngestFlow
        store={createMemoryStore()}
        createClient={createRealPdfjsClient}
        onConfirmed={(chunks) => (confirmed = chunks)}
      />,
    );
    chooseFile(mount.container, file);
    // The count labels show in the page choices.
    await vi.waitFor(() => expect(mount.container.querySelectorAll('.ingest-pdf-page')).toHaveLength(3));
    const names = Array.from(mount.container.querySelectorAll('.ingest-pdf-page')).map((l) => l.textContent);
    expect(names).toEqual(['Page 1 (printed page i)', 'Page 2 (printed page ii)', 'Page 3 (printed page iii)']);
    // Choose page 2 only, read it, confirm.
    const boxes = mount.container.querySelectorAll<HTMLInputElement>('.ingest-pdf-page input');
    await act(async () => boxes[1]?.click());
    await clickButton(mount.container, 'Read these pages');
    await vi.waitFor(() => expect(mount.container.querySelector('.ingest-preview')).not.toBeNull());
    await clickButton(mount.container, 'Confirm notes');
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.location).toEqual({ sourceType: 'pdf', pdfPageIndex: 1, printedPageLabel: 'ii' });
    expect(citationLabel(confirmed[0] as Chunk)).toBe('PDF page 2 (printed page ii)');
  });
});
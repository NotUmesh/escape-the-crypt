import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FILE_SIZE_BYTES, storageFailedMessage } from '@escape-the-crypt/core';
import type { ExtractionClient, CountRequest } from './extraction-client';
import { IngestFlow } from './ingest-flow';
import { createMemoryStore } from './notes-store-memory';
import type { NotesStore } from './notes-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

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

function choose(file: File): void {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('no file input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function type(text: string): void {
  const area = container.querySelector<HTMLTextAreaElement>('.ingest-paste textarea');
  if (area === null) throw new Error('no paste textarea');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(area, text);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const click = (button: Element | null | undefined): void => {
  if (!button) throw new Error('no button');
  act(() => (button as HTMLButtonElement).click());
};

const PROSE =
  'Active recall means producing an answer from memory instead of re-reading the notes. ' +
  'Spaced repetition schedules each review just before the learner would forget the item.';

describe('IngestFlow', () => {
  it('has the .ingest-root class', () => {
    act(() => root.render(<IngestFlow store={createMemoryStore()} createClient={() => fakeClient().client} />));
    expect(container.firstElementChild?.classList.contains('ingest-root')).toBe(true);
  });

  it('checks the file size first and never opens an oversized PDF', () => {
    const fake = fakeClient();
    act(() => root.render(<IngestFlow store={createMemoryStore()} createClient={() => fake.client} />));
    choose(pdfFile(MAX_FILE_SIZE_BYTES + 1));
    expect(fake.count).not.toHaveBeenCalled();
    expect(container.textContent).toContain('larger than 5 MB');
  });

  it('counts pages through the client for a file within the limit, then shows the page choices', () => {
    const fake = fakeClient();
    act(() => root.render(<IngestFlow store={createMemoryStore()} createClient={() => fake.client} />));
    choose(pdfFile(1000));
    expect(fake.count).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Opening your PDF');
    act(() => fake.requests[0]?.onMessage({ type: 'counted', pageCount: 3, labels: [null, null, null] }));
    expect(container.querySelectorAll('.ingest-pdf-page')).toHaveLength(3);
  });

  it('shows the encrypted message when the count reports an encrypted file', () => {
    const fake = fakeClient();
    act(() => root.render(<IngestFlow store={createMemoryStore()} createClient={() => fake.client} />));
    choose(pdfFile(1000));
    act(() => fake.requests[0]?.onMessage({ type: 'error', error: { kind: 'encrypted' } }));
    expect(container.textContent).toContain('protected with a password');
  });

  it('saves confirmed notes and announces it', async () => {
    const store = createMemoryStore();
    const saved = vi.spyOn(store, 'save');
    act(() => root.render(<IngestFlow store={store} createClient={() => fakeClient().client} />));
    type(PROSE);
    await act(async () => click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Confirm notes')));
    expect(saved).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Notes confirmed and saved on this device');
  });

  it('keeps going and announces the storage message when saving fails', async () => {
    const failing: NotesStore = {
      save: () => Promise.resolve({ ok: false, error: { kind: 'storage-unavailable' } }),
      load: () => Promise.resolve({ ok: true, value: null }),
    };
    act(() => root.render(<IngestFlow store={failing} createClient={() => fakeClient().client} />));
    type(PROSE);
    await act(async () => click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Confirm notes')));
    expect(container.querySelector('[role="status"]')?.textContent).toBe(storageFailedMessage());
    expect(container.textContent).toContain('1 piece of your notes');
  });
});
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildHumanHeartSampleCrypt, ENTER_CRYPT_LABEL, GENERATION_COPY, SAMPLE_CRYPT_LINE } from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, NotesRecord, SampleCryptResult } from '@escape-the-crypt/core';
import { IngestScreen } from './app';
import { createMemoryStore } from './features/ingest/notes-store-memory';
import { useRoomBinding } from './state/room-binding';
import { fakeWorker } from './test-support/fake-worker-client';
import { clickButton, typeNotes, useMount } from './test-support/flow-dom';

const SAMPLES = join(process.cwd(), '..', '..', 'samples');

function build(): SampleCryptResult {
  const notes = readFileSync(join(SAMPLES, 'human-heart.txt'), 'utf8');
  const file = JSON.parse(
    readFileSync(join(SAMPLES, 'questions', 'human-heart.json'), 'utf8'),
  ) as HumanHeartQuestionsFile;
  const built = buildHumanHeartSampleCrypt(notes, file);
  if (!built.ok) throw new Error(`sample crypt failed: ${built.error.kind}`);
  return built.value;
}

const CRYPT = build();
const useBinding = () => useRoomBinding(() => ({ ok: true, value: CRYPT }));

const PROSE =
  'Active recall means producing an answer from memory instead of re-reading the notes. ' +
  'Spaced repetition schedules each review just before the learner would forget the item.';

function screen(store = createMemoryStore()) {
  return <IngestScreen store={store} useBinding={useBinding} />;
}

describe('IngestScreen: Enter the crypt', () => {
  const mount = useMount();

  it('shows neither the button nor the line before notes are confirmed', () => {
    mount.render(screen());
    typeNotes(mount.container, PROSE);
    expect(mount.container.textContent).not.toContain(ENTER_CRYPT_LABEL);
    expect(mount.container.textContent).not.toContain(SAMPLE_CRYPT_LINE);
  });

  it('shows the button with the sample-crypt line after Confirm notes', async () => {
    mount.render(screen());
    typeNotes(mount.container, PROSE);
    await clickButton(mount.container, 'Confirm notes');
    const actions = mount.container.querySelector('[data-testid="start-actions"]');
    expect(actions?.textContent).toContain(SAMPLE_CRYPT_LINE);
    expect(actions?.querySelector('button')?.textContent).toBe(ENTER_CRYPT_LABEL);
    expect(actions?.querySelectorAll('button')).toHaveLength(1);
  });

  it('starts the run and shows room 1 on activation, leaving the saved notes unchanged', async () => {
    const store = createMemoryStore();
    const saved: NotesRecord[] = [];
    const save = store.save.bind(store);
    vi.spyOn(store, 'save').mockImplementation((record) => {
      saved.push(record);
      return save(record);
    });
    mount.render(screen(store));
    typeNotes(mount.container, PROSE);
    await clickButton(mount.container, 'Confirm notes');
    const before = JSON.stringify(saved);
    await clickButton(mount.container, ENTER_CRYPT_LABEL);
    expect(mount.container.querySelector('.room-screen')).not.toBeNull();
    expect(saved).toHaveLength(1);
    expect(JSON.stringify(saved)).toBe(before);
    expect(mount.container.textContent).not.toContain('Active recall');
  });

  it('returns to the notes preview with no run after a reload', async () => {
    const store = createMemoryStore();
    mount.render(screen(store));
    typeNotes(mount.container, PROSE);
    await clickButton(mount.container, 'Confirm notes');
    await clickButton(mount.container, ENTER_CRYPT_LABEL);
    mount.render(null);
    mount.render(screen(store));
    expect(mount.container.querySelector('.room-screen')).toBeNull();
    expect(mount.container.querySelector('[data-testid="start-actions"]')).toBeNull();
    expect(mount.container.textContent).not.toContain(ENTER_CRYPT_LABEL);
    expect(mount.container.querySelector('.ingest-paste textarea')).not.toBeNull();
  });
});

describe('IngestScreen: Generate from my notes', () => {
  const mount = useMount();
  it('sends nothing until the button is pressed, then sends the confirmed notes text', async () => {
    const worker = fakeWorker([{ kind: 'running' }]);
    mount.render(
      <IngestScreen
        store={createMemoryStore()}
        useBinding={useBinding}
        generate={{ origin: 'http://localhost:8787', client: worker.client }}
      />,
    );
    typeNotes(mount.container, PROSE);
    await clickButton(mount.container, 'Confirm notes');
    expect(worker.startTexts).toEqual([]);
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    expect(worker.startTexts).toEqual([PROSE]);
  });
  it('has exactly one aria-live element during a job, and it carries the progress text', async () => {
    const worker = fakeWorker([{ kind: 'running' }]);
    mount.render(
      <IngestScreen
        store={createMemoryStore()}
        useBinding={useBinding}
        generate={{ origin: 'http://localhost:8787', client: worker.client }}
      />,
    );
    typeNotes(mount.container, PROSE);
    await clickButton(mount.container, 'Confirm notes');
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    const regions = document.querySelectorAll('[aria-live]');
    expect(regions).toHaveLength(1);
    expect(regions[0]?.getAttribute('aria-live')).toBe('polite');
    expect(regions[0]?.textContent).toBe(GENERATION_COPY.progress);
    expect(mount.container.querySelectorAll('[role="status"]')).toHaveLength(1);
    // The visible progress line is plain text.
    expect(mount.container.querySelector('[data-testid="generation-progress"] [aria-live]')).toBeNull();
    await clickButton(mount.container, GENERATION_COPY.cancel);
    expect(document.querySelector('[aria-live]')?.textContent).toBe(GENERATION_COPY.cancelled);
  });});
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildHumanHeartSampleCrypt, ENTER_CRYPT_LABEL, SAMPLE_CRYPT_LINE } from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, NotesRecord, SampleCryptResult } from '@escape-the-crypt/core';
import { IngestScreen } from './app';
import { createMemoryStore } from './features/ingest/notes-store-memory';
import { useRoomBinding } from './state/room-binding';
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
    const start = mount.container.querySelector('.crypt-start');
    expect(start?.textContent).toContain(SAMPLE_CRYPT_LINE);
    expect(start?.querySelector('button')?.textContent).toBe(ENTER_CRYPT_LABEL);
    expect(mount.container.querySelectorAll('button')).toHaveLength(1);
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
    expect(mount.container.querySelector('.crypt-start')).toBeNull();
    expect(mount.container.textContent).not.toContain(ENTER_CRYPT_LABEL);
    expect(mount.container.querySelector('.ingest-paste textarea')).not.toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANNOUNCEMENT_COPY,
  ENTER_CRYPT_LABEL,
  FRONT_OF_HOUSE_COPY,
  GENERATION_COPY,
  buildHumanHeartSampleCrypt,
} from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, SampleCryptResult } from '@escape-the-crypt/core';
import { createMemoryStore } from '../ingest/notes-store-memory';
import { useRoomBinding } from '../../state/room-binding';
import { fakeWorker } from '../../test-support/fake-worker-client';
import { clickButton, typeNotes, useMount } from '../../test-support/flow-dom';
import { FrontOfHouse } from './front-of-house';
import type { FrontOfHouseProps } from './front-of-house';

const SAMPLES = join(process.cwd(), '..', '..', 'samples');
function build(): SampleCryptResult {
  const notes = readFileSync(join(SAMPLES, 'human-heart.txt'), 'utf8');
  const file = JSON.parse(readFileSync(join(SAMPLES, 'questions', 'human-heart.json'), 'utf8')) as HumanHeartQuestionsFile;
  const built = buildHumanHeartSampleCrypt(notes, file);
  if (!built.ok) throw new Error(`sample crypt failed: ${built.error.kind}`);
  return built.value;
}
const CRYPT = build();
const useBinding = (): ReturnType<typeof useRoomBinding> => useRoomBinding(() => ({ ok: true, value: CRYPT }));
const PROSE =
  'Active recall means producing an answer from memory instead of re-reading the notes. ' +
  'Spaced repetition schedules each review just before the learner would forget the item.';

function stubReducedMotion(reduced: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduced : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('FrontOfHouse', () => {
  const mount = useMount();
  beforeEach(() => stubReducedMotion(false));
  afterEach(() => vi.unstubAllGlobals());

  const show = (route: 'home' | 'ingest', extra: Partial<FrontOfHouseProps> = {}): void =>
    mount.render(<FrontOfHouse route={route} store={createMemoryStore()} useBinding={useBinding} {...extra} />);
  const withWorker = { generate: { origin: 'http://localhost:8787', client: fakeWorker([{ kind: 'running' }]).client } };

  async function confirmNotes(): Promise<void> {
    typeNotes(mount.container, PROSE);
    await clickButton(mount.container, 'Confirm notes');
  }

  describe('the desk (/)', () => {
    it('shows the hub with a plain link to the notes book and no notes screen', () => {
      show('home');
      const link = mount.container.querySelector('a.fh-button--primary');
      expect(link?.textContent).toBe(FRONT_OF_HOUSE_COPY.hub.bringNotes);
      expect(link?.getAttribute('href')).toBe('/ingest');
      expect(mount.container.querySelector('.ingest-paste textarea')).toBeNull();
      expect(mount.container.querySelectorAll('main')).toHaveLength(1);
    });

    it('offers only the sample crypts that can be built, never with a review label', () => {
      show('home');
      const text = mount.container.textContent ?? '';
      expect(text).toContain('The human heart');
      expect(text).not.toContain('printing press');
      expect(text).not.toMatch(/human-reviewed/i);
    });

    it('has exactly one live region', () => {
      show('home');
      expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);
      expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    });
  });

  describe('the notes book (/ingest)', () => {
    it('keeps the ingest selectors and has one live region for the whole book', async () => {
      show('ingest');
      expect(mount.container.querySelector('.ingest-paste textarea')).not.toBeNull();
      await confirmNotes();
      expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);
      expect(mount.container.querySelector('[data-testid="settings-slot"]')).not.toBeNull();
      const back = mount.container.querySelector('a[href="/"]');
      expect(back?.textContent).toBe(FRONT_OF_HOUSE_COPY.bring.back);
    });

    it('reads the notes step through the shell announcer and keeps it after later renders', async () => {
      show('ingest');
      await confirmNotes();
      await flush();
      expect(document.querySelector('[data-testid="shell-announcer"]')?.textContent).toBe(ANNOUNCEMENT_COPY.saved);
    });

    it('digs while a job runs: the book is hidden, not removed, and the progress line is read once', async () => {
      show('ingest', withWorker);
      await confirmNotes();
      await clickButton(mount.container, GENERATION_COPY.generateButton);
      expect(mount.container.querySelector('[data-testid="dig-screen"]')).not.toBeNull();
      expect(mount.container.querySelector('[data-testid="bring-notes-screen"]')?.hasAttribute('hidden')).toBe(true);
      expect(mount.container.querySelector('.ingest-confirmed')).not.toBeNull();
      const regions = document.querySelectorAll('[aria-live]');
      expect(regions).toHaveLength(1);
      expect(regions[0]?.textContent).toBe(GENERATION_COPY.progress);
      // No stage data yet: no stage list.
      expect(mount.container.querySelector('[data-testid="dig-stage-list"]')).toBeNull();
    });

    it('returns to the book with the notes after Cancel and reads the stopped message', async () => {
      show('ingest', withWorker);
      await confirmNotes();
      await clickButton(mount.container, GENERATION_COPY.generateButton);
      await clickButton(mount.container, GENERATION_COPY.cancel);
      expect(mount.container.querySelector('[data-testid="dig-screen"]')).toBeNull();
      expect(mount.container.querySelector('[data-testid="bring-notes-screen"]')?.hasAttribute('hidden')).toBe(false);
      expect(document.querySelector('[aria-live]')?.textContent).toBe(GENERATION_COPY.cancelled);
      expect(mount.container.querySelector('[data-testid="start-actions"]')).not.toBeNull();
    });
  });

  describe('the descent', () => {
    it('plays over a newly started run: the room is inert until Skip, then focus goes into the room', async () => {
      show('ingest');
      await confirmNotes();
      await clickButton(mount.container, ENTER_CRYPT_LABEL);
      const gate = mount.container.ownerDocument.querySelector('[data-testid="descent-gate"]');
      expect(gate).not.toBeNull();
      expect(mount.container.querySelector('.crypt-stage')?.hasAttribute('inert')).toBe(true);
      expect(document.activeElement?.textContent).toBe(FRONT_OF_HOUSE_COPY.descent.skip);
      await clickButton(mount.container, FRONT_OF_HOUSE_COPY.descent.skip);
      await flush();
      expect(mount.container.querySelector('[data-testid="descent-gate"]')).toBeNull();
      expect(mount.container.querySelector('.crypt-stage')?.hasAttribute('inert')).toBe(false);
      // The room's own live region carries the announcement; the shell announcer is gone.
      expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);
      expect(document.querySelector('[data-testid="shell-announcer"]')).toBeNull();
    });

    it('does not draw with reduced motion: the run is usable at once and the descent is announced', async () => {
      stubReducedMotion(true);
      show('ingest');
      await confirmNotes();
      await clickButton(mount.container, ENTER_CRYPT_LABEL);
      await flush();
      expect(mount.container.querySelector('[data-testid="descent-gate"]')).toBeNull();
      expect(mount.container.querySelector('.crypt-stage')?.hasAttribute('inert')).toBe(false);
      expect(mount.container.querySelector('.room-screen')).not.toBeNull();
    });

    it('makes the run page the one main landmark', async () => {
      stubReducedMotion(true);
      show('ingest');
      await confirmNotes();
      await clickButton(mount.container, ENTER_CRYPT_LABEL);
      await flush();
      expect(mount.container.querySelectorAll('main')).toHaveLength(1);
    });
  });
});

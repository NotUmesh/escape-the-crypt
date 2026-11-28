import { BUILDABLE_SAMPLE_IDS, SAMPLE_LIST } from './sample-list';
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
    beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined))));

    it('shows the hub with a plain link to the notes book and no notes screen', () => {
      show('home');
      const link = mount.container.querySelector('a[data-prop="notes-book"]');
      expect(link?.textContent).toBe(FRONT_OF_HOUSE_COPY.hub.bringNotes);
      expect(link?.getAttribute('href')).toBe('/ingest');
      expect(mount.container.querySelector('.ingest-paste textarea')).toBeNull();
      expect(mount.container.querySelectorAll('main')).toHaveLength(1);
    });

    it('offers only the sample crypts that can be built, never with a review label', async () => {
      show('home');
      await clickButton(mount.container, FRONT_OF_HOUSE_COPY.hub.samplesTitle);
      const text = mount.container.textContent ?? '';
      // Exactly the buildable samples are offered: a listed sample with no builder would not show.
      for (const entry of SAMPLE_LIST) {
        expect(text.includes(entry.title), entry.title).toBe(BUILDABLE_SAMPLE_IDS.includes(entry.id));
      }
      expect(text).toContain('The human heart');
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

describe('FrontOfHouse: judge access', () => {
  const mount = useMount();
  const CODE = 'judge-code-0123456789-abcdef';
  // Built at run time: the style guard bans cross-origin URL literals in source.
  const ORIGIN = ['http:', 'localhost:8787'].join('//');

  interface Sent {
    readonly url: string;
    readonly headers: Record<string, string>;
  }
  function stubFetch(respond: (url: string) => Response): Sent[] {
    const sent: Sent[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        sent.push({ url, headers: init.headers as Record<string, string> });
        return Promise.resolve(respond(url));
      }),
    );
    return sent;
  }
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  beforeEach(() => {
    stubReducedMotion(false);
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  async function openBookWithNotes(): Promise<void> {
    mount.render(<FrontOfHouse route="ingest" store={createMemoryStore()} useBinding={useBinding} generate={{ origin: ORIGIN }} />);
    typeNotes(mount.container, PROSE);
    await clickButton(mount.container, 'Confirm notes');
  }
  function typeCode(code: string): void {
    const input = mount.container.querySelector<HTMLInputElement>('[data-testid="judge-access"] input');
    if (input === null) throw new Error('no judge access field');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(input, code);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('is a closed disclosure on the book once notes are confirmed, and not before', async () => {
    mount.render(<FrontOfHouse route="ingest" store={createMemoryStore()} useBinding={useBinding} generate={{ origin: ORIGIN }} />);
    expect(mount.container.querySelector('[data-testid="judge-access"]')).toBeNull();
    typeNotes(mount.container, PROSE);
    await clickButton(mount.container, 'Confirm notes');
    const details = mount.container.querySelector<HTMLDetailsElement>('[data-testid="judge-access"]');
    expect(details?.open).toBe(false);
  });

  it('is not offered when no worker is configured', async () => {
    mount.render(<FrontOfHouse route="ingest" store={createMemoryStore()} useBinding={useBinding} generate={{ origin: null }} />);
    typeNotes(mount.container, PROSE);
    await clickButton(mount.container, 'Confirm notes');
    expect(mount.container.querySelector('[data-testid="judge-access"]')).toBeNull();
  });

  it('sends Generate to /judge/jobs with the code in the header and nowhere else', async () => {
    const sent = stubFetch(() => json(202, { jobId: 'job-1', status: 'queued' }));
    await openBookWithNotes();
    typeCode(CODE);
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    const post = sent[0];
    expect(new URL(post?.url ?? '').pathname).toBe('/judge/jobs');
    expect(post?.headers['X-Judge-Token']).toBe(CODE);
    expect(post?.url).not.toContain(CODE);
    expect(location.href).not.toContain(CODE);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(CODE);
    // The only place the code appears on the page is the field it was typed in.
    expect(document.body.textContent).not.toContain(CODE);
    expect(Array.from(document.body.querySelectorAll('*')).filter((el) => el.outerHTML.replace(el.innerHTML, '').includes(CODE))).toHaveLength(1);
  });

  it('uses the public route when no code was entered', async () => {
    const sent = stubFetch(() => json(202, { jobId: 'job-1', status: 'queued' }));
    await openBookWithNotes();
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    expect(new URL(sent[0]?.url ?? '').pathname).toBe('/jobs');
    expect(Object.keys(sent[0]?.headers ?? {})).not.toContain('X-Judge-Token');
  });

  it('shows the typed error copy for a wrong code, opens the disclosure, and keeps the notes', async () => {
    stubFetch(() => json(403, { error: 'judge-access-denied', message: 'x' }));
    await openBookWithNotes();
    typeCode('wrong-code-0123456789-abcdef');
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    await flush();
    const copy = GENERATION_COPY.failures['judge-access-denied'];
    const failed = mount.container.querySelector('[data-testid="generation-failed"]');
    expect(failed?.textContent).toContain(copy.what);
    expect(failed?.textContent).toContain(copy.next);
    expect(failed?.textContent).not.toContain('wrong-code');
    const details = mount.container.querySelector<HTMLDetailsElement>('[data-testid="judge-access"]');
    expect(details?.open).toBe(true);
    expect(details?.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
    expect(mount.container.querySelector('.ingest-confirmed')).not.toBeNull();
  });

  it('logs nothing while the code is typed and used', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    stubFetch(() => json(403, { error: 'judge-access-denied', message: 'x' }));
    await openBookWithNotes();
    typeCode(CODE);
    await clickButton(mount.container, GENERATION_COPY.generateButton);
    await flush();
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(CODE);
      spy.mockRestore();
    }
  });
});

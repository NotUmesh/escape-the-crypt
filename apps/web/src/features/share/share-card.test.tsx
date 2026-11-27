import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMount } from '../../test-support/flow-dom';
import type { ShareEnv } from './share-actions';
import { SHARE_COPY } from './share-card-copy';
import { buildShareCardData } from './share-card-data';
import type { ShareCardData } from './share-card-data';
import { ShareCard } from './share-card';
import { escapedView } from './share-test-support';

const COUNTS = { 'first-try-correct': 5, assisted: 2, retried: 1, challenged: 0, 'review-due': 3 } as const;
const sample = buildShareCardData(escapedView(COUNTS), { kind: 'sample', title: 'The human heart' }) as ShareCardData;
const notes = buildShareCardData(escapedView({ ...COUNTS, 'review-due': 0 }), { kind: 'notes' }) as ShareCardData;
const PNG = new Blob(['png'], { type: 'image/png' });
const flush = (): Promise<void> => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

function envWith(nav: ShareEnv['nav']): { createEnv: () => ShareEnv; download: ReturnType<typeof vi.fn> } {
  const download = vi.fn();
  return {
    download,
    createEnv: () => ({ nav, makePng: () => Promise.resolve(PNG), makeFile: () => ({}) as File, download }),
  };
}

describe('ShareCard', () => {
  const mount = useMount();
  const button = (): HTMLButtonElement => mount.container.querySelector('button') as HTMLButtonElement;
  const status = (): string => mount.container.querySelector('[data-testid="share-status"]')?.textContent ?? '';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws nothing until the run has escaped', () => {
    mount.render(<ShareCard data={null} />);
    expect(mount.container.innerHTML).toBe('');
  });

  it('shows the headline for a sample, with its label and the five counts', () => {
    mount.render(<ShareCard data={sample} />);
    expect(mount.container.querySelector('[data-testid="share-headline"]')?.textContent).toBe(
      'Escaped \u201CThe human heart\u201D with 3 ghosts remaining',
    );
    const card = mount.container.querySelector('[data-testid="share-card"]') as HTMLElement;
    expect(card.textContent).toContain('Sample crypt');
    const rows = Array.from(card.querySelectorAll('li')).map((li) => li.textContent);
    expect(rows).toEqual(['First-try correct5', 'Assisted2', 'Retried1', 'Challenged: excluded from score0', 'Review due3']);
  });

  it('names no title for a crypt made from notes, and says no ghosts remain', () => {
    mount.render(<ShareCard data={notes} />);
    expect(mount.container.querySelector('[data-testid="share-headline"]')?.textContent).toBe(
      'Escaped a crypt made from my own notes with no ghosts remaining',
    );
    expect(mount.container.querySelector('.share-card__note')).toBeNull();
  });

  it('is real text a screen reader reads as it is: no image role, nothing hidden, no controls inside', () => {
    mount.render(<ShareCard data={sample} />);
    const card = mount.container.querySelector('[data-testid="share-card"]') as HTMLElement;
    expect(card.getAttribute('role')).toBeNull();
    expect(card.getAttribute('aria-hidden')).toBeNull();
    expect(card.querySelector('[aria-hidden="true"], [role="img"], img, canvas, svg')).toBeNull();
    expect(card.querySelector('button, a, input, [tabindex]')).toBeNull();
    expect(card.querySelector('ul')?.getAttribute('aria-label')).toBe('Outcomes');
  });

  it('is a labelled section with one native button and a plain sentence about what the card holds', () => {
    mount.render(<ShareCard data={sample} />);
    const section = mount.container.querySelector('section') as HTMLElement;
    const heading = section.querySelector('h3') as HTMLElement;
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(heading.textContent).toBe('Share your escape');
    expect(section.querySelectorAll('button')).toHaveLength(1);
    expect(button().type).toBe('button');
    expect(button().getAttribute('tabindex')).toBeNull();
    expect(section.textContent).toContain(SHARE_COPY.privacy);
  });

  it('owns no live region of its own', () => {
    mount.render(<ShareCard data={sample} />);
    expect(mount.container.querySelectorAll('[aria-live], [role="status"], [role="alert"]')).toHaveLength(0);
  });

  it('offers Share where the Web Share API exists', () => {
    vi.stubGlobal('navigator', { share: () => Promise.resolve() });
    mount.render(<ShareCard data={sample} />);
    expect(button().textContent).toBe('Share your escape');
  });

  it('offers a download and a copy where it does not', () => {
    vi.stubGlobal('navigator', {});
    mount.render(<ShareCard data={sample} />);
    expect(button().textContent).toBe('Download card and copy text');
  });

  it('shares, then reports it through the announcer and in plain text', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const announce = vi.fn();
    const { createEnv } = envWith({ share });
    mount.render(<ShareCard data={sample} announce={announce} createEnv={createEnv} />);
    act(() => button().click());
    await flush();
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0]?.[0].text).toContain('Escaped \u201CThe human heart\u201D with 3 ghosts remaining');
    expect(status()).toBe('Shared.');
    expect(announce).toHaveBeenCalledExactlyOnceWith('Shared.');
  });

  it('downloads and copies without the Web Share API, and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const announce = vi.fn();
    const { createEnv, download } = envWith({ clipboard: { writeText } });
    mount.render(<ShareCard data={notes} announce={announce} createEnv={createEnv} />);
    act(() => button().click());
    await flush();
    expect(download).toHaveBeenCalledExactlyOnceWith(PNG, 'escape-the-crypt-card.png');
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain('Escaped a crypt made from my own notes');
    expect(status()).toBe('Card downloaded and text copied.');
    expect(announce).toHaveBeenCalledExactlyOnceWith('Card downloaded and text copied.');
  });

  it('says nothing when the learner closes the share sheet', async () => {
    const announce = vi.fn();
    const closed = Object.assign(new Error('closed'), { name: 'AbortError' });
    const { createEnv } = envWith({ share: vi.fn().mockRejectedValue(closed) });
    mount.render(<ShareCard data={sample} announce={announce} createEnv={createEnv} />);
    act(() => button().click());
    await flush();
    expect(status()).toBe('');
    expect(announce).not.toHaveBeenCalled();
  });

  it('reports a failure kindly, and the button works again', async () => {
    const announce = vi.fn();
    const { createEnv, download } = envWith({});
    download.mockImplementation(() => {
      throw new Error('blocked');
    });
    mount.render(<ShareCard data={sample} announce={announce} createEnv={createEnv} />);
    act(() => button().click());
    await flush();
    expect(status()).toBe("We couldn't share this time. Try again.");
    expect(announce).toHaveBeenCalledExactlyOnceWith("We couldn't share this time. Try again.");
    expect(button().getAttribute('aria-disabled')).toBe('false');
  });

  it('marks the button busy while the card is being made, ignores a second press, and keeps focus on it', async () => {
    let finish: (blob: Blob | null) => void = () => undefined;
    const download = vi.fn();
    let makes = 0;
    const createEnv = (): ShareEnv => ({
      nav: {},
      makePng: () => {
        makes += 1;
        return new Promise((resolve) => (finish = resolve));
      },
      makeFile: () => ({}) as File,
      download,
    });
    mount.render(<ShareCard data={sample} createEnv={createEnv} />);
    button().focus();
    act(() => button().click());
    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(button().disabled).toBe(false);
    act(() => button().click());
    expect(makes).toBe(1);
    await act(async () => finish(null));
    expect(button().getAttribute('aria-disabled')).toBe('false');
    expect(document.activeElement).toBe(button());
  });
});

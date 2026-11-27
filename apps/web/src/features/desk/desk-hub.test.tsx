import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useMount } from '../../test-support/flow-dom';
import { DeskHub } from './desk-hub';
import { SAMPLE_LIST } from './sample-list';
import type { ShelfEntry } from './shelf-entry';

const DAY = new Date(2026, 10, 27, 12).getTime();
const VIEWPORT = { width: 1280, height: 720 };

function entry(n: number, extra: Partial<ShelfEntry> = {}): ShelfEntry {
  return {
    manifestId: `crypt-${n}`,
    runId: `run-${n}`,
    status: 'active',
    createdAt: DAY - n * 86_400_000,
    source: 'generated',
    roomCount: 3,
    ...extra,
  };
}

function hub(shelf: readonly ShelfEntry[], extra: Partial<React.ComponentProps<typeof DeskHub>> = {}): React.JSX.Element {
  return <DeskHub shelf={shelf} samples={SAMPLE_LIST} bringHref="/ingest" onPlaySample={() => undefined} viewport={VIEWPORT} {...extra} />;
}

const text = (root: ParentNode): string => root.textContent ?? '';
const spines = (root: ParentNode): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.book-spine'));

describe('DeskHub', () => {
  const mount = useMount();

  it('has one h1 and a Bring your notes link to the ingest route', () => {
    mount.render(hub([]));
    expect(mount.container.querySelectorAll('h1')).toHaveLength(1);
    expect(mount.container.querySelector('h1')?.textContent).toBe('Escape the Crypt');
    const link = Array.from(mount.container.querySelectorAll('a')).find((a) => a.textContent === 'Bring your notes');
    expect(link?.getAttribute('href')).toBe('/ingest');
    expect(mount.container.querySelectorAll('main')).toHaveLength(1);
  });

  it('says so when no crypt is saved, and shows no book card', () => {
    mount.render(hub([]));
    expect(mount.container.querySelector('[data-testid="shelf-empty"]')?.textContent).toBe(
      'No crypts on this device yet. Bring your notes to start one.',
    );
    expect(mount.container.querySelector('[data-testid="book-card"]')).toBeNull();
    expect(spines(mount.container)).toHaveLength(0);
  });

  it('offers all three sample crypts with the Sample crypt label and no review label', () => {
    const played = vi.fn();
    mount.render(hub([], { onPlaySample: played }));
    const buttons = Array.from(mount.container.querySelectorAll<HTMLButtonElement>('.sample-shelf__button'));
    expect(buttons.map((b) => b.querySelector('span')?.textContent)).toEqual([
      'Enter the crypt: The human heart',
      'Enter the crypt: How HTTPS keeps a connection private',
      'Enter the crypt: The printing press',
    ]);
    for (const button of buttons) expect(button.textContent).toContain('Sample crypt');
    expect(text(mount.container)).not.toMatch(/human-reviewed/i);
    act(() => buttons[1]?.click());
    expect(played).toHaveBeenCalledExactlyOnceWith('https');
  });

  it('shows a book per saved crypt, newest first, with the first selected', () => {
    mount.render(hub([entry(2), entry(0), entry(1)].sort((a, b) => b.createdAt - a.createdAt)));
    const all = spines(mount.container);
    expect(all).toHaveLength(3);
    expect(all.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(all[0]?.textContent).toContain('Crypt from your notes');
    expect(all[0]?.textContent).toContain('27 Nov 2026');
    expect(all[0]?.textContent).toContain('3 rooms');
    expect(all[0]?.textContent).toContain('In progress');
    expect(all[0]?.textContent).toContain('selected');
  });

  it('gives every spine picture empty alt text and the label as real text', () => {
    mount.render(hub([entry(0), entry(1), entry(2), entry(3), entry(4)]));
    const pictures = Array.from(mount.container.querySelectorAll<HTMLImageElement>('.book-spine__art'));
    expect(pictures.map((p) => p.getAttribute('src'))).toEqual([
      '/art/desk/books/book-1.webp',
      '/art/desk/books/book-2.webp',
      '/art/desk/books/book-3.webp',
      '/art/desk/books/book-4.webp',
      '/art/desk/books/book-1.webp',
    ]);
    for (const picture of pictures) expect(picture.getAttribute('alt')).toBe('');
  });

  it('selects another book on click and asks the host for that book’s actions', () => {
    const actions = vi.fn((e: ShelfEntry) => <button type="button">{`act ${e.manifestId}`}</button>);
    mount.render(hub([entry(0), entry(1)], { renderBookActions: actions }));
    expect(mount.container.querySelector('[data-testid="book-card"]')?.textContent).toContain('act crypt-0');
    act(() => spines(mount.container)[1]?.click());
    expect(spines(mount.container).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    expect(mount.container.querySelector('[data-testid="book-card"]')?.textContent).toContain('act crypt-1');
  });

  it('shows a review-due count only when one is known', () => {
    mount.render(hub([entry(0, { dueConceptCount: 2 }), entry(1)]));
    const [first, second] = spines(mount.container);
    expect(first?.textContent).toContain('Review due: 2');
    expect(second?.textContent).not.toContain('Review due');
    mount.render(hub([entry(0, { dueConceptCount: 0 })]));
    expect(text(mount.container)).not.toContain('Review due');
  });

  it('names each state in words, not by colour or icon alone', () => {
    mount.render(hub([entry(0, { status: 'escaped' }), entry(1, { status: 'left' })]));
    const [escaped, left] = spines(mount.container);
    expect(escaped?.textContent).toContain('Escaped');
    expect(left?.textContent).toContain('Not finished');
    for (const icon of Array.from(mount.container.querySelectorAll('.book-status-icon'))) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('keeps six books on the stack and puts the rest behind a disclosure', () => {
    mount.render(hub(Array.from({ length: 8 }, (_, n) => entry(n))));
    const details = mount.container.querySelector('details');
    expect(details?.querySelector('summary')?.textContent).toBe('More crypts (2)');
    expect(details?.querySelectorAll('.book-spine')).toHaveLength(2);
    expect(mount.container.querySelectorAll('.book-stack__list > li')).toHaveLength(8);
  });

  it('owns no live region of its own', () => {
    mount.render(hub([entry(0)]));
    expect(mount.container.querySelectorAll('[aria-live], [role="status"], [role="alert"]')).toHaveLength(0);
  });

  it('draws the desk art as decoration only', () => {
    mount.render(hub([]));
    const stage = mount.container.querySelector('.desk-scene__stage');
    expect(stage?.getAttribute('aria-hidden')).toBe('true');
    for (const image of Array.from(stage?.querySelectorAll('img') ?? [])) expect(image.getAttribute('alt')).toBe('');
    expect(stage?.querySelector('button, a, input')).toBeNull();
  });
});

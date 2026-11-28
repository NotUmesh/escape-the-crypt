import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CONFLICT_NOTICE_COPY, ROOM_PLAY_LABELS, conflictLeftOut, conflictNext, conflictPassage } from '@escape-the-crypt/core';
import type { State } from '@escape-the-crypt/core';
import { useMount } from '../../test-support/flow-dom';
import type { CryptNotices } from '../generate/generated-notices';
import { ConflictNotice, RunConflictNotice } from './conflict-notice';

const BOTH: CryptNotices = {
  leftOut: [
    {
      conceptId: 'c1',
      title: 'How long the Moon takes to orbit',
      passages: [
        { quote: 'The Moon takes about 27 days to orbit Earth.', citationLabel: 'Paragraph 4 of your notes' },
        { quote: 'One orbit of the Moon around Earth takes about 35 days.', citationLabel: 'Paragraph 7 of your notes' },
      ],
    },
  ],
};

describe('ConflictNotice', () => {
  const mount = useMount();
  const render = (notices: CryptNotices = BOTH, ready = true) => {
    const announce = vi.fn();
    mount.render(<ConflictNotice notices={notices} announce={announce} ready={ready} />);
    return announce;
  };
  const text = (): string => mount.container.textContent ?? '';

  it('says what was left out in the sentence from core, then what to do next', () => {
    render();
    expect(text()).toContain(CONFLICT_NOTICE_COPY.heading);
    expect(text()).toContain(conflictLeftOut('How long the Moon takes to orbit'));
    expect(text()).toContain(conflictNext);
  });

  it('is one notice in one named region, with no live role of its own', () => {
    render();
    expect(mount.container.querySelectorAll('section')).toHaveLength(1);
    const section = mount.container.querySelector('section');
    expect(section?.getAttribute('aria-labelledby')).toBe(mount.container.querySelector('h2')?.id);
    expect(mount.container.querySelectorAll('[aria-live], [role="status"], [role="alert"]')).toHaveLength(0);
  });

  it('keeps both passages behind a closed "Show passages" disclosure', () => {
    render();
    const details = mount.container.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe(CONFLICT_NOTICE_COPY.showPassages);
    // The accessible name starts with the visible words, so a voice control can say them.
    expect(details.querySelector('summary')?.getAttribute('aria-label')).toBe('Show passages, How long the Moon takes to orbit');
    act(() => {
      details.open = true;
    });
    const quotes = Array.from(details.querySelectorAll('blockquote')).map((q) => q.textContent);
    expect(quotes).toEqual(['The Moon takes about 27 days to orbit Earth.', 'One orbit of the Moon around Earth takes about 35 days.']);
    const captions = Array.from(details.querySelectorAll('figcaption')).map((c) => c.textContent);
    expect(captions).toEqual([
      `${conflictPassage(1)} \u00B7 Paragraph 4 of your notes \u00B7 ${ROOM_PLAY_LABELS.excerptMatched}`,
      `${conflictPassage(2)} \u00B7 Paragraph 7 of your notes \u00B7 ${ROOM_PLAY_LABELS.excerptMatched}`,
    ]);
  });

  it('offers no disclosure for a topic whose passages did not check out against the notes', () => {
    render({ leftOut: [{ conceptId: 'c1', title: 'Tides', passages: [] }] });
    expect(text()).toContain(conflictLeftOut('Tides'));
    expect(mount.container.querySelector('details')).toBeNull();
  });

  it('lists several topics in the one notice, each with its own disclosure', () => {
    render({ leftOut: [...BOTH.leftOut, { ...(BOTH.leftOut[0] as CryptNotices['leftOut'][number]), conceptId: 'c2', title: 'Spring tides' }] });
    expect(mount.container.querySelectorAll('[data-testid="conflict-notice-item"]')).toHaveLength(2);
    expect(mount.container.querySelectorAll('details')).toHaveLength(2);
    expect(mount.container.querySelectorAll('section')).toHaveLength(1);
  });

  it('shows everything as plain text: markup in a title or a quote makes no element', () => {
    const hostile = '<img src=x onerror=alert(1)><script>boom()</script>';
    render({ leftOut: [{ conceptId: 'c1', title: hostile, passages: [{ quote: hostile, citationLabel: 'Paragraph 1 of your notes' }, { quote: hostile, citationLabel: 'Paragraph 2 of your notes' }] }] });
    expect(mount.container.querySelector('img, script')).toBeNull();
    expect(text()).toContain(hostile);
  });

  it('reads once through the announcer, only when ready, and not again on a re-render', () => {
    const announce = vi.fn();
    mount.render(<ConflictNotice notices={BOTH} announce={announce} ready={false} />);
    expect(announce).not.toHaveBeenCalled();
    mount.render(<ConflictNotice notices={BOTH} announce={announce} ready />);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(conflictLeftOut('How long the Moon takes to orbit'));
    mount.render(<ConflictNotice notices={{ ...BOTH }} announce={announce} ready />);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('reads every topic in one message when several were left out', () => {
    const announce = render({ leftOut: [BOTH.leftOut[0] as CryptNotices['leftOut'][number], { conceptId: 'c2', title: 'Spring tides', passages: [] }] });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(`${conflictLeftOut('How long the Moon takes to orbit')} ${conflictLeftOut('Spring tides')}`);
  });
});

describe('RunConflictNotice', () => {
  const mount = useMount();
  const held = { manifestId: 'm-1', notices: BOTH };
  const stateOf = (manifestId: string, status = 'in progress'): State => ({ manifest: { manifestId }, status }) as unknown as State;
  const shows = (props: Partial<React.ComponentProps<typeof RunConflictNotice>>): boolean => {
    mount.render(<RunConflictNotice held={held} state={stateOf('m-1')} running announce={vi.fn()} ready {...props} />);
    return mount.container.querySelector('[data-testid="conflict-notice"]') !== null;
  };

  it('shows while the crypt it belongs to is being played', () => {
    expect(shows({})).toBe(true);
  });

  it('is hidden for another crypt, before a run, with nothing held, and after the escape', () => {
    expect(shows({ state: stateOf('another-crypt') })).toBe(false);
    expect(shows({ running: false })).toBe(false);
    expect(shows({ state: null })).toBe(false);
    expect(shows({ held: null })).toBe(false);
    expect(shows({ state: stateOf('m-1', 'escaped') })).toBe(false);
  });
});

import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { useMount } from '../../test-support/flow-dom';
import type { RoomAction } from '../../state/room-actions';
import { QuestionControls } from './question-controls';

function buttons(container: HTMLElement): Record<string, HTMLButtonElement> {
  const out: Record<string, HTMLButtonElement> = {};
  for (const b of Array.from(container.querySelectorAll('button'))) out[b.textContent ?? ''] = b;
  return out;
}

describe('QuestionControls', () => {
  const mount = useMount();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup(over: { remainingHints?: number; hintApplied?: boolean } = {}) {
    const dispatch = vi.fn<(a: RoomAction) => void>();
    const onClose = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    mount.render(
      createElement(QuestionControls, {
        slotId: 's1',
        remainingHints: over.remainingHints ?? 2,
        hintApplied: over.hintApplied ?? false,
        dispatch,
        onClose,
      }),
    );
    return { dispatch, onClose, fetchSpy };
  }

  it('Hint dispatches useHint and shows the remaining count', () => {
    const { dispatch } = setup();
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.hintsLeft(2));
    expect(mount.container.querySelector('.question-controls__count svg[aria-hidden="true"] [data-lit]')).not.toBeNull();
    act(() => buttons(mount.container)[ROOM_PLAY_LABELS.hint]?.click());
    expect(dispatch).toHaveBeenCalledWith({ type: 'useHint', slotId: 's1' });
  });

  it('disables Hint and says "No hints left" at 0', () => {
    const { dispatch } = setup({ remainingHints: 0 });
    const hint = buttons(mount.container)[ROOM_PLAY_LABELS.hint];
    expect(hint?.disabled).toBe(true);
    expect(hint?.getAttribute('aria-disabled')).toBe('true');
    expect(mount.container.querySelector('.question-controls__count svg [data-lit]')).toBeNull();
    expect(mount.container.textContent).toContain('No hints left');
    act(() => hint?.click());
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('disables Hint while the question has an applied hint', () => {
    setup({ hintApplied: true });
    expect(buttons(mount.container)[ROOM_PLAY_LABELS.hint]?.disabled).toBe(true);
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.hintsLeft(2));
  });

  it('Skip dispatches skip and closes the panel', () => {
    const { dispatch, onClose } = setup();
    act(() => buttons(mount.container)[ROOM_PLAY_LABELS.skip]?.click());
    expect(dispatch).toHaveBeenCalledWith({ type: 'skip', slotId: 's1' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Challenge dispatches challenge, shows the no-penalty line and calls no server', () => {
    const { dispatch, onClose, fetchSpy } = setup();
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.noPenalty);
    act(() => buttons(mount.container)[ROOM_PLAY_LABELS.challenge]?.click());
    expect(dispatch).toHaveBeenCalledWith({ type: 'challenge', slotId: 's1' });
    expect(onClose).not.toHaveBeenCalled();
    act(() => buttons(mount.container)[ROOM_PLAY_LABELS.skip]?.click());
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

import { act } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { CryptContent } from '@escape-the-crypt/core';
import { buttonByText, useMount } from '../../test-support/flow-dom';
import type { RoomAction } from '../../state/room-actions';
import { LockPanelContext } from './lock-panel-context';
import type { LockPanelContextValue } from './lock-panel-context';
import { SeanceBoardPanel } from './seance-board-panel';

type AppliedHintState = NonNullable<ReturnType<LockPanelContextValue['appliedHintFor']>>;

const CONTENT: CryptContent = {
  questions: {
    q1: {
      prompt: 'According to your notes, what carries blood to the body?',
      options: { optZ: 'The aorta', optA: 'The vena cava', optM: 'The valve' },
      excerpts: [{ chunkId: 'c1', quote: 'q' }],
      explanation: '',
    },
  },
  concepts: {},
};

function panel(dispatch: (a: RoomAction) => void, hint: AppliedHintState | null = null): ReactNode {
  return (
    <LockPanelContext.Provider value={{ dispatch, rejection: null, content: CONTENT, appliedHintFor: () => hint }}>
      <SeanceBoardPanel slotId="s1" questionId="q1" questionType="seance-board" />
    </LockPanelContext.Provider>
  );
}

function radios(c: ParentNode): HTMLInputElement[] {
  return Array.from(c.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
}

function key(target: Element, k: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
}

describe('SeanceBoardPanel', () => {
  const mount = useMount();

  it('shows the prompt and options in payload order inside a labelled group', () => {
    mount.render(panel(vi.fn()));
    expect(mount.container.textContent).toContain('According to your notes');
    expect(radios(mount.container).map((r) => r.value)).toEqual(['optZ', 'optA', 'optM']);
    const group = mount.container.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.seanceGroupLabel);
  });

  it('dispatches nothing and asks for a choice when none is made', () => {
    const dispatch = vi.fn();
    mount.render(panel(dispatch));
    act(() => buttonByText(mount.container, ROOM_PLAY_LABELS.submitAnswer).click());
    expect(dispatch).not.toHaveBeenCalled();
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.chooseOption);
  });

  it('chooses with arrow keys only and submits the selected option id', () => {
    const dispatch = vi.fn();
    mount.render(panel(dispatch));
    const first = radios(mount.container)[0] as HTMLInputElement;
    first.focus();
    key(first, 'ArrowDown');
    expect(radios(mount.container)[0]?.checked).toBe(true);
    key(document.activeElement as Element, 'ArrowDown');
    expect(radios(mount.container)[1]?.checked).toBe(true);
    expect(document.activeElement).toBe(radios(mount.container)[1]);
    key(document.activeElement as Element, 'ArrowUp');
    key(document.activeElement as Element, 'ArrowUp');
    expect(radios(mount.container)[2]?.checked).toBe(true);
    act(() => buttonByText(mount.container, ROOM_PLAY_LABELS.submitAnswer).click());
    expect(dispatch).toHaveBeenCalledWith({
      type: 'submitAnswer',
      slotId: 's1',
      submission: { selectedOptionId: 'optM' },
    });
  });

  it('renders the unplayable message without a provider', () => {
    mount.render(<SeanceBoardPanel slotId="s1" questionId="q1" questionType="seance-board" />);
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.unplayableType);
    expect(radios(mount.container)).toHaveLength(0);
  });

  it('labels and disables the removed option, and arrows skip it', () => {
    mount.render(panel(vi.fn(), { questionId: 'q1', effect: { kind: 'remove-option', optionId: 'optA' } }));
    const [z, a, m] = radios(mount.container);
    expect(a?.disabled).toBe(true);
    expect(z?.disabled).toBe(false);
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.removedByHint);
    z?.focus();
    key(z as Element, 'ArrowDown');
    key(document.activeElement as Element, 'ArrowDown');
    expect(m?.checked).toBe(true);
  });
});

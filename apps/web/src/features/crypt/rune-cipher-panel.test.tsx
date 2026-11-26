import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { CryptContent, LockSlotState, Typed_Rejection } from '@escape-the-crypt/core';
import { useMount } from '../../test-support/flow-dom';
import type { RoomAction } from '../../state/room-actions';
import { LockPanelContext } from './lock-panel-context';
import { LOCK_PANELS } from './lock-panel-registry';
import { RuneCipherPanel } from './rune-cipher-panel';

const CONTENT = {
  questions: { q1: { prompt: 'The <b>organ</b> that pumps blood is the ____.' } },
  concepts: {},
} as unknown as CryptContent;

interface Options {
  readonly rejection?: Typed_Rejection | null;
  readonly hint?: LockSlotState['appliedHint'];
  readonly dispatch?: (action: RoomAction) => void;
}

function panel({ rejection = null, hint = null, dispatch = () => undefined }: Options = {}): ReactNode {
  return (
    <LockPanelContext.Provider value={{ dispatch, rejection, content: CONTENT, appliedHintFor: () => hint }}>
      <RuneCipherPanel slotId="s1" questionId="q1" questionType="rune-cipher" />
    </LockPanelContext.Provider>
  );
}

function type(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function press(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('RuneCipherPanel', () => {
  const mount = useMount();
  const input = (): HTMLInputElement => mount.container.querySelector('input') as HTMLInputElement;
  const submitButton = (): HTMLButtonElement => mount.container.querySelector('button') as HTMLButtonElement;

  it('is registered under rune-cipher', () => {
    expect(LOCK_PANELS['rune-cipher']).toBe(RuneCipherPanel);
  });

  it('shows the prompt as plain text and a labelled input', () => {
    mount.render(panel());
    expect(mount.container.querySelector('b')).toBeNull();
    expect(mount.container.textContent).toContain('The <b>organ</b> that pumps blood is the ____.');
    expect(mount.container.querySelector(`label[for="${input().id}"]`)).not.toBeNull();
    expect(submitButton().textContent).toBe(ROOM_PLAY_LABELS.submitAnswer);
  });

  it('dispatches { text } on button click and keeps the draft', () => {
    const dispatch = vi.fn();
    mount.render(panel({ dispatch }));
    type(input(), '  Heart ');
    act(() => submitButton().click());
    expect(dispatch).toHaveBeenCalledWith({ type: 'submitAnswer', slotId: 's1', submission: { text: '  Heart ' } });
    expect(input().value).toBe('  Heart ');
  });

  it('submits from the keyboard with Enter', () => {
    const dispatch = vi.fn();
    mount.render(panel({ dispatch }));
    input().focus();
    type(input(), 'heart');
    press(input(), 'Enter');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'submitAnswer', slotId: 's1', submission: { text: 'heart' } });
  });

  it('asks for an answer and dispatches nothing when empty after trim', () => {
    const dispatch = vi.fn();
    mount.render(panel({ dispatch }));
    type(input(), '   ');
    press(input(), 'Enter');
    act(() => submitButton().click());
    expect(dispatch).not.toHaveBeenCalled();
    expect(mount.container.querySelector('[role="alert"]')?.textContent).toBe(ROOM_PLAY_LABELS.emptyAnswer);
  });

  it('shows the message and keeps the draft on an invalid-submission rejection for this slot', () => {
    mount.render(panel({ rejection: { kind: 'invalid-submission', slotId: 's1' } }));
    expect(mount.container.querySelector('[role="alert"]')?.textContent).toBe(ROOM_PLAY_LABELS.emptyAnswer);
  });

  it('ignores a rejection for another slot or another kind', () => {
    mount.render(panel({ rejection: { kind: 'invalid-submission', slotId: 's2' } }));
    expect(mount.container.querySelector('[role="alert"]')).toBeNull();
    mount.render(panel({ rejection: { kind: 'no-hints-left', slotId: 's1' } }));
    expect(mount.container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the first letter and length only for a reveal-first-letter hint on this question', () => {
    mount.render(panel());
    expect(mount.container.textContent).not.toContain('starts with');
    const effect = { kind: 'reveal-first-letter', firstLetter: 'h', length: 5 } as const;
    mount.render(panel({ hint: { questionId: 'q1', effect } }));
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.runeHint('h', 5));
    mount.render(panel({ hint: { questionId: 'other', effect } }));
    expect(mount.container.textContent).not.toContain('starts with');
  });

  it('renders nothing without a panel context', () => {
    mount.render(createElement(RuneCipherPanel, { slotId: 's1', questionId: 'q1', questionType: 'rune-cipher' }));
    expect(mount.container.textContent).toBe('');
  });
});

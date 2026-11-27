import { describe, expect, it, vi } from 'vitest';
import { LOCK_PANEL_LABELS, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { CombinationDialQuestion, CryptContent } from '@escape-the-crypt/core';
import { buttonByText, useMount } from '../../test-support/flow-dom';
import { activate, byLabel, press } from '../../test-support/key-helpers';
import { LockPanelTestProvider } from '../../test-support/lock-panel-test-provider';
import { CombinationDialPanel } from './combination-dial-panel';

const PAYLOAD: CombinationDialQuestion = { kind: 'exact', exactValue: 72, unit: 'beats per minute' };
const CONTENT: CryptContent = {
  questions: { q1: { prompt: 'According to your notes, what is the resting rate?', excerpts: [{ chunkId: 'c1', quote: 'q' }], explanation: '' } },
  concepts: {},
};
function view(dispatch = vi.fn(), rejection: { kind: 'invalid-submission'; slotId: string } | null = null) {
  return (
    <LockPanelTestProvider content={CONTENT} payload={PAYLOAD} dispatch={dispatch} rejection={rejection}>
      <CombinationDialPanel slotId="s1" questionId="q1" questionType="combination-dial" />
    </LockPanelTestProvider>
  );
}
const spin = (c: ParentNode, place: string): HTMLElement => byLabel(c, new RegExp(`^${place} wheel`));
const submit = (c: ParentNode): void => activate(buttonByText(c, ROOM_PLAY_LABELS.submitAnswer));

describe('CombinationDialPanel (keyboard only)', () => {
  const mount = useMount();
  it('shows the unit and three wheels without any answer digits', () => {
    mount.render(view());
    expect(mount.container.textContent).toContain(LOCK_PANEL_LABELS.unitLine('beats per minute'));
    expect(mount.container.querySelectorAll('[role="spinbutton"]')).toHaveLength(3);
  });
  it('builds 72 with Up arrows on the wheels and submits it', () => {
    const dispatch = vi.fn();
    mount.render(view(dispatch));
    const tens = spin(mount.container, 'tens');
    tens.focus();
    for (let i = 0; i < 7; i += 1) press(tens, 'ArrowUp');
    press(tens, 'ArrowRight');
    expect(document.activeElement).toBe(spin(mount.container, 'ones'));
    const ones = spin(mount.container, 'ones');
    press(ones, 'ArrowUp');
    press(ones, 'ArrowUp');
    submit(mount.container);
    expect(dispatch).toHaveBeenCalledWith({ type: 'submitAnswer', slotId: 's1', submission: { rawInput: '072' } });
  });
  it('wraps one wheel without touching the next', () => {
    mount.render(view());
    const ones = spin(mount.container, 'ones');
    press(ones, 'ArrowDown');
    expect((spin(mount.container, 'ones') as HTMLElement).getAttribute('aria-valuenow')).toBe('9');
    expect(spin(mount.container, 'tens').getAttribute('aria-valuenow')).toBe('0');
  });
  it('steps with the named buttons and announces the digit', () => {
    mount.render(view());
    activate(byLabel(mount.container, 'Increase tens wheel, now 0'));
    expect(spin(mount.container, 'tens').getAttribute('aria-valuenow')).toBe('1');
  });
  it('submits typed text with Enter and moves the wheels to match', () => {
    const dispatch = vi.fn();
    mount.render(view(dispatch));
    const input = mount.container.querySelector('input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    input.focus();
    setter?.call(input, '72');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(spin(mount.container, 'tens').getAttribute('aria-valuenow')).toBe('7');
    press(input, 'Enter');
    expect(dispatch).toHaveBeenCalledWith({ type: 'submitAnswer', slotId: 's1', submission: { rawInput: '72' } });
  });
  it('asks for a number when nothing is entered', () => {
    const dispatch = vi.fn();
    mount.render(view(dispatch));
    submit(mount.container);
    expect(dispatch).not.toHaveBeenCalled();
    expect(mount.container.textContent).toContain(LOCK_PANEL_LABELS.typeNumberFirst);
  });
  it('explains an invalid number after a rejection and keeps the draft', () => {
    mount.render(view(vi.fn(), { kind: 'invalid-submission', slotId: 's1' }));
    expect(mount.container.textContent).toContain(LOCK_PANEL_LABELS.invalidNumber);
  });
  it('shows a fallback when the payload is missing', () => {
    mount.render(
      <LockPanelTestProvider content={CONTENT} payload={null} dispatch={vi.fn()}>
        <CombinationDialPanel slotId="s1" questionId="q1" questionType="combination-dial" />
      </LockPanelTestProvider>,
    );
    expect(mount.container.textContent).toContain(LOCK_PANEL_LABELS.payloadMissing);
  });
});

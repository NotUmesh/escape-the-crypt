import { describe, expect, it, vi } from 'vitest';
import { LOCK_PANEL_LABELS, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { CryptContent, CursedObjectQuestion } from '@escape-the-crypt/core';
import { buttonByText, useMount } from '../../test-support/flow-dom';
import { activate, press } from '../../test-support/key-helpers';
import { LockPanelTestProvider } from '../../test-support/lock-panel-test-provider';
import { CursedObjectPanel } from './cursed-object-panel';

const PAYLOAD: CursedObjectQuestion = { optionIds: ['o1', 'o2', 'o3', 'o4'], oddOneOutId: 'o3' };
const CONTENT: CryptContent = {
  questions: {
    q1: {
      prompt: 'According to your notes, which does not belong?',
      options: { o1: 'Atrium', o2: 'Ventricle', o3: 'Femur', o4: 'Valve' },
      excerpts: [{ chunkId: 'c1', quote: 'q' }],
      explanation: '',
    },
  },
  concepts: {},
};
function view(dispatch = vi.fn(), removed: string | null = null, announce = vi.fn()) {
  return (
    <LockPanelTestProvider
      content={CONTENT}
      payload={PAYLOAD}
      dispatch={dispatch}
      announce={announce}
      appliedHint={removed === null ? null : { questionId: 'q1', effect: { kind: 'remove-option', optionId: removed } }}
    >
      <CursedObjectPanel slotId="s1" questionId="q1" questionType="cursed-object" />
    </LockPanelTestProvider>
  );
}
const radios = (c: ParentNode): HTMLInputElement[] => Array.from(c.querySelectorAll<HTMLInputElement>('input[type="radio"]'));

describe('CursedObjectPanel (keyboard only)', () => {
  const mount = useMount();
  it('asks for a choice before submitting', () => {
    const dispatch = vi.fn();
    mount.render(view(dispatch));
    activate(buttonByText(mount.container, ROOM_PLAY_LABELS.submitAnswer));
    expect(dispatch).not.toHaveBeenCalled();
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.chooseOption);
  });
  it('chooses with arrow keys and submits the selected id', () => {
    const dispatch = vi.fn();
    mount.render(view(dispatch));
    const group = mount.container.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(group.textContent).toContain(LOCK_PANEL_LABELS.cursedGroupLabel);
    const first = radios(mount.container)[0] as HTMLInputElement;
    first.focus();
    press(first, 'ArrowDown');
    const chosen = radios(mount.container).find((r) => r.checked) as HTMLInputElement;
    expect(chosen).toBeDefined();
    activate(buttonByText(mount.container, ROOM_PLAY_LABELS.submitAnswer));
    expect(dispatch).toHaveBeenCalledWith({ type: 'submitAnswer', slotId: 's1', submission: { selectedId: chosen.value } });
  });
  it('submits the odd item when it is chosen', () => {
    const dispatch = vi.fn();
    mount.render(view(dispatch));
    const odd = radios(mount.container).find((r) => r.value === 'o3') as HTMLInputElement;
    activate(odd);
    activate(buttonByText(mount.container, ROOM_PLAY_LABELS.submitAnswer));
    expect(dispatch).toHaveBeenCalledWith({ type: 'submitAnswer', slotId: 's1', submission: { selectedId: 'o3' } });
  });
  it('disables the removed item and skips it with the arrows', () => {
    mount.render(view(vi.fn(), 'o2'));
    const removed = radios(mount.container).find((r) => r.value === 'o2') as HTMLInputElement;
    expect(removed.disabled).toBe(true);
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.removedByHint);
    const group = mount.container.querySelector('[role="radiogroup"]') as HTMLElement;
    for (let i = 0; i < 6; i += 1) {
      press(group, 'ArrowDown');
      expect(radios(mount.container).find((r) => r.checked)?.value).not.toBe('o2');
    }
  });
  it('takes a hint used after the panel opened: removes the item, clears a choice on it, and announces it', () => {
    const announce = vi.fn();
    const dispatch = vi.fn();
    mount.render(view(dispatch, null, announce));
    activate(radios(mount.container).find((r) => r.value === 'o2') as HTMLInputElement);
    expect(radios(mount.container).find((r) => r.value === 'o2')?.checked).toBe(true);
    mount.render(view(dispatch, 'o2', announce));
    const removed = radios(mount.container).find((r) => r.value === 'o2') as HTMLInputElement;
    expect(removed.disabled).toBe(true);
    expect(removed.checked).toBe(false);
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.removedByHint);
    expect(announce).toHaveBeenCalledWith(LOCK_PANEL_LABELS.itemHinted('Ventricle'));
    activate(buttonByText(mount.container, ROOM_PLAY_LABELS.submitAnswer));
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('shows a fallback when the payload is missing', () => {
    mount.render(
      <LockPanelTestProvider content={CONTENT} payload={undefined} dispatch={vi.fn()}>
        <CursedObjectPanel slotId="s1" questionId="q1" questionType="cursed-object" />
      </LockPanelTestProvider>,
    );
    expect(mount.container.textContent).toContain(LOCK_PANEL_LABELS.payloadMissing);
  });
});

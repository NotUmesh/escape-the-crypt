import { describe, expect, it, vi } from 'vitest';
import { ROOM_PLAY_LABELS, LOCK_PANEL_LABELS } from '@escape-the-crypt/core';
import type { BoneOrderingQuestion, CryptContent } from '@escape-the-crypt/core';
import { buttonByText, useMount } from '../../test-support/flow-dom';
import { activate, byLabel, press } from '../../test-support/key-helpers';
import { LockPanelTestProvider } from '../../test-support/lock-panel-test-provider';
import { BoneOrderingPanel } from './bone-ordering-panel';

const PAYLOAD: BoneOrderingQuestion = {
  itemIds: ['b1', 'b2', 'b3', 'b4'],
  keyOrder: ['b1', 'b2', 'b3', 'b4'],
};
const TEXTS: Record<string, string> = { b1: 'Collect the notes', b2: 'Plan the essay', b3: 'Write a draft', b4: 'Revise it' };
const CONTENT: CryptContent = {
  questions: {
    q1: {
      prompt: 'According to your notes, put the steps in order.',
      options: TEXTS,
      excerpts: [{ chunkId: 'c1', quote: 'q' }],
      explanation: '',
    },
  },
  concepts: {},
};
function view(dispatch = vi.fn(), announce = vi.fn(), pinned: string | null = null) {
  return (
    <LockPanelTestProvider
      content={CONTENT}
      payload={PAYLOAD}
      dispatch={dispatch}
      announce={announce}
      appliedHint={pinned === null ? null : { questionId: 'q1', effect: { kind: 'lock-first-bone', boneId: pinned } }}
    >
      <BoneOrderingPanel slotId="s1" questionId="q1" questionType="bone-ordering" />
    </LockPanelTestProvider>
  );
}
function rows(c: ParentNode): HTMLElement[] {
  return Array.from(c.querySelectorAll<HTMLElement>('.bone-ordering-panel__row'));
}
function shownOrder(c: ParentNode): string[] {
  return rows(c).map((r) => r.querySelector('.bone-ordering-panel__text')?.textContent ?? '');
}
const idOf = (text: string): string => Object.entries(TEXTS).find(([, t]) => t === text)?.[0] ?? '';
/** Alt+Arrow only: moves each bone to its key place. */
function arrange(c: ParentNode): void {
  PAYLOAD.keyOrder.forEach((id, target) => {
    for (let guard = 0; guard < 20; guard += 1) {
      const at = shownOrder(c).indexOf(TEXTS[id] ?? '');
      if (at <= target) break;
      const row = rows(c)[at] as HTMLElement;
      press(row.querySelector('button') as HTMLElement, 'ArrowUp', { altKey: true });
    }
  });
}

describe('BoneOrderingPanel (keyboard only)', () => {
  const mount = useMount();
  it('does not show the key order before judging', () => {
    mount.render(view());
    expect(shownOrder(mount.container).map(idOf)).not.toEqual(PAYLOAD.keyOrder);
  });
  it('reorders with Alt+Arrow and submits the order', () => {
    const dispatch = vi.fn();
    const announce = vi.fn();
    mount.render(view(dispatch, announce));
    arrange(mount.container);
    expect(shownOrder(mount.container).map(idOf)).toEqual(PAYLOAD.keyOrder);
    expect(announce.mock.calls.some(([m]) => /now \d of 4/.test(String(m)))).toBe(true);
    activate(buttonByText(mount.container, ROOM_PLAY_LABELS.submitAnswer));
    expect(dispatch).toHaveBeenCalledWith({ type: 'submitAnswer', slotId: 's1', submission: { order: PAYLOAD.keyOrder } });
  });
  it('moves with the named buttons, and names them by position', () => {
    mount.render(view());
    const first = shownOrder(mount.container)[0] ?? '';
    const down = byLabel(mount.container, `Move down: ${first}, position 1 of 4`);
    activate(down);
    expect(shownOrder(mount.container)[1]).toBe(first);
    expect(document.activeElement?.getAttribute('aria-label')).toBe(`Move down: ${first}, position 2 of 4`);
  });
  it('moves focus with plain arrows and changes nothing', () => {
    mount.render(view());
    const before = shownOrder(mount.container);
    const firstButton = rows(mount.container)[0]?.querySelector('button') as HTMLElement;
    firstButton.focus();
    press(firstButton, 'ArrowDown');
    expect(shownOrder(mount.container)).toEqual(before);
    expect(rows(mount.container)[1]?.contains(document.activeElement)).toBe(true);
  });
  it('keeps the pinned bone in place and says it is fixed', () => {
    mount.render(view(vi.fn(), vi.fn(), 'b1'));
    expect(shownOrder(mount.container)[0]).toBe(TEXTS['b1']);
    expect(mount.container.textContent).toContain(LOCK_PANEL_LABELS.boneFixed);
    const pinnedUp = rows(mount.container)[0]?.querySelector('button') as HTMLElement;
    expect(pinnedUp.getAttribute('aria-disabled')).toBe('true');
    activate(pinnedUp);
    expect(shownOrder(mount.container)[0]).toBe(TEXTS['b1']);
  });
  it('takes a hint used after the panel opened: fixes the bone, announces it, and submits it in place', () => {
    const dispatch = vi.fn();
    const announce = vi.fn();
    mount.render(view(dispatch, announce));
    // The learner moves a bone first, then asks for the hint.
    const firstBone = rows(mount.container)[0]?.querySelector('button') as HTMLElement;
    activate(firstBone);
    mount.render(view(dispatch, announce, 'b1'));
    expect(shownOrder(mount.container)[0]).toBe(TEXTS['b1']);
    expect(mount.container.textContent).toContain(LOCK_PANEL_LABELS.boneFixed);
    expect(rows(mount.container)[0]?.querySelector('button')?.getAttribute('aria-disabled')).toBe('true');
    expect(announce).toHaveBeenCalledWith(LOCK_PANEL_LABELS.boneHinted(TEXTS['b1'] ?? ''));
    arrange(mount.container);
    activate(buttonByText(mount.container, ROOM_PLAY_LABELS.submitAnswer));
    expect(dispatch).toHaveBeenCalledWith({ type: 'submitAnswer', slotId: 's1', submission: { order: PAYLOAD.keyOrder } });
  });
  it('does not announce a hint that was already applied when the panel opened', () => {
    const announce = vi.fn();
    mount.render(view(vi.fn(), announce, 'b1'));
    mount.render(view(vi.fn(), announce, 'b1'));
    expect(announce).not.toHaveBeenCalled();
  });
  it('shows a fallback when the payload is missing', () => {
    mount.render(
      <LockPanelTestProvider content={CONTENT} payload={null} dispatch={vi.fn()}>
        <BoneOrderingPanel slotId="s1" questionId="q1" questionType="bone-ordering" />
      </LockPanelTestProvider>,
    );
    expect(mount.container.textContent).toContain(LOCK_PANEL_LABELS.payloadMissing);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { LOCK_PANEL_LABELS, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { BoundThreadsQuestion, CryptContent } from '@escape-the-crypt/core';
import { buttonByText, useMount } from '../../test-support/flow-dom';
import { activate, byLabel } from '../../test-support/key-helpers';
import { LockPanelTestProvider } from '../../test-support/lock-panel-test-provider';
import { BoundThreadsPanel } from './bound-threads-panel';

const PAYLOAD: BoundThreadsQuestion = {
  leftIds: ['l1', 'l2', 'l3'],
  rightIds: ['r1', 'r2', 'r3'],
  keyPairs: [['l1', 'r1'], ['l2', 'r2'], ['l3', 'r3']],
};
const OPTIONS: Record<string, string> = {
  l1: 'Aorta', l2: 'Atrium', l3: 'Valve',
  r1: 'Carries blood out', r2: 'Receives blood', r3: 'Keeps flow one way',
};
const CONTENT: CryptContent = {
  questions: {
    q1: { prompt: 'According to your notes, match each part to its job.', options: OPTIONS, excerpts: [{ chunkId: 'c1', quote: 'q' }], explanation: '' },
  },
  concepts: {},
};
function view(dispatch = vi.fn(), hintPair: [string, string] | null = null, announce = vi.fn()) {
  return (
    <LockPanelTestProvider
      content={CONTENT}
      payload={PAYLOAD}
      dispatch={dispatch}
      announce={announce}
      appliedHint={hintPair === null ? null : { questionId: 'q1', effect: { kind: 'tie-thread', pair: hintPair } }}
    >
      <BoundThreadsPanel slotId="s1" questionId="q1" questionType="bound-threads" />
    </LockPanelTestProvider>
  );
}
const left = (c: ParentNode, id: string): HTMLElement => byLabel(c, new RegExp(`^${OPTIONS[id]},`));
const right = (c: ParentNode, id: string): HTMLElement => byLabel(c, new RegExp(`^${OPTIONS[id]},`));
function tie(c: ParentNode, l: string, r: string): void {
  activate(left(c, l));
  activate(right(c, r));
}
const submit = (c: ParentNode): void => activate(buttonByText(c, ROOM_PLAY_LABELS.submitAnswer));

describe('BoundThreadsPanel (keyboard only)', () => {
  const mount = useMount();
  it('ties a correct matching and submits every pair', () => {
    const dispatch = vi.fn();
    mount.render(view(dispatch));
    tie(mount.container, 'l1', 'r1');
    tie(mount.container, 'l2', 'r2');
    tie(mount.container, 'l3', 'r3');
    submit(mount.container);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0]?.[0] as { submission: { pairs: string[][] } };
    expect([...action.submission.pairs].sort()).toEqual([['l1', 'r1'], ['l2', 'r2'], ['l3', 'r3']]);
  });
  it('submits a wrong matching as it was tied', () => {
    const dispatch = vi.fn();
    mount.render(view(dispatch));
    tie(mount.container, 'l1', 'r2');
    tie(mount.container, 'l2', 'r1');
    tie(mount.container, 'l3', 'r3');
    submit(mount.container);
    const action = dispatch.mock.calls[0]?.[0] as { submission: { pairs: string[][] } };
    expect(action.submission.pairs).toContainEqual(['l1', 'r2']);
  });
  it('does not submit while a left item is untied', () => {
    const dispatch = vi.fn();
    mount.render(view(dispatch));
    tie(mount.container, 'l1', 'r1');
    submit(mount.container);
    expect(dispatch).not.toHaveBeenCalled();
    expect(mount.container.textContent).toContain(LOCK_PANEL_LABELS.tieEveryLeft);
  });
  it('asks for a left item first', () => {
    mount.render(view());
    activate(right(mount.container, 'r1'));
    expect(mount.container.textContent).toContain(LOCK_PANEL_LABELS.chooseLeftFirst);
  });
  it('names state, undoes a thread and ties it again', () => {
    const dispatch = vi.fn();
    mount.render(view(dispatch));
    activate(left(mount.container, 'l1'));
    expect(byLabel(mount.container, 'Aorta, selected').getAttribute('aria-pressed')).toBe('true');
    activate(right(mount.container, 'r1'));
    expect(byLabel(mount.container, 'Aorta, tied to Carries blood out')).toBeDefined();
    activate(byLabel(mount.container, 'Undo: Aorta and Carries blood out'));
    expect(byLabel(mount.container, 'Aorta, not tied')).toBeDefined();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Aorta, not tied');
    tie(mount.container, 'l1', 'r3');
    expect(byLabel(mount.container, 'Aorta, tied to Keeps flow one way')).toBeDefined();
  });
  it('refuses a right item that is already tied', () => {
    mount.render(view());
    tie(mount.container, 'l1', 'r1');
    activate(left(mount.container, 'l2'));
    activate(byLabel(mount.container, /^Carries blood out, tied/));
    expect(mount.container.textContent).toContain(LOCK_PANEL_LABELS.rightAlreadyTied);
  });
  it('shows the hinted thread as tied with no Undo', () => {
    mount.render(view(vi.fn(), ['l2', 'r2']));
    expect(mount.container.textContent).toContain(LOCK_PANEL_LABELS.tiedByHint);
    expect(mount.container.querySelector('[aria-label^="Undo"]')).toBeNull();
  });
  it('takes a hint used after the panel opened: unties a crossed thread, ties the pair, announces it and keeps it', () => {
    const dispatch = vi.fn();
    const announce = vi.fn();
    mount.render(view(dispatch, null, announce));
    tie(mount.container, 'l2', 'r1');
    expect(byLabel(mount.container, 'Atrium, tied to Carries blood out')).toBeDefined();
    mount.render(view(dispatch, ['l2', 'r2'], announce));
    expect(byLabel(mount.container, 'Atrium, tied to Receives blood')).toBeDefined();
    expect(byLabel(mount.container, 'Carries blood out, not tied')).toBeDefined();
    expect(mount.container.textContent).toContain(LOCK_PANEL_LABELS.tiedByHint);
    expect(mount.container.querySelector('[aria-label^="Undo"]')).toBeNull();
    expect(announce).toHaveBeenCalledWith(LOCK_PANEL_LABELS.threadHinted('Atrium', 'Receives blood'));
    tie(mount.container, 'l1', 'r1');
    tie(mount.container, 'l3', 'r3');
    submit(mount.container);
    const action = dispatch.mock.calls[0]?.[0] as { submission: { pairs: string[][] } };
    expect([...action.submission.pairs].sort()).toEqual([['l1', 'r1'], ['l2', 'r2'], ['l3', 'r3']]);
  });
  it('shows a fallback when the payload is missing', () => {
    mount.render(
      <LockPanelTestProvider content={CONTENT} payload={null} dispatch={vi.fn()}>
        <BoundThreadsPanel slotId="s1" questionId="q1" questionType="bound-threads" />
      </LockPanelTestProvider>,
    );
    expect(mount.container.textContent).toContain(LOCK_PANEL_LABELS.payloadMissing);
  });
});

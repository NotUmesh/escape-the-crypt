import { act, createElement, createRef, useState } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { useMount } from '../../test-support/flow-dom';
import type { LockPanelRegistry } from './lock-panel-registry';
import { QuestionPanel } from './question-panel';

function DraftPanel(): ReactNode {
  return <input aria-label="draft" />;
}
const PANELS: LockPanelRegistry = { 'rune-cipher': DraftPanel };

function setValue(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function escape(target: Element): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

interface HarnessProps {
  readonly questionId?: string;
  readonly awaitingContinue?: boolean;
  readonly onEscape?: () => void;
  readonly type?: 'rune-cipher' | 'bone-ordering';
}

function Harness({ questionId = 'q1', awaitingContinue = false, onEscape, type = 'rune-cipher' }: HarnessProps): ReactNode {
  const [open, setOpen] = useState(true);
  const opener = useState(() => createRef<HTMLButtonElement>())[0];
  return (
    <div>
      <button ref={opener} type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      <QuestionPanel
        slotId="s1"
        questionId={questionId}
        questionType={type}
        heading="Rune tablet"
        open={open}
        openerRef={opener}
        awaitingContinue={awaitingContinue}
        onClose={() => {
          onEscape?.();
          setOpen(false);
        }}
        panels={PANELS}
      />
    </div>
  );
}

describe('QuestionPanel', () => {
  const mount = useMount();

  it('moves focus to the heading on open', () => {
    mount.render(createElement(Harness));
    expect(document.activeElement?.textContent).toBe('Rune tablet');
  });

  it('returns focus to the opening control on Escape', () => {
    mount.render(createElement(Harness));
    const panel = mount.container.querySelector('.question-panel') as HTMLElement;
    escape(panel);
    expect(document.activeElement?.textContent).toBe('opener');
    expect(panel.hidden).toBe(true);
  });

  it('keeps the draft after Escape and reopening', () => {
    mount.render(createElement(Harness));
    const input = mount.container.querySelector('input') as HTMLInputElement;
    setValue(input, 'half an answ');
    escape(input);
    act(() => (mount.container.querySelector('button') as HTMLButtonElement).click());
    expect((mount.container.querySelector('input') as HTMLInputElement).value).toBe('half an answ');
  });

  it('resets the draft when the question changes', () => {
    mount.render(createElement(Harness));
    setValue(mount.container.querySelector('input') as HTMLInputElement, 'old');
    mount.render(createElement(Harness, { questionId: 'q2' }));
    expect((mount.container.querySelector('input') as HTMLInputElement).value).toBe('');
  });

  it('Escape only calls onClose, once', () => {
    const onEscape = vi.fn();
    mount.render(createElement(Harness, { onEscape }));
    escape(mount.container.querySelector('.question-panel') as Element);
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('Escape does nothing while a judged answer waits for Continue', () => {
    const waiting = vi.fn();
    mount.render(createElement(Harness, { onEscape: waiting, awaitingContinue: true }));
    const panel = mount.container.querySelector('.question-panel') as HTMLElement;
    escape(panel);
    expect(waiting).not.toHaveBeenCalled();
    expect(panel.hidden).toBe(false);
  });

  it('shows the unplayable message for an unknown type', () => {
    mount.render(createElement(Harness, { type: 'mystery-lock' as never }));
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.unplayableType);
  });
});

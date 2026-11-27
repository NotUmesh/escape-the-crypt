import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ROOM_PLAY_LABELS, runSettingsFor, showsRuneLetterCount } from '@escape-the-crypt/core';
import type { CryptContent, LockSlotState } from '@escape-the-crypt/core';
import { useMount } from '../../test-support/flow-dom';
import { SAMPLE_CRYPT } from '../../test-support/sample-bundle';
import { LockPanelContext } from './lock-panel-context';
import { QuestionControls } from './question-controls';
import { answerLengthOf } from './room-panel';
import { RuneCipherPanel } from './rune-cipher-panel';

const CONTENT = { questions: { q1: { prompt: 'The organ that pumps blood is the ______.' } }, concepts: {} } as unknown as CryptContent;
const HINT: LockSlotState['appliedHint'] = {
  questionId: 'q1',
  effect: { kind: 'reveal-first-letter', firstLetter: 'h', length: 5 },
};

interface Options {
  readonly show?: boolean;
  readonly length?: number | null;
  readonly hint?: LockSlotState['appliedHint'];
}
function panel({ show = true, length = 5, hint = null }: Options = {}): ReactNode {
  return (
    <LockPanelContext.Provider
      value={{
        dispatch: () => undefined,
        rejection: null,
        content: CONTENT,
        appliedHintFor: () => hint,
        answerLengthFor: () => length,
        showAnswerLength: show,
      }}
    >
      <RuneCipherPanel slotId="s1" questionId="q1" questionType="rune-cipher" />
    </LockPanelContext.Provider>
  );
}

describe('rune letter count', () => {
  const mount = useMount();

  it('is shown from the start when the difficulty allows it, and describes the answer field', () => {
    mount.render(panel());
    const line = mount.container.querySelector('.rune-cipher-panel__length');
    expect(line?.textContent).toBe('The answer has 5 letters.');
    const input = mount.container.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(line?.id);
  });

  it('is hidden for the lich', () => {
    mount.render(panel({ show: false }));
    expect(mount.container.querySelector('.rune-cipher-panel__length')).toBeNull();
    expect(mount.container.textContent).not.toContain('letters');
    expect((mount.container.querySelector('input') as HTMLInputElement).hasAttribute('aria-describedby')).toBe(false);
  });

  it('gives way to the hint line once a hint is used, which says the count with the first letter', () => {
    mount.render(panel({ hint: HINT }));
    expect(mount.container.querySelector('.rune-cipher-panel__length')).toBeNull();
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.runeHint('h', 5));
  });

  it('shows nothing when the question has no count', () => {
    mount.render(panel({ length: null }));
    expect(mount.container.querySelector('.rune-cipher-panel__length')).toBeNull();
  });

  it('follows the difficulty: Apprentice and Gravedigger show it, Lich does not', () => {
    expect(showsRuneLetterCount(runSettingsFor('short', 'apprentice').difficulty)).toBe(true);
    expect(showsRuneLetterCount(runSettingsFor('short', 'gravedigger').difficulty)).toBe(true);
    expect(showsRuneLetterCount(runSettingsFor('short', 'lich').difficulty)).toBe(false);
  });
});

describe('answerLengthOf', () => {
  it('reads the count from the hint data, never the answer, and is null for a séance question', () => {
    const state = { manifest: SAMPLE_CRYPT.manifest } as unknown as Parameters<typeof answerLengthOf>[0];
    const slots = SAMPLE_CRYPT.manifest.rooms[0]?.lockSlots ?? [];
    const rune = slots.flatMap((s) => [s.primaryQuestion, s.alternateQuestion]).find((q) => q?.lockType === 'rune-cipher');
    const seance = slots.flatMap((s) => [s.primaryQuestion, s.alternateQuestion]).find((q) => q?.lockType === 'seance-board');
    if (rune == null || seance == null) throw new Error('the sample has both types');
    const effect = rune.hintEffect;
    expect(effect?.kind).toBe('reveal-first-letter');
    expect(answerLengthOf(state, rune.questionId)).toBe(effect?.kind === 'reveal-first-letter' ? effect.length : -1);
    expect(answerLengthOf(state, seance.questionId)).toBeNull();
    expect(answerLengthOf(state, 'no-such-question')).toBeNull();
  });
});

describe('QuestionControls without hints', () => {
  const mount = useMount();

  it('shows no hint control or count when the run has no hints at all', () => {
    mount.render(<QuestionControls slotId="s1" remainingHints={0} hintAllowance={0} hintApplied={false} dispatch={() => undefined} onClose={() => undefined} />);
    const names = Array.from(mount.container.querySelectorAll('button')).map((b) => b.textContent);
    expect(names).toEqual([ROOM_PLAY_LABELS.skip, ROOM_PLAY_LABELS.challenge]);
    expect(mount.container.textContent).not.toContain(ROOM_PLAY_LABELS.noHintsLeft);
  });

  it('still shows a disabled hint and "No hints left" once a run spent its hints', () => {
    mount.render(<QuestionControls slotId="s1" remainingHints={0} hintAllowance={2} hintApplied={false} dispatch={() => undefined} onClose={() => undefined} />);
    const hint = Array.from(mount.container.querySelectorAll('button')).find((b) => b.textContent === ROOM_PLAY_LABELS.hint);
    expect(hint?.disabled).toBe(true);
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.noHintsLeft);
  });
});

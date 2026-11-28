import { useId, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { LockSlotState } from '@escape-the-crypt/core';
import { useLockPanelContext } from './lock-panel-context';
import type { LockPanelProps } from './lock-panel-registry';
import { LockSubmit } from './lock-submit';

/** Reads "first letter" and "length" out of the hint, tolerating a missing or other hint. */
function firstLetterHint(
  hint: LockSlotState['appliedHint'],
  questionId: string,
): { readonly firstLetter: string; readonly length: number } | null {
  if (hint === null || hint.questionId !== questionId) return null;
  const effect = hint.effect;
  if (effect === null || effect.kind !== 'reveal-first-letter') return null;
  return { firstLetter: effect.firstLetter, length: effect.length };
}

/**
 * Rune cipher: a typed answer (Requirement 14). The draft lives in this component only; the
 * question panel remounts it with a new key when the slot's question changes. Text is rendered
 * as plain React text.
 */
export function RuneCipherPanel({ slotId, questionId }: LockPanelProps): ReactNode {
  const context = useLockPanelContext();
  const [draft, setDraft] = useState('');
  const [askForAnswer, setAskForAnswer] = useState(false);
  const inputId = useId();
  const messageId = useId();
  const lengthId = useId();

  if (context === null) return null;
  const prompt = context.content.questions[questionId]?.prompt ?? '';
  const rejected = context.rejection?.kind === 'invalid-submission' && context.rejection['slotId'] === slotId;
  const showMessage = askForAnswer || rejected;
  const hint = firstLetterHint(context.appliedHintFor(slotId), questionId);
  // Apprentice and Gravedigger see the letter count from the start; a used hint says it too.
  const letterCount = context.showAnswerLength === true ? (context.answerLengthFor?.(questionId) ?? null) : null;
  const slots = hint?.length ?? letterCount;

  function submit(): void {
    if (context === null) return;
    if (draft.trim() === '') {
      setAskForAnswer(true);
      return;
    }
    setAskForAnswer(false);
    context.dispatch({ type: 'submitAnswer', slotId, submission: { text: draft } });
  }

  function onChange(event: ChangeEvent<HTMLInputElement>): void {
    setDraft(event.target.value);
    setAskForAnswer(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  }

  return (
    <div className="rune-cipher-panel">
      <p className="rune-cipher-panel__prompt">{prompt}</p>
      {hint === null && letterCount !== null ? (
        <p className="rune-cipher-panel__length" id={lengthId}>
          {ROOM_PLAY_LABELS.runeLetterCount(letterCount)}
        </p>
      ) : null}
      {hint === null ? null : (
        <p className="rune-cipher-panel__hint">
          {ROOM_PLAY_LABELS.runeHint(hint.firstLetter, hint.length)}
        </p>
      )}
      {slots === null ? null : (
        <div className="rune-cipher-panel__carving" aria-hidden="true">
          {Array.from({ length: slots }, (_, index) => <span key={index}>{index === 0 ? hint?.firstLetter : null}</span>)}
        </div>
      )}
      <label htmlFor={inputId}>Your answer</label>
      <input
        id={inputId}
        type="text"
        value={draft}
        autoComplete="off"
        aria-describedby={[hint === null && letterCount !== null ? lengthId : null, showMessage ? messageId : null].filter(Boolean).join(' ') || undefined}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
      <LockSubmit onClick={submit} />
      {showMessage ? (
        <p id={messageId} role="alert" className="rune-cipher-panel__message">
          {ROOM_PLAY_LABELS.emptyAnswer}
        </p>
      ) : null}
    </div>
  );
}

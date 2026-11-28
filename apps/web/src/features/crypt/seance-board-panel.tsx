import { useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { useLockPanelContext } from './lock-panel-context';
import type { LockPanelProps } from './lock-panel-registry';

const GROUP_LABEL = ROOM_PLAY_LABELS.seanceGroupLabel;
const REMOVED_LABEL = ROOM_PLAY_LABELS.removedByHint;

/**
 * The séance board: a prompt and a radio group. The chosen option is a local draft only.
 * It reaches `dispatch` inside `submitAnswer`, and the panel never reads it back afterwards
 * (the chosen option is later derived from the event log by `chosenOptionFor`).
 * Options follow the key order of `content.options`, which is the manifest `payload.optionIds` order.
 */
export function SeanceBoardPanel({ slotId, questionId }: LockPanelProps): ReactNode {
  const env = useLockPanelContext();
  const [choice, setChoice] = useState<string | null>(null);
  const [showMessage, setShowMessage] = useState(false);
  const refs = useRef(new Map<string, HTMLInputElement>());

  const entry = env?.content.questions[questionId];
  if (env === null || entry === undefined) {
    return <p className="question-panel__unplayable">{ROOM_PLAY_LABELS.unplayableType}</p>;
  }

  const hint = env.appliedHintFor(slotId);
  const removedId =
    hint !== null && hint.questionId === questionId && hint.effect?.kind === 'remove-option'
      ? hint.effect.optionId
      : null;
  const options = Object.entries(entry.options ?? {});
  const promptId = `seance-prompt-${slotId}`;
  const groupId = `seance-group-${slotId}`;

  function select(id: string): void {
    setChoice(id);
    setShowMessage(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const enabled = options.map(([id]) => id).filter((id) => id !== removedId);
    if (enabled.length === 0) return;
    const at = choice === null ? -1 : enabled.indexOf(choice);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    if (next === undefined) return;
    select(next);
    refs.current.get(next)?.focus();
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    if (choice === null) {
      setShowMessage(true);
      return;
    }
    env?.dispatch({ type: 'submitAnswer', slotId, submission: { selectedOptionId: choice } });
  }

  return (
    <form className="seance-board-panel" onSubmit={onSubmit} noValidate>
      <p id={promptId} className="seance-board-panel__prompt">
        {entry.prompt}
      </p>
      <div role="radiogroup" aria-labelledby={`${groupId}-label`} aria-describedby={promptId} onKeyDown={onKeyDown}>
        <p id={`${groupId}-label`}>{GROUP_LABEL}</p>
        {options.map(([id, text]) => {
          const removed = id === removedId;
          return (
            <label key={id} className="seance-board-panel__option">
              <input
                type="radio"
                name={groupId}
                value={id}
                checked={choice === id}
                disabled={removed}
                aria-disabled={removed || undefined}
                ref={(node) => {
                  if (node === null) refs.current.delete(id);
                  else refs.current.set(id, node);
                }}
                onChange={() => select(id)}
              />{' '}
              <span>{text}</span>
              {removed ? <span> ({REMOVED_LABEL})</span> : null}
            </label>
          );
        })}
      </div>
      {showMessage ? <p role="alert">{ROOM_PLAY_LABELS.chooseOption}</p> : null}
      <button type="submit">{ROOM_PLAY_LABELS.submitAnswer}</button>
    </form>
  );
}

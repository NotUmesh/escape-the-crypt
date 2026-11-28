import { useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import {
  LOCK_PANEL_LABELS,
  ROOM_PLAY_LABELS,
  applyRemoveHint,
  chooseItem,
  cursedObjectSubmission,
  initCursedObjectDraft,
} from '@escape-the-crypt/core';
import type { CursedObjectQuestion } from '@escape-the-crypt/core';
import type { LockPanelContextValue } from './lock-panel-context';
import { hintEffectFor, itemText, useHintAnnouncement, useLockAnnounce, useLockPanelContext, useLockPayload } from './lock-panel-payload';
import type { LockPanelProps } from './lock-panel-registry';
import { LockSubmit } from './lock-submit';
import './lock-panels.css';

/**
 * Cursed object: pick the one item that does not belong. A radio group in a seeded order.
 * The choice is a local draft and reaches `dispatch` only inside `submitAnswer`.
 */
export function CursedObjectPanel(props: LockPanelProps): ReactNode {
  const env = useLockPanelContext();
  const payload = useLockPayload(props.slotId, props.questionId, 'cursed-object');
  if (env === null || payload === null) return <p className="question-panel__unplayable">{LOCK_PANEL_LABELS.payloadMissing}</p>;
  return <CursedObjectBody {...props} env={env} payload={payload} />;
}

interface BodyProps extends LockPanelProps {
  readonly env: LockPanelContextValue;
  readonly payload: CursedObjectQuestion;
}
function CursedObjectBody({ slotId, questionId, env, payload }: BodyProps): ReactNode {
  const announce = useLockAnnounce();
  const hint = hintEffectFor(env, slotId, questionId);
  const [stored, setDraft] = useState(() => initCursedObjectDraft(payload, hint, questionId));
  // The hint is read on every render, so one used part way through an answer still counts.
  const draft = applyRemoveHint(stored, hint);
  const [showMessage, setShowMessage] = useState(false);
  const refs = useRef(new Map<string, HTMLInputElement>());
  const textOf = (id: string): string => itemText(env, questionId, id, LOCK_PANEL_LABELS.itemTextMissing);
  useHintAnnouncement(hint, (h) => (h.kind === 'remove-option' ? LOCK_PANEL_LABELS.itemHinted(textOf(h.optionId)) : ''));

  function select(id: string): void {
    const next = chooseItem(draft, id);
    if (next === draft) return;
    setDraft(next);
    setShowMessage(false);
    announce(`${textOf(id)} chosen`);
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const enabled = draft.itemIds.filter((id) => id !== draft.removedId);
    if (enabled.length === 0) return;
    const at = draft.chosenId === null ? -1 : enabled.indexOf(draft.chosenId);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    if (next === undefined) return;
    select(next);
    refs.current.get(next)?.focus();
  }
  function submit(): void {
    const result = cursedObjectSubmission(draft);
    if (!result.ready) {
      setShowMessage(true);
      return;
    }
    env.dispatch({ type: 'submitAnswer', slotId, submission: result.submission });
  }
  const groupId = `cursed-group-${slotId}`;
  const promptId = `cursed-prompt-${slotId}`;
  return (
    <div className="cursed-object-panel">
      <p id={promptId} className="cursed-object-panel__prompt">
        {env.content.questions[questionId]?.prompt ?? ''}
      </p>
      <div className="cursed-object-panel__choices" role="radiogroup" aria-labelledby={`${groupId}-label`} aria-describedby={promptId} onKeyDown={onKeyDown}>
        <p id={`${groupId}-label`}>{LOCK_PANEL_LABELS.cursedGroupLabel}</p>
        {draft.itemIds.map((id) => {
          const removed = id === draft.removedId;
          return (
            <label key={id} className="cursed-object-panel__option">
              <input
                type="radio"
                name={groupId}
                value={id}
                checked={draft.chosenId === id}
                disabled={removed}
                aria-disabled={removed || undefined}
                ref={(node) => {
                  if (node === null) refs.current.delete(id);
                  else refs.current.set(id, node);
                }}
                onChange={() => select(id)}
              />{' '}
              <span>{textOf(id)}</span>
              {removed ? <span> ({ROOM_PLAY_LABELS.removedByHint})</span> : null}
            </label>
          );
        })}
      </div>
      {showMessage ? <p role="alert">{ROOM_PLAY_LABELS.chooseOption}</p> : null}
      <LockSubmit onClick={submit} />
    </div>
  );
}

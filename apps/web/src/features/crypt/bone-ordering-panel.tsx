import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { LOCK_PANEL_LABELS, ROOM_PLAY_LABELS, applyBoneHint, boneOrderingSubmission, initBoneOrderingDraft, moveBone } from '@escape-the-crypt/core';
import type { BoneDirection, BoneOrderingQuestion } from '@escape-the-crypt/core';
import { boneMoveName } from './accessible-names';
import type { LockPanelContextValue } from './lock-panel-context';
import { hintEffectFor, itemText, useHintAnnouncement, useLockAnnounce, useLockPanelContext, useLockPayload } from './lock-panel-payload';
import type { LockPanelProps } from './lock-panel-registry';
import './lock-panels.css';
import { ParchmentTag } from '../costume/ornaments';

/**
 * Bone ordering: each bone has Move up and Move down buttons. Alt with the up or down arrow
 * moves the bone you are on; plain arrows move focus between bones. The order is a local draft
 * and reaches `dispatch` only inside `submitAnswer`.
 */
export function BoneOrderingPanel(props: LockPanelProps): ReactNode {
  const env = useLockPanelContext();
  const payload = useLockPayload(props.slotId, props.questionId, 'bone-ordering');
  if (env === null || payload === null) return <p className="question-panel__unplayable">{LOCK_PANEL_LABELS.payloadMissing}</p>;
  return <BoneOrderingBody {...props} env={env} payload={payload} />;
}

interface BodyProps extends LockPanelProps {
  readonly env: LockPanelContextValue;
  readonly payload: BoneOrderingQuestion;
}
function BoneOrderingBody({ slotId, questionId, env, payload }: BodyProps): ReactNode {
  const announce = useLockAnnounce();
  const textOf = (id: string): string => itemText(env, questionId, id, LOCK_PANEL_LABELS.itemTextMissing);
  const hint = hintEffectFor(env, slotId, questionId);
  const [stored, setDraft] = useState(() => initBoneOrderingDraft(payload, hint, questionId));
  // The hint is read on every render, so one used part way through an answer still counts.
  const draft = applyBoneHint(stored, payload, hint);
  useHintAnnouncement(hint, (h) => (h.kind === 'lock-first-bone' ? LOCK_PANEL_LABELS.boneHinted(textOf(h.boneId)) : ''));
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (refocus.current === null) return;
    buttons.current.get(refocus.current)?.focus();
    refocus.current = null;
  }, [stored]);
  const total = draft.order.length;

  function move(id: string, direction: BoneDirection): void {
    const next = moveBone(draft, id, direction);
    if (next === draft) {
      announce(LOCK_PANEL_LABELS.boneBlocked(textOf(id)));
      return;
    }
    refocus.current = `${id}:${direction}`;
    setDraft(next);
    announce(LOCK_PANEL_LABELS.boneMoved(textOf(id), next.order.indexOf(id) + 1, total));
  }
  function onKeyDown(event: KeyboardEvent<HTMLLIElement>, id: string, index: number): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const direction: BoneDirection = event.key === 'ArrowUp' ? 'up' : 'down';
    if (event.altKey) {
      move(id, direction);
      return;
    }
    const neighbour = draft.order[index + (direction === 'up' ? -1 : 1)];
    if (neighbour !== undefined) buttons.current.get(`${neighbour}:${direction}`)?.focus();
  }
  function submit(): void {
    const result = boneOrderingSubmission(draft);
    if (result.ready) env.dispatch({ type: 'submitAnswer', slotId, submission: result.submission });
  }
  const shortcutId = `bone-shortcut-${slotId}`;
  return (
    <div className="bone-ordering-panel">
      <p className="bone-ordering-panel__prompt">{env.content.questions[questionId]?.prompt ?? ''}</p>
      <p id={shortcutId} className="lock-panel__shortcut">
        {LOCK_PANEL_LABELS.boneShortcutLine}
      </p>
      <ol className="bone-ordering-panel__list" aria-label={LOCK_PANEL_LABELS.boneListLabel} aria-describedby={shortcutId}>
        {draft.order.map((id, index) => {
          const pinned = id === draft.pinnedId;
          const text = textOf(id);
          const button = (direction: BoneDirection): ReactNode => (
            <button
              type="button"
              className="lock-panel__button"
              aria-disabled={pinned ? 'true' : undefined}
              aria-label={boneMoveName(direction, text, index + 1, total)}
              ref={(node) => {
                const key = `${id}:${direction}`;
                if (node === null) buttons.current.delete(key);
                else buttons.current.set(key, node);
              }}
              onClick={() => (pinned ? undefined : move(id, direction))}
            >
              {direction === 'up' ? LOCK_PANEL_LABELS.moveUp : LOCK_PANEL_LABELS.moveDown}
            </button>
          );
          return (
            <li key={id} className="bone-ordering-panel__row" data-pinned={pinned} onKeyDown={(e) => onKeyDown(e, id, index)}>
              <ParchmentTag className="bone-ordering-panel__text">{text}</ParchmentTag>
              {pinned ? <span>({LOCK_PANEL_LABELS.boneFixed})</span> : null}
              {button('up')}
              {button('down')}
            </li>
          );
        })}
      </ol>
      <button type="button" className="costume-seal" onClick={submit}>
        {ROOM_PLAY_LABELS.submitAnswer}
      </button>
    </div>
  );
}

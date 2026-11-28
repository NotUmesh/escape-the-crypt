import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  LOCK_PANEL_LABELS,
  ROOM_PLAY_LABELS,
  applyThreadHint,
  boundThreadsSubmission,
  initBoundThreadsDraft,
  isLeftTied,
  isRightTied,
  selectLeft,
  tieRight,
  undoThread,
} from '@escape-the-crypt/core';
import type { BoundThreadsQuestion } from '@escape-the-crypt/core';
import { threadStateName } from './accessible-names';
import type { LockPanelContextValue } from './lock-panel-context';
import { hintEffectFor, itemText, useHintAnnouncement, useLockAnnounce, useLockPanelContext, useLockPayload } from './lock-panel-payload';
import type { LockPanelProps } from './lock-panel-registry';
import './lock-panels.css';

/**
 * Bound threads: choose an item on the left, then its partner on the right, to tie a thread.
 * Each thread has an Undo button. No dragging. The pairs are a local draft and reach `dispatch`
 * only inside `submitAnswer`, and only when every left item is tied.
 */
export function BoundThreadsPanel(props: LockPanelProps): ReactNode {
  const env = useLockPanelContext();
  const payload = useLockPayload(props.slotId, props.questionId, 'bound-threads');
  if (env === null || payload === null) return <p className="question-panel__unplayable">{LOCK_PANEL_LABELS.payloadMissing}</p>;
  return <BoundThreadsBody {...props} env={env} payload={payload} />;
}

interface BodyProps extends LockPanelProps {
  readonly env: LockPanelContextValue;
  readonly payload: BoundThreadsQuestion;
}
function BoundThreadsBody({ slotId, questionId, env, payload }: BodyProps): ReactNode {
  const announce = useLockAnnounce();
  const hint = hintEffectFor(env, slotId, questionId);
  const [stored, setDraft] = useState(() => initBoundThreadsDraft(payload, hint, questionId));
  // The hint is read on every render, so one used part way through an answer still counts.
  const draft = applyThreadHint(stored, hint);
  const [message, setMessage] = useState<string | null>(null);
  const leftButtons = useRef(new Map<string, HTMLButtonElement>());
  const refocusLeft = useRef<string | null>(null);
  useEffect(() => {
    if (refocusLeft.current === null) return;
    leftButtons.current.get(refocusLeft.current)?.focus();
    refocusLeft.current = null;
  }, [stored]);
  const textOf = (id: string): string => itemText(env, questionId, id, LOCK_PANEL_LABELS.itemTextMissing);
  useHintAnnouncement(hint, (h) => (h.kind === 'tie-thread' ? LOCK_PANEL_LABELS.threadHinted(textOf(h.pair[0]), textOf(h.pair[1])) : ''));
  const partnerOfLeft = (id: string): string | undefined => draft.pairs.find(([l]) => l === id)?.[1];
  const partnerOfRight = (id: string): string | undefined => draft.pairs.find(([, r]) => r === id)?.[0];

  function pickLeft(id: string): void {
    const next = selectLeft(draft, id);
    if (next === draft) return;
    setDraft(next);
    setMessage(null);
    announce(next.selectedLeft === null ? LOCK_PANEL_LABELS.leftCleared(textOf(id)) : LOCK_PANEL_LABELS.leftSelected(textOf(id)));
  }
  function pickRight(id: string): void {
    const result = tieRight(draft, id);
    if (!result.ok) {
      const text = result.refusal === 'no-left-selected' ? LOCK_PANEL_LABELS.chooseLeftFirst : LOCK_PANEL_LABELS.rightAlreadyTied;
      setMessage(text);
      announce(text);
      return;
    }
    const left = draft.selectedLeft ?? '';
    setDraft(result.draft);
    setMessage(null);
    announce(LOCK_PANEL_LABELS.tied(textOf(left), textOf(id)));
  }
  function undo(left: string, right: string): void {
    const next = undoThread(draft, left);
    if (next === draft) return;
    refocusLeft.current = left;
    setDraft(next);
    setMessage(null);
    announce(LOCK_PANEL_LABELS.untied(textOf(left), textOf(right)));
  }
  function submit(): void {
    const result = boundThreadsSubmission(draft);
    if (!result.ready) {
      setMessage(LOCK_PANEL_LABELS.tieEveryLeft);
      announce(LOCK_PANEL_LABELS.tieEveryLeft);
      return;
    }
    env.dispatch({ type: 'submitAnswer', slotId, submission: result.submission });
  }
  const leftState = (id: string): 'tied' | 'selected' | 'untied' =>
    isLeftTied(draft, id) ? 'tied' : draft.selectedLeft === id ? 'selected' : 'untied';

  return (
    <div className="bound-threads-panel">
      <p className="bound-threads-panel__prompt">{env.content.questions[questionId]?.prompt ?? ''}</p>
      <div className="bound-threads-panel__columns">
        <div className="bound-threads-panel__column" role="group" aria-label={LOCK_PANEL_LABELS.threadsLeftLabel}>
          {draft.leftIds.map((id) => {
            const state = leftState(id);
            const partner = partnerOfLeft(id);
            return (
              <button
                key={id}
                type="button"
                className="bound-threads-panel__item"
                aria-pressed={state === 'tied' ? undefined : state === 'selected'}
                aria-disabled={state === 'tied' ? 'true' : undefined}
                data-tied={state === 'tied'}
                aria-label={threadStateName(textOf(id), state, partner === undefined ? undefined : textOf(partner))}
                ref={(node) => {
                  if (node === null) leftButtons.current.delete(id);
                  else leftButtons.current.set(id, node);
                }}
                onClick={() => pickLeft(id)}
              >
                {textOf(id)}
              </button>
            );
          })}
        </div>
        <div className="bound-threads-panel__column" role="group" aria-label={LOCK_PANEL_LABELS.threadsRightLabel}>
          {draft.rightOrder.map((id) => {
            const tied = isRightTied(draft, id);
            const partner = partnerOfRight(id);
            return (
              <button
                key={id}
                type="button"
                className="bound-threads-panel__item"
                aria-disabled={tied ? 'true' : undefined}
                data-tied={tied}
                aria-label={threadStateName(textOf(id), tied ? 'tied' : 'untied', partner === undefined ? undefined : textOf(partner))}
                onClick={() => pickRight(id)}
              >
                {textOf(id)}
              </button>
            );
          })}
        </div>
      </div>
      <p className="bound-threads-panel__tied-heading" id={`threads-tied-${slotId}`}>
        {LOCK_PANEL_LABELS.threadsTiedLabel}
      </p>
      {draft.pairs.length === 0 ? (
        <p>{LOCK_PANEL_LABELS.threadsNoneTied}</p>
      ) : (
        <ul className="bound-threads-panel__list" aria-labelledby={`threads-tied-${slotId}`}>
          {draft.pairs.map(([left, right]) => {
            const hinted = draft.hintedPair !== null && draft.hintedPair[0] === left;
            return (
              <li key={left} className="bound-threads-panel__pair">
                <span>
                  {textOf(left)} – {textOf(right)}
                </span>
                {hinted ? (
                  <span>({LOCK_PANEL_LABELS.tiedByHint})</span>
                ) : (
                  <button type="button" aria-label={`${LOCK_PANEL_LABELS.undo}: ${textOf(left)} and ${textOf(right)}`} onClick={() => undo(left, right)}>
                    {LOCK_PANEL_LABELS.undo}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {message === null ? null : <p role="alert">{message}</p>}
      <button type="button" className="costume-seal" onClick={submit}>
        {ROOM_PLAY_LABELS.submitAnswer}
      </button>
    </div>
  );
}

import { useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import {
  LOCK_PANEL_LABELS,
  ROOM_PLAY_LABELS,
  combinationDialSubmission,
  initCombinationDialDraft,
  setTypedEntry,
  stepWheel,
  wheelsOf,
} from '@escape-the-crypt/core';
import type { CombinationDialQuestion, WheelDirection } from '@escape-the-crypt/core';
import { placeName, wheelName } from './accessible-names';
import type { LockPanelContextValue } from './lock-panel-context';
import { rejectedInvalid, useLockAnnounce, useLockPanelContext, useLockPayload } from './lock-panel-payload';
import type { LockPanelProps } from './lock-panel-registry';
import './lock-panels.css';

/**
 * Combination dial: a row of digit wheels, each with Increase and Decrease buttons, plus a typed
 * entry. The text is the one stored value; wheels are a view of it. Up and Down arrows step the
 * wheel you are on, Left and Right move between wheels. The text is a local draft and reaches
 * `dispatch` only inside `submitAnswer`.
 */
export function CombinationDialPanel(props: LockPanelProps): ReactNode {
  const env = useLockPanelContext();
  const payload = useLockPayload(props.slotId, props.questionId, 'combination-dial');
  if (env === null || payload === null) return <p className="question-panel__unplayable">{LOCK_PANEL_LABELS.payloadMissing}</p>;
  return <CombinationDialBody {...props} env={env} payload={payload} />;
}

interface BodyProps extends LockPanelProps {
  readonly env: LockPanelContextValue;
  readonly payload: CombinationDialQuestion;
}
function CombinationDialBody({ slotId, questionId, env, payload }: BodyProps): ReactNode {
  const announce = useLockAnnounce();
  const [draft, setDraft] = useState(() => initCombinationDialDraft(payload));
  const [askForNumber, setAskForNumber] = useState(false);
  const digits = useRef(new Map<number, HTMLElement>());
  const wheels = wheelsOf(draft);
  const showInvalid = rejectedInvalid(env, slotId);
  const showMessage = askForNumber || showInvalid;
  const messageId = `dial-message-${slotId}`;

  function step(index: number, direction: WheelDirection): void {
    const next = stepWheel(draft, index, direction);
    setDraft(next);
    setAskForNumber(false);
    const wheel = wheelsOf(next)[index];
    if (wheel !== undefined) announce(LOCK_PANEL_LABELS.wheelNow(`${placeName(wheel.exponent)} wheel`, wheel.digit));
  }
  function onWheelKey(event: KeyboardEvent<HTMLElement>, index: number): void {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      step(index, event.key === 'ArrowUp' ? 'up' : 'down');
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      digits.current.get(index + (event.key === 'ArrowLeft' ? -1 : 1))?.focus();
    }
  }
  function submit(): void {
    const result = combinationDialSubmission(draft);
    if (!result.ready) {
      setAskForNumber(true);
      return;
    }
    setAskForNumber(false);
    env.dispatch({ type: 'submitAnswer', slotId, submission: result.submission });
  }
  function onType(event: ChangeEvent<HTMLInputElement>): void {
    setDraft(setTypedEntry(draft, event.target.value));
    setAskForNumber(false);
  }
  function onTypedKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  }
  const inputId = `dial-typed-${slotId}`;
  return (
    <div className="combination-dial-panel">
      <p className="combination-dial-panel__prompt">{env.content.questions[questionId]?.prompt ?? ''}</p>
      <p className="lock-panel__unit">{LOCK_PANEL_LABELS.unitLine(payload.unit)}</p>
      <div className="combination-dial-panel__wheels" role="group" aria-label={LOCK_PANEL_LABELS.wheelsLabel}>
        {wheels.map((wheel) => (
          <div key={wheel.index} className="combination-dial-panel__wheel">
            <button type="button" aria-label={wheelName('increase', wheel.exponent, wheel.digit)} onClick={() => step(wheel.index, 'up')}>
              +
            </button>
            <div
              className="combination-dial-panel__digit"
              role="spinbutton"
              tabIndex={0}
              aria-label={wheelName('wheel', wheel.exponent, wheel.digit)}
              aria-valuemin={0}
              aria-valuemax={9}
              aria-valuenow={wheel.digit}
              ref={(node) => {
                if (node === null) digits.current.delete(wheel.index);
                else digits.current.set(wheel.index, node);
              }}
              onKeyDown={(e) => onWheelKey(e, wheel.index)}
            >
              {wheel.digit}
            </div>
            <button type="button" aria-label={wheelName('decrease', wheel.exponent, wheel.digit)} onClick={() => step(wheel.index, 'down')}>
              −
            </button>
          </div>
        ))}
      </div>
      <label htmlFor={inputId}>{LOCK_PANEL_LABELS.typedEntryLabel}</label>
      <input
        id={inputId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={draft.text}
        aria-describedby={showMessage ? messageId : undefined}
        onChange={onType}
        onKeyDown={onTypedKey}
      />
      <button type="button" onClick={submit}>
        {ROOM_PLAY_LABELS.submitAnswer}
      </button>
      {showMessage ? (
        <p id={messageId} role="alert">
          {showInvalid ? LOCK_PANEL_LABELS.invalidNumber : LOCK_PANEL_LABELS.typeNumberFirst}
        </p>
      ) : null}
    </div>
  );
}

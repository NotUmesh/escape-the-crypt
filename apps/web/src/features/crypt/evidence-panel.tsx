import type { ReactNode, Ref } from 'react';
import { ROOM_ANNOUNCEMENT_COPY, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { Chunk, CryptContent, Event, FinalDoorSlotState, LockSlotState, ReturnSlotState } from '@escape-the-crypt/core';
import { chosenOptionFor } from '../../state/room-selectors';
import { evidenceResult, orderExcerpts, resolveExcerpt } from './evidence-text';
import './question-panel.css';

export interface EvidencePanelProps {
  readonly slot: LockSlotState | ReturnSlotState | FinalDoorSlotState;
  readonly content: CryptContent;
  readonly chunks: ReadonlyMap<string, Chunk>;
  /** The binding's read-only Event_Log; the chosen option is derived from it. */
  readonly eventLog: readonly Event[];
  /** From the manifest payload of a séance question; absent for other question types. */
  readonly keyOptionId?: string;
  /** 'sample' for the human-reviewed sample crypt, 'notes' for the learner's own notes. */
  readonly source?: 'notes' | 'sample';
  /** True for a generated crypt, whose published questions all passed the blind model review. */
  readonly reviewPassed?: boolean;
  /** Dispatches EvidenceContinued. The panel offers no way to answer again. */
  readonly onContinue: () => void;
  /** Lets the room screen move focus into the panel. */
  readonly panelRef?: Ref<HTMLElement>;
}

function ResultIcon({ result }: { readonly result: 'correct' | 'wrong' }): ReactNode {
  return (
    <svg
      className="evidence-panel__icon"
      aria-hidden="true"
      focusable="false"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {result === 'correct' ? <path d="M4 12.5l5 5L20 6.5" /> : <path d="M6 6l12 12M18 6L6 18" />}
    </svg>
  );
}

/** The evidence shown after a judged answer: the result, the learner's notes and Continue. */
export function EvidencePanel({
  slot,
  content,
  chunks,
  eventLog,
  keyOptionId,
  source = 'sample',
  reviewPassed = false,
  onContinue,
  panelRef,
}: EvidencePanelProps): ReactNode {
  const entry = content.questions[slot.currentQuestionId];
  const result = evidenceResult(slot);
  const options = entry?.options;
  const chosenId = options === undefined ? undefined : chosenOptionFor(eventLog, slot.slotId);
  const chosenText = chosenId === undefined ? undefined : options?.[chosenId];
  const keyText = keyOptionId === undefined ? undefined : options?.[keyOptionId];
  const excerpts =
    entry === undefined
      ? []
      : orderExcerpts(entry.excerpts, chosenId, keyOptionId).map((excerpt) =>
          resolveExcerpt({ chunks }, excerpt, source),
        );

  return (
    <section className="evidence-panel" tabIndex={-1} ref={panelRef}>
      {result !== null ? (
        <p className="evidence-panel__result" data-result={result}>
          <ResultIcon result={result} />{' '}
          <span>{result === 'correct' ? ROOM_ANNOUNCEMENT_COPY.evidence.correct : ROOM_PLAY_LABELS.wrongOpening}</span>
        </p>
      ) : null}
      {reviewPassed ? <p className="evidence-panel__review">{ROOM_PLAY_LABELS.reviewPassed}</p> : null}
      {slot.status === 'challenged' ? <p className="evidence-panel__challenged">{ROOM_PLAY_LABELS.challengedLabel}</p> : null}
      {chosenText !== undefined ? (
        <p className="evidence-panel__option">
          <strong>{ROOM_PLAY_LABELS.evidenceChosenOption}:</strong> <span>{chosenText}</span>
        </p>
      ) : null}
      {keyText !== undefined ? (
        <p className="evidence-panel__option">
          <strong>{ROOM_PLAY_LABELS.evidenceKeyOption}:</strong> <span>{keyText}</span>
        </p>
      ) : null}
      {excerpts.length > 0 ? (
        <ul className="evidence-panel__excerpts" aria-label={ROOM_PLAY_LABELS.evidenceExcerptsHeading}>
          {excerpts.map((excerpt, index) => (
            <li key={index} className="evidence-panel__excerpt">
              <blockquote>{excerpt.quote}</blockquote>
              {excerpt.citationLabel !== '' ? <p className="evidence-panel__citation">{excerpt.citationLabel}</p> : null}
              {excerpt.matched ? <p className="evidence-panel__matched">{ROOM_PLAY_LABELS.excerptMatched}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {entry !== undefined && entry.explanation !== '' ? <p className="evidence-panel__explanation">{entry.explanation}</p> : null}
      <button type="button" className="costume-seal" onClick={onContinue}>
        {ROOM_PLAY_LABELS.continue}
      </button>
    </section>
  );
}

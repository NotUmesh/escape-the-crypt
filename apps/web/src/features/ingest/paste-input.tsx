import { INGEST_UI_COPY, countWords } from '@escape-the-crypt/core';
import { useId } from 'react';
import './ingest-controls.css';
import './paste-input.css';

export interface PasteInputProps {
  readonly value: string;
  readonly onChange: (text: string) => void;
  /** Problem message from the state machine (for example the word-limit message), or ''. */
  readonly errorMessage: string;
}

/** A labelled textarea with a word counter (1.1, 1.3). */
export function PasteInput({ value, onChange, errorMessage }: PasteInputProps): React.JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const counterId = `${id}-counter`;
  const errorId = `${id}-error`;
  const describedBy = [hintId, counterId, errorMessage === '' ? '' : errorId].filter(Boolean).join(' ');
  return (
    <form className="ingest-block ingest-panel ingest-paste" onSubmit={(e) => e.preventDefault()}>
      <label htmlFor={id}>{INGEST_UI_COPY.pasteLabel}</label>
      <p className="ingest-hint" id={hintId}>
        {INGEST_UI_COPY.pasteHint}
      </p>
      <textarea
        id={id}
        name="notes"
        value={value}
        aria-describedby={describedBy}
        aria-invalid={errorMessage === '' ? undefined : true}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="ingest-paste-counter" id={counterId}>
        {INGEST_UI_COPY.wordCounter(countWords(value))}
      </p>
      {errorMessage === '' ? null : (
        <p className="ingest-paste-error" id={errorId}>
          {errorMessage}
        </p>
      )}
    </form>
  );
}
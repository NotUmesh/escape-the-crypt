import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { GENERATION_COPY } from '@escape-the-crypt/core';
import { FRONT_OF_HOUSE_COPY, formatElapsed } from '@escape-the-crypt/core';
import { isGenerating } from '../generate/generation-flow';
import type { GenerationState } from '../generate/generation-flow';
import { GenerationNotice } from '../generate/generation-notice';
import { Cavern } from './cavern';
import { activeStageMessage, digStageRows } from './dig-stages';
import type { DigStageInput } from './dig-stages';
import { DigStageList } from './dig-stage-list';
import { useElapsed } from './use-elapsed';
import type { Clock } from './use-elapsed';
import './dig.css';

export interface DigScreenProps {
  readonly state: GenerationState;
  readonly onCancel: () => void;
  /** What was sent: real counts from the confirmed notes. */
  readonly notes: { readonly pieces: number; readonly words: number };
  /** Stage data from the job status. Absent until the worker sends it; then no stage list shows. */
  readonly stages?: readonly DigStageInput[];
  /** The shell announcer's `announce`. */
  readonly announce: (message: string) => void;
  /** Test seam for the clock. */
  readonly now?: Clock;
}

/**
 * Generation progress over a dark cavern. Text sits on one solid panel. It shows the real elapsed
 * time, the real size of the notes, and the pipeline stages when the job reports them. There is no
 * percentage, because nothing reports one. The progress sentence and Cancel come from the existing
 * `GenerationNotice`, so the text, the test ids and the focus on arrival are unchanged.
 */
export function DigScreen({ state, onCancel, notes, stages, announce, now }: DigScreenProps): ReactNode {
  const copy = FRONT_OF_HOUSE_COPY.dig;
  const generating = isGenerating(state);
  const seconds = useElapsed(generating, now);
  const minutes = Math.floor(seconds / 60);
  const labelId = useId();
  const timerLabelId = useId();
  const rows = digStageRows(stages);
  const activeId = rows.find((row) => row.status === 'active')?.id ?? null;
  const activeText = useRef<string | null>(null);
  activeText.current = activeStageMessage(rows);

  // The progress sentence is read once, when the dig starts.
  useEffect(() => {
    if (generating) announce(GENERATION_COPY.progress);
  }, [generating, announce]);
  // A full minute passes: say so once. Counts ticking is never announced.
  useEffect(() => {
    if (generating && minutes > 0) announce(copy.stillWorking(minutes));
  }, [generating, minutes, announce, copy]);
  // A new stage starts: say its name and count once. A change of count alone stays silent.
  useEffect(() => {
    if (generating && activeId !== null && activeText.current !== null) announce(activeText.current);
  }, [generating, activeId, announce]);

  return (
    <div className="dig" data-testid="dig-screen">
      <Cavern />
      <main className="dig__content">
        <section className="fh-panel dig__panel" aria-labelledby={labelId}>
          <h1 className="fh-title" id={labelId}>
            {copy.title}
          </h1>
          <GenerationNotice state={state} onCancel={onCancel} />
          <p className="dig__fact">
            <span id={timerLabelId}>{copy.elapsed}</span>{' '}
            <span role="timer" aria-labelledby={timerLabelId} data-testid="dig-elapsed">
              {formatElapsed(seconds)}
            </span>
          </p>
          <p className="dig__fact" data-testid="dig-notes">
            <span>{copy.notes}</span> <span>{copy.notesStats(notes.pieces, notes.words)}</span>
          </p>
          <DigStageList stages={stages} />
        </section>
      </main>
    </div>
  );
}

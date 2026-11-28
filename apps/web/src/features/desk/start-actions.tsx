import type { ReactNode } from 'react';
import { ENTER_CRYPT_LABEL, GENERATION_COPY, SAMPLE_CRYPT_LINE } from '@escape-the-crypt/core';
import { GenerationNotice } from '../generate/generation-notice';
import { isGenerating } from '../generate/generation-flow';
import type { StartViewGeneration } from '../crypt/start-view';

export interface StartActionsProps {
  readonly onEnter: () => void;
  /** Absent when no worker origin is set: then only the sample start is offered. */
  readonly generation?: StartViewGeneration;
}

/**
 * What the start view offered, moved into the open book once notes are confirmed: the sample start
 * with its line, "Generate from my notes", and after a failure the sample offer. While a job runs
 * the dig screen is shown instead, so this renders nothing then. The same buttons and the same
 * `GenerationNotice` (stopped and failed messages, focus on arrival) as `StartView`.
 */
export function StartActions({ onEnter, generation }: StartActionsProps): ReactNode {
  const state = generation?.state;
  if (state !== undefined && isGenerating(state)) return null;
  const failed = state?.status === 'failed';
  return (
    <div className="start-actions" data-testid="start-actions">
      <p className="start-actions__line">{SAMPLE_CRYPT_LINE}</p>
      {generation !== undefined && state !== undefined ? (
        <GenerationNotice state={state} onCancel={generation.onCancel} />
      ) : null}
      <div className="start-actions__buttons">
        {generation !== undefined ? (
          <button type="button" className="fh-button fh-button--primary" onClick={generation.onGenerate}>
            {GENERATION_COPY.generateButton}
          </button>
        ) : null}
        {failed ? null : (
          <button type="button" className={generation === undefined ? 'fh-button fh-button--primary' : 'fh-button'} onClick={onEnter}>
            {ENTER_CRYPT_LABEL}
          </button>
        )}
        {generation !== undefined && failed ? (
          <button type="button" className="fh-button" onClick={generation.onPlaySample}>
            {GENERATION_COPY.sampleOffer}
          </button>
        ) : null}
      </div>
    </div>
  );
}

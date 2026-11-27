import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { GENERATION_COPY } from '@escape-the-crypt/core';
import type { GenerationState } from './generation-flow';

export interface GenerationNoticeProps {
  readonly state: GenerationState;
  readonly onCancel: () => void;
}

/**
 * What a generation job shows in the start view: the progress line with Cancel, the stopped
 * message, or the failure. Focus moves to the new message when it appears. The progress line is
 * plain text with no live region of its own: the host announces it through its one polite region, and the crypt's own region is not mounted while a job runs.
 */
export function GenerationNotice({ state, onCancel }: GenerationNoticeProps): ReactNode {
  const progressRef = useRef<HTMLParagraphElement>(null);
  const stoppedRef = useRef<HTMLParagraphElement>(null);
  const failureRef = useRef<HTMLHeadingElement>(null);
  const status = state.status;
  const generating = status === 'starting' || status === 'polling';
  useEffect(() => {
    if (generating) progressRef.current?.focus();
    else if (status === 'cancelled') stoppedRef.current?.focus();
    else if (status === 'failed') failureRef.current?.focus();
  }, [generating, status]);

  if (generating) {
    return (
      <div className="crypt-generation" data-testid="generation-progress">
        <p tabIndex={-1} ref={progressRef}>
          {GENERATION_COPY.progress}
        </p>
        <button type="button" onClick={onCancel}>
          {GENERATION_COPY.cancel}
        </button>
      </div>
    );
  }
  if (status === 'cancelled') {
    return (
      <p className="crypt-generation" tabIndex={-1} ref={stoppedRef} data-testid="generation-cancelled">
        {GENERATION_COPY.cancelled}
      </p>
    );
  }
  if (state.status === 'failed') {
    const copy = GENERATION_COPY.failures[state.kind];
    return (
      <div className="crypt-generation crypt-generation--failed" data-testid="generation-failed">
        <h3 tabIndex={-1} ref={failureRef}>
          {copy.what}
        </h3>
        <p>{copy.next}</p>
      </div>
    );
  }
  return null;
}

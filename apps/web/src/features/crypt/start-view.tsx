import type { ReactNode } from 'react';
import { ENTER_CRYPT_LABEL, GENERATION_COPY, SAMPLE_CRYPT_LINE } from '@escape-the-crypt/core';
import type { GenerationState } from '../generate/generation-flow';
import { GenerationNotice } from '../generate/generation-notice';
import './crypt-generation.css';

export interface StartViewGeneration {
  readonly state: GenerationState;
  readonly onGenerate: () => void;
  readonly onCancel: () => void;
  readonly onPlaySample: () => void;
}

export interface StartViewProps {
  readonly onEnter: () => void;
  /** Absent when no worker origin is configured: the view is then exactly the sample start. */
  readonly generation?: StartViewGeneration;
  /** The resume entry, shown beside the existing buttons. It renders nothing when there is no saved run. */
  readonly resume?: ReactNode;
  /** The length and difficulty choice, shown before the buttons and hidden while a job runs. */
  readonly settings?: ReactNode;
}

/** The start view: "Enter the crypt" (sample), plus "Generate from my notes" when a worker is set. */
export function StartView({ onEnter, generation, resume, settings }: StartViewProps): ReactNode {
  const state = generation?.state;
  const running = state?.status === 'starting' || state?.status === 'polling';
  const failed = state?.status === 'failed';
  return (
    <section className="crypt-start" aria-labelledby="crypt-start-title">
      <h2 id="crypt-start-title">Escape the Crypt</h2>
      {running ? null : <p>{SAMPLE_CRYPT_LINE}</p>}
      {generation !== undefined && state !== undefined ? (
        <GenerationNotice state={state} onCancel={generation.onCancel} />
      ) : null}
      {running ? null : settings}
      {running || failed ? null : (
        <button type="button" onClick={onEnter}>
          {ENTER_CRYPT_LABEL}
        </button>
      )}
      {generation === undefined || running ? null : (
        <button type="button" onClick={generation.onGenerate}>
          {GENERATION_COPY.generateButton}
        </button>
      )}
      {generation !== undefined && failed ? (
        <button type="button" onClick={generation.onPlaySample}>
          {GENERATION_COPY.sampleOffer}
        </button>
      ) : null}
      {running ? null : resume}
    </section>
  );
}

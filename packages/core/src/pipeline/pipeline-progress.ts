/** The pipeline stage a running job is in, as the worker reports it to the learner. */
export const PIPELINE_STAGES = ['extracting', 'generating', 'reviewing', 'assembling'] as const;
export type PipelineStageName = (typeof PIPELINE_STAGES)[number];

/**
 * Where a run is. `done` and `total` are set only where they are real counts: concepts generated
 * and questions reviewed. Extraction and assembly are single steps and carry no counts.
 */
export interface PipelineProgress {
  readonly stage: PipelineStageName;
  readonly done?: number;
  readonly total?: number;
}

export interface ProgressReporter {
  stage(stage: PipelineStageName): void;
  /** Starts a counted stage at 0 of `total`; returns a function that counts one step done. */
  counted(stage: PipelineStageName, total: number): () => void;
}

/**
 * Wraps the caller's callback so a progress report can never break a run: a throwing callback is
 * ignored. Reports carry stage names and counts only, never notes or question text.
 */
export function progressReporter(onProgress: ((p: PipelineProgress) => void) | undefined): ProgressReporter {
  const send = (p: PipelineProgress): void => {
    if (onProgress === undefined) return;
    try {
      onProgress(p);
    } catch {
      // Progress is advisory; the run goes on.
    }
  };
  return {
    stage: (stage) => send({ stage }),
    counted: (stage, total) => {
      let done = 0;
      send({ stage, done, total });
      return () => {
        done = Math.min(total, done + 1);
        send({ stage, done, total });
      };
    },
  };
}

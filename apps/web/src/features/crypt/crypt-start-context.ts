import type { RunSettings } from '@escape-the-crypt/core';
import type { BuiltCrypt } from '../../state/room-binding';
import type { RestoreDeps, RestoredRun } from '../../state/storage/restore-run';
import type { GenerationState } from '../generate/generation-flow';
import type { useRunChoice } from '../desk/use-run-choice';

/**
 * What a host's `renderStart` is given to build the screens before the crypt: the generation
 * state and its actions, the run choice, and the ways to start, continue or start again. Every
 * function is the one the built-in start view uses, so a host adds layout and nothing else.
 */
export interface CryptStartContext {
  readonly generation: GenerationState;
  /** True when a worker origin is set and notes are confirmed. */
  readonly canGenerate: boolean;
  readonly choice: ReturnType<typeof useRunChoice>;
  readonly onGenerate: () => void;
  readonly onCancelGeneration: () => void;
  /** Starts the bundled sample crypt. The id names which sample the learner picked. */
  readonly playSample: (sampleId?: string) => void;
  readonly deps: RestoreDeps;
  /** "Continue your crypt": the restored run replaces the screen (a short fade, no clips). */
  readonly onContinue: (restored: RestoredRun) => void;
  readonly onStartAgain: (crypt: BuiltCrypt | null, settings?: RunSettings) => void;
}

/** Builds the screens before the crypt. It is called while no run is playing. */
export type RenderStart = (context: CryptStartContext) => React.ReactNode;

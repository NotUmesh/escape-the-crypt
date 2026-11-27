import type { GenerationState } from '../generate/generation-flow';
import type { DigStageInput } from './dig-stages';

/**
 * The one place the dig's stage list gets its data. The job status the app polls does not carry a
 * stage or counts yet, and the generation state keeps none, so this returns `undefined` and the dig
 * shows no stage list (never a made-up one). When the worker's job status gains `stage` and counts
 * and `GenerationState` keeps them while polling, map them here to `DigStageInput[]`; the dig, its
 * announcements and its tests already take that shape.
 */
export function digStagesFromGeneration(state: GenerationState): readonly DigStageInput[] | undefined {
  void state;
  return undefined;
}

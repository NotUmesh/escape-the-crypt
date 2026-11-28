import type { ExcludedConcept } from './conflict-stage';
import type { SufficiencyNotice } from './sufficiency';

/** What the learner should be told about the crypt beyond its rooms. Present only when non-empty. */
export interface PipelineNotices {
  readonly excluded: readonly ExcludedConcept[];
  readonly sufficiency: SufficiencyNotice | null;
}

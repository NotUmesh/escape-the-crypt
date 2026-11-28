/** Why a crypt has fewer rooms than asked for. Counts only: no notes, no model output. */
export interface SufficiencyNotice {
  /** Concepts that were not too thin to ask about. */
  readonly goodConcepts: number;
  /** Concepts the requested crypt size needs. */
  readonly conceptsNeeded: number;
  readonly requestedRooms: number;
  readonly builtRooms: number;
}

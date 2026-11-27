export type FrontOfHouseRoute = 'home' | 'ingest';
export type FrontOfHouseScreen = 'hub' | 'bring' | 'dig' | 'descent' | 'crypt';
export type GenerationPhase = 'idle' | 'starting' | 'polling' | 'ready' | 'failed' | 'cancelled';
export type RunPhase = 'not-started' | 'running' | 'start-failed';

export interface ScreenInput {
  readonly route: FrontOfHouseRoute;
  readonly generation: GenerationPhase;
  readonly phase: RunPhase;
  /** True while the descent gate is up over a freshly started run. */
  readonly descending: boolean;
}

/**
 * Which screen the learner sees. Derived from state that already exists; it holds nothing itself.
 * A running run wins over everything, and the descent is the only thing drawn over it.
 */
export function screenFor({ route, generation, phase, descending }: ScreenInput): FrontOfHouseScreen {
  if (phase === 'running') return descending ? 'descent' : 'crypt';
  if (generation === 'starting' || generation === 'polling') return 'dig';
  return route === 'ingest' ? 'bring' : 'hub';
}

import type { Event } from '../types';
import { manifestCheck } from './manifest-check';
import { accept, reject } from './result';
import type { ApplyResult } from './result';
import type { State } from './state-types';

type RunStartedEvent = Extract<Event, { kind: 'RunStarted' }>;

/** Start the run: check the manifest, then set status and the hint allowance. */
export function handleRunStarted(state: State, event: RunStartedEvent): ApplyResult {
  if (event.manifestId !== state.manifestId) return reject('manifest-mismatch');
  if (state.status !== 'not started') return reject('run-already-started');
  const check = manifestCheck(state.manifest);
  if (!check.ok) return { ok: false, error: check.error };
  return accept({
    ...state,
    status: 'in progress',
    remainingHints: state.settings.hintAllowance,
  });
}

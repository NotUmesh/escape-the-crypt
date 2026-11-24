import { useCallback, useRef, useState } from 'react';
import { INITIAL_INGEST_STATE, ingestReducer } from './ingest-machine';
import type { IngestEvent, IngestState } from './ingest-machine';

/**
 * Runs the pure reducer. `send` returns the new state at once, so an event
 * handler can decide its next step (open the PDF, save the notes) from the
 * machine's answer instead of repeating its rules.
 */
export function useIngestMachine(): {
  readonly state: IngestState;
  readonly send: (event: IngestEvent) => IngestState;
  readonly getState: () => IngestState;
} {
  const [state, setState] = useState<IngestState>(INITIAL_INGEST_STATE);
  const latest = useRef(state);
  const send = useCallback((event: IngestEvent): IngestState => {
    const next = ingestReducer(latest.current, event);
    latest.current = next;
    setState(next);
    return next;
  }, []);
  const getState = useCallback((): IngestState => latest.current, []);
  return { state, send, getState };
}
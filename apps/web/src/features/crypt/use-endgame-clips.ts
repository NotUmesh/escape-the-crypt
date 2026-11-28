import { useCallback, useLayoutEffect, useRef } from 'react';
import type { Event, State } from '@escape-the-crypt/core';
import type { DescentVariant } from './crypt-descent';

export function useEndgameClips(
  state: State | null,
  log: readonly Event[],
  hasEvidence: boolean,
  begin: (variant: DescentVariant, then?: DescentVariant) => void,
): () => void {
  const previous = useRef({ state, log });
  const pendingEscape = useRef(false);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { state, log };
    if (log === before.log) return;
    // Live appends retain the previous event objects; restore and replay replace them.
    const lastIndex = before.log.length - 1;
    if (lastIndex < 0 || log.length <= before.log.length || log[lastIndex] !== before.log[lastIndex]) {
      pendingEscape.current = false;
      return;
    }

    const enteredDoor = state?.atFinalDoor === true && before.state?.atFinalDoor === false;
    if (state?.status === 'escaped' && before.state?.status !== 'escaped') {
      pendingEscape.current = hasEvidence;
      if (!hasEvidence) {
        if (enteredDoor) begin('final-door', 'escape');
        else begin('escape');
      }
    } else if (enteredDoor) {
      begin('final-door');
    }
  }, [state, log, hasEvidence, begin]);

  return useCallback(() => {
    if (!pendingEscape.current) return;
    pendingEscape.current = false;
    begin('escape');
  }, [begin]);
}

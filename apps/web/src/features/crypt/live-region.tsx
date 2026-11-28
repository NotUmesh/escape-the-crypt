import { useEffect, useReducer, useRef } from 'react';
import { createPortal } from 'react-dom';

interface QueueState {
  readonly current: string;
  readonly pending: readonly string[];
  /** Changes on every advance so the timer restarts even for repeated text. */
  readonly tick: number;
}

type QueueAction = { readonly type: 'enqueue'; readonly messages: readonly string[] } | { readonly type: 'advance' };

function reduce(state: QueueState, action: QueueAction): QueueState {
  if (action.type === 'enqueue') {
    const queue = [...state.pending, ...action.messages];
    if (state.current !== '') return { ...state, pending: queue };
    const [first = '', ...rest] = queue;
    return { current: first, pending: rest, tick: state.tick + 1 };
  }
  const [first = '', ...rest] = state.pending;
  return { current: first, pending: rest, tick: state.tick + 1 };
}

export interface LiveRegionProps {
  /** The messages of the latest dispatch. A new array is appended to the queue. */
  readonly messages: readonly string[];
  /** How long each message stays before the next one replaces it. */
  readonly intervalMs?: number;
  /** The native lock dialog makes everything outside it inert. */
  readonly host?: HTMLElement | null;
}

/** The one polite live region. It shows one queued message at a time, so none are merged. */
export function LiveRegion({ messages, intervalMs = 1500, host = null }: LiveRegionProps) {
  const [state, dispatch] = useReducer(reduce, { current: '', pending: [], tick: 0 });
  const lastBatch = useRef<readonly string[] | null>(null);

  useEffect(() => {
    if (lastBatch.current === messages) return;
    lastBatch.current = messages;
    if (messages.length > 0) dispatch({ type: 'enqueue', messages });
  }, [messages]);

  useEffect(() => {
    if (state.current === '') return undefined;
    const timer = setTimeout(() => dispatch({ type: 'advance' }), intervalMs);
    return () => clearTimeout(timer);
  }, [state.tick, state.current, intervalMs]);

  const region = (
    <div
      aria-live="polite"
      aria-atomic="true"
      data-testid="room-live-region"
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        margin: -1,
        padding: 0,
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {state.current}
    </div>
  );
  return host === null ? region : createPortal(region, host);
}

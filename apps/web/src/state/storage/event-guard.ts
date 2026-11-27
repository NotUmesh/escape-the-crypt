import { isEvent } from '@escape-the-crypt/core';
import type { Event } from '@escape-the-crypt/core';

/** Runtime guard for a stored event. `parseEventRow` takes one as a parameter. */
export type EventGuard = (value: unknown) => value is Event;

/** The single seam that names the core guard. */
export const eventGuard: EventGuard = isEvent;

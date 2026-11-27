import { REQUEST_LIMIT_COPY, renderError } from '@escape-the-crypt/core';
import type { JobFailureKind } from '../jobs/job-store';

/** Learner-visible failure messages. Plain language, no notes text, prompt or model output. */
export const FAILURE_COPY: Readonly<Record<JobFailureKind, string>> = {
  'budget-exhausted':
    'The crypt has used up its candles for today. Please come back tomorrow, and your notes will still be here.',
  'not-enough-material':
    "We couldn't build a crypt from these notes. Try adding a few more paragraphs that explain your topic.",
  'generation-failed':
    "The crypt didn't finish building. Nothing was lost. Please try again in a moment.",
  cancelled: 'This crypt build was stopped.',
  expired: 'This crypt is gone from the server. Your notes are still on your device, so you can build it again.',
};

export const ERROR_COPY = {
  'invalid-session-token': 'This request is missing a valid session token. Please reload the page and try again.',
  'invalid-idempotency-key': 'This request is missing a valid idempotency key. Please reload the page and try again.',
  'invalid-json': "We couldn't read that request. Please reload the page and try again.",
  'invalid-body': 'Send your notes as text and choose a run length: short, standard or long.',
  'payload-too-large': 'Those notes are too large to send. Try a shorter passage.',
  'notes-too-long': 'Your notes are over the 6,000-word limit. Trim them or split them into parts.',
  'idempotency-conflict': 'That request key was already used for different notes. Please try again.',
  // The 429 kinds come from core's REQUEST_LIMIT_COPY, so the worker and the web say the same thing.
  'session-busy': renderError(REQUEST_LIMIT_COPY['session-busy']),
  capacity: renderError(REQUEST_LIMIT_COPY.capacity),
  'rate-limited': renderError(REQUEST_LIMIT_COPY['rate-limited']),
  'judge-access-denied': 'That judge access code is not right. Check it and try again.',
  'not-found': 'Nothing is here.',
  internal: 'Something went wrong on our side. Please try again.',
} as const;

export type ErrorKind = keyof typeof ERROR_COPY;

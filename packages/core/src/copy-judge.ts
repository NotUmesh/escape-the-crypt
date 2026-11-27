import type { ErrorCopy } from './copy';

/** Why the worker refused a judge access code (HTTP 403, or 404 when the route is off: they look the same from outside). */
export const JUDGE_ACCESS_DENIED_COPY: ErrorCopy = {
  what: 'That judge access code is not right.',
  next: 'Check it and try again, or play the sample crypt.',
};

/** The "Judge access" disclosure on the notes book. */
export const JUDGE_ACCESS_COPY = {
  summary: 'Judge access',
  label: 'Access code',
  hint: 'Only for judges who were given a code. Leave it empty otherwise. The code stays in this tab, is not saved, and is sent only when you generate from your notes.',
  denied: JUDGE_ACCESS_DENIED_COPY,
} as const;

/** What an interaction model returns when asked for the submission of its draft. */
export type InteractionSubmission<S> =
  | { readonly ready: true; readonly submission: S }
  | { readonly ready: false; readonly reason: string };

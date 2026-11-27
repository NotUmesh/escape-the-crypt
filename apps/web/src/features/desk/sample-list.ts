import { SAMPLE_CRYPT_LABEL } from '@escape-the-crypt/core';
import type { SampleEntry } from './shelf-entry';

/**
 * The sample crypts, with the titles on the first line of each notes file. None of them carries a
 * review label: their question files are drafts.
 */
export const SAMPLE_LIST: readonly SampleEntry[] = [
  { id: 'human-heart', title: 'The human heart' },
  { id: 'https', title: 'How HTTPS keeps a connection private' },
  { id: 'printing-press', title: 'The printing press' },
];

/**
 * The samples `buildSampleCrypt` can build today. The other two have notes and question files but no
 * builder yet, so the hub does not offer them: a button that starts a different crypt would be a lie.
 * Add an id here when its builder lands.
 */
export const BUILDABLE_SAMPLE_IDS: readonly string[] = ['human-heart'];

export const DEFAULT_SAMPLE_ID = 'human-heart';

/** The samples the hub offers. */
export function playableSamples(): readonly SampleEntry[] {
  return SAMPLE_LIST.filter((entry) => BUILDABLE_SAMPLE_IDS.includes(entry.id));
}

/** The public title of a sample, for the share card. An unknown or missing id reads as the default sample. */
export function sampleTitleFor(id: string | undefined): string {
  const entry = SAMPLE_LIST.find((candidate) => candidate.id === (id ?? DEFAULT_SAMPLE_ID));
  return entry?.title ?? SAMPLE_CRYPT_LABEL;
}

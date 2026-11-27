import type { SampleEntry } from './shelf-entry';

/**
 * The sample crypts the hub offers, with the titles on the first line of each notes file.
 * Building them and restoring their runs belongs to the sample registry the lock-types work
 * exports; the hub only reports which id was chosen. None of them carries a review label.
 */
export const SAMPLE_LIST: readonly SampleEntry[] = [
  { id: 'human-heart', title: 'The human heart' },
  { id: 'https', title: 'How HTTPS keeps a connection private' },
  { id: 'printing-press', title: 'The printing press' },
];

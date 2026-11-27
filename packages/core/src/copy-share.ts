/**
 * Text for the share card. Every string is checked against the banned-wording list in
 * `copy-share.test.ts`. The card claims nothing about learning.
 */

/** The public address of the game. It goes in the shared text only; the app never requests it. */
export const SHARE_URL = 'https://escape-the-crypt.pages.dev';

export const GENERIC_CRYPT_NAME = 'a crypt made from my own notes';

/** "no ghosts remaining", "1 ghost remaining", "3 ghosts remaining". */
export function ghostPhrase(count: number): string {
  if (count === 0) return 'no ghosts remaining';
  return count === 1 ? '1 ghost remaining' : `${count} ghosts remaining`;
}

export const SHARE_COPY = {
  heading: 'Share your escape',
  appName: 'Escape the Crypt',
  footer: 'Made with Escape the Crypt',
  /** The title is shown in quotes. A crypt made from the learner's notes has no title. */
  headline: (title: string | null, ghosts: number): string =>
    `Escaped ${title === null ? GENERIC_CRYPT_NAME : `\u201C${title}\u201D`} with ${ghostPhrase(ghosts)}`,
  countsHeading: 'Outcomes',
  privacy: 'The card shows only these counts. It has no questions, answers or notes.',
  shareButton: 'Share your escape',
  saveButton: 'Download card and copy text',
  working: 'Getting your card ready',
  status: {
    shared: 'Shared.',
    downloadedAndCopied: 'Card downloaded and text copied.',
    downloaded: 'Card downloaded. The text could not be copied.',
    copied: 'Text copied. The card could not be downloaded.',
    failed: "We couldn't share this time. Try again.",
  },
  /** The name of the downloaded file. It never carries a crypt, note or file name. */
  fileName: 'escape-the-crypt-card.png',
  imageAlt: (headline: string, countsText: string): string => `${headline}. ${countsText}`,
} as const;

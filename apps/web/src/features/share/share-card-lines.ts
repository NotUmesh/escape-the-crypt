import { SAMPLE_CRYPT_LABEL } from '@escape-the-crypt/core';
import { SHARE_COPY, SHARE_URL } from '@escape-the-crypt/core';
import type { ShareCardData } from './share-card-data';

export type CardLineRole = 'app' | 'headline' | 'note' | 'count' | 'footer';

/** One line of the card, in reading order. The page card and the PNG are both drawn from these. */
export interface CardLine {
  readonly role: CardLineRole;
  readonly text: string;
  /** The number beside a `count` line. */
  readonly value?: string;
}

export function headlineOf(data: ShareCardData): string {
  return SHARE_COPY.headline(data.title, data.ghostsRemaining);
}

/** The lines of the card. Nothing else is ever drawn. */
export function cardLines(data: ShareCardData): readonly CardLine[] {
  return [
    { role: 'app', text: SHARE_COPY.appName },
    { role: 'headline', text: headlineOf(data) },
    ...(data.sample ? [{ role: 'note', text: SAMPLE_CRYPT_LABEL } as const] : []),
    ...data.counts.map((entry) => ({ role: 'count', text: entry.label, value: String(entry.count) }) as const),
    { role: 'footer', text: SHARE_COPY.footer },
  ];
}

/** The outcome counts as one sentence, for the image's text alternative. */
export function countsSentence(data: ShareCardData): string {
  return data.counts.map((entry) => `${entry.label} (${entry.count})`).join(', ');
}

/** The text that is shared or copied: the card's words and the public address of the game. Nothing from the notes. */
export function shareText(data: ShareCardData): string {
  const counts = data.counts.map((entry) => `${entry.label} (${entry.count})`);
  return [headlineOf(data), ...(data.sample ? [SAMPLE_CRYPT_LABEL] : []), ...counts, SHARE_COPY.footer, SHARE_URL].join('\n');
}

/** Every string on the card, for tests that check what it can say. */
export function allCardText(data: ShareCardData): string {
  return cardLines(data)
    .flatMap((line) => (line.value === undefined ? [line.text] : [line.text, line.value]))
    .join('\n');
}

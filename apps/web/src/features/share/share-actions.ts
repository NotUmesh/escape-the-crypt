import { SHARE_COPY } from '@escape-the-crypt/core';

export type ShareOutcome =
  | 'shared'
  | 'cancelled'
  | 'downloaded-and-copied'
  | 'downloaded'
  | 'copied'
  | 'failed';

/** The parts of `navigator` that sharing uses. */
export interface ShareNavigator {
  share?: (data: { title?: string; text?: string; files?: File[] }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

export interface ShareEnv {
  readonly nav: ShareNavigator;
  /** The card as a PNG, or null when it cannot be drawn. */
  readonly makePng: () => Promise<Blob | null>;
  readonly makeFile: (blob: Blob, name: string) => File;
  /** Starts a download of the blob. May throw. */
  readonly download: (blob: Blob, name: string) => void;
}

export function canUseWebShare(nav: ShareNavigator): boolean {
  return typeof nav.share === 'function';
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

async function tryCopy(nav: ShareNavigator, text: string): Promise<boolean> {
  if (nav.clipboard === undefined) return false;
  try {
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function tryDownload(env: ShareEnv, blob: Blob | null): boolean {
  if (blob === null) return false;
  try {
    env.download(blob, SHARE_COPY.fileName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shares the card. With the Web Share API it shares the PNG when the browser accepts files and the
 * text otherwise; a learner who closes the sheet is not pushed into a download. Without it, or if
 * sharing fails, the card is downloaded as a PNG and the text is copied. Nothing here reads anything
 * but the PNG and the text it is given.
 */
export async function performShare(env: ShareEnv, text: string): Promise<ShareOutcome> {
  let blob: Blob | null = null;
  try {
    blob = await env.makePng();
  } catch {
    blob = null;
  }
  const { nav } = env;
  if (canUseWebShare(nav) && nav.share !== undefined) {
    try {
      const file = blob === null ? null : env.makeFile(blob, SHARE_COPY.fileName);
      const withFile = file !== null && nav.canShare?.({ files: [file] }) === true;
      await nav.share({ title: SHARE_COPY.appName, text, ...(withFile && file !== null ? { files: [file] } : {}) });
      return 'shared';
    } catch (error) {
      if (isAbort(error)) return 'cancelled';
      // Any other failure falls through to the download.
    }
  }
  const downloaded = tryDownload(env, blob);
  const copied = await tryCopy(nav, text);
  if (downloaded && copied) return 'downloaded-and-copied';
  if (downloaded) return 'downloaded';
  return copied ? 'copied' : 'failed';
}

const STATUS_TEXT: Readonly<Record<ShareOutcome, string>> = {
  shared: SHARE_COPY.status.shared,
  cancelled: '',
  'downloaded-and-copied': SHARE_COPY.status.downloadedAndCopied,
  downloaded: SHARE_COPY.status.downloaded,
  copied: SHARE_COPY.status.copied,
  failed: SHARE_COPY.status.failed,
};

/** The sentence for an outcome. Empty when the learner cancelled. */
export function statusFor(outcome: ShareOutcome): string {
  return STATUS_TEXT[outcome];
}

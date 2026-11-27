import { describe, expect, it, vi } from 'vitest';
import { canUseWebShare, performShare, statusFor } from './share-actions';
import type { ShareEnv, ShareNavigator } from './share-actions';
import { SHARE_COPY } from './share-card-copy';

const PNG = new Blob(['png'], { type: 'image/png' });
const TEXT = 'Escaped a crypt made from my own notes with no ghosts remaining';
const FILE = { name: SHARE_COPY.fileName } as unknown as File;

function env(nav: ShareNavigator, extra: Partial<ShareEnv> = {}): ShareEnv & { download: ReturnType<typeof vi.fn> } {
  return {
    nav,
    makePng: () => Promise.resolve(PNG),
    makeFile: () => FILE,
    download: vi.fn(),
    ...extra,
  } as ShareEnv & { download: ReturnType<typeof vi.fn> };
}
const abort = (): Error => Object.assign(new Error('closed'), { name: 'AbortError' });
const clipboard = () => ({ writeText: vi.fn().mockResolvedValue(undefined) });

describe('performShare with the Web Share API', () => {
  it('shares the PNG with the text when the browser accepts files', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const nav: ShareNavigator = { share, canShare: () => true, clipboard: clipboard() };
    const e = env(nav);
    expect(await performShare(e, TEXT)).toBe('shared');
    expect(share).toHaveBeenCalledExactlyOnceWith({ title: 'Escape the Crypt', text: TEXT, files: [FILE] });
    expect(e.download).not.toHaveBeenCalled();
    expect(nav.clipboard?.writeText).not.toHaveBeenCalled();
  });

  it('shares only the text when the browser cannot share files', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await performShare(env({ share, canShare: () => false }), TEXT)).toBe('shared');
    expect(share).toHaveBeenCalledExactlyOnceWith({ title: 'Escape the Crypt', text: TEXT });
  });

  it('shares only the text when canShare is missing', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    await performShare(env({ share }), TEXT);
    expect(share).toHaveBeenCalledExactlyOnceWith({ title: 'Escape the Crypt', text: TEXT });
  });

  it('shares the text when the PNG could not be drawn', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await performShare(env({ share, canShare: () => true }, { makePng: () => Promise.resolve(null) }), TEXT)).toBe('shared');
    expect(share).toHaveBeenCalledExactlyOnceWith({ title: 'Escape the Crypt', text: TEXT });
  });

  it('does not start a download when the learner closes the share sheet', async () => {
    const e = env({ share: vi.fn().mockRejectedValue(abort()), clipboard: clipboard() });
    expect(await performShare(e, TEXT)).toBe('cancelled');
    expect(e.download).not.toHaveBeenCalled();
    expect(e.nav.clipboard?.writeText).not.toHaveBeenCalled();
  });

  it('falls back to the download and the copy when sharing fails for another reason', async () => {
    const e = env({ share: vi.fn().mockRejectedValue(new Error('NotAllowedError')), clipboard: clipboard() });
    expect(await performShare(e, TEXT)).toBe('downloaded-and-copied');
    expect(e.download).toHaveBeenCalledExactlyOnceWith(PNG, 'escape-the-crypt-card.png');
  });
});

describe('performShare without the Web Share API', () => {
  it('downloads the PNG under the fixed file name and copies the text', async () => {
    const nav: ShareNavigator = { clipboard: clipboard() };
    const e = env(nav);
    expect(canUseWebShare(nav)).toBe(false);
    expect(await performShare(e, TEXT)).toBe('downloaded-and-copied');
    expect(e.download).toHaveBeenCalledExactlyOnceWith(PNG, 'escape-the-crypt-card.png');
    expect(nav.clipboard?.writeText).toHaveBeenCalledExactlyOnceWith(TEXT);
  });

  it('says so when only the download worked', async () => {
    const clip = { writeText: vi.fn().mockRejectedValue(new Error('denied')) };
    expect(await performShare(env({ clipboard: clip }), TEXT)).toBe('downloaded');
    expect(await performShare(env({}), TEXT)).toBe('downloaded');
  });

  it('says so when only the copy worked', async () => {
    const throwing = env({ clipboard: clipboard() }, {});
    throwing.download.mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(await performShare(throwing, TEXT)).toBe('copied');
    expect(await performShare(env({ clipboard: clipboard() }, { makePng: () => Promise.resolve(null) }), TEXT)).toBe('copied');
  });

  it('fails when neither worked, and when drawing throws', async () => {
    expect(await performShare(env({}, { makePng: () => Promise.resolve(null) }), TEXT)).toBe('failed');
    const e = env({ clipboard: clipboard() }, { makePng: () => Promise.reject(new Error('canvas')) });
    expect(await performShare(e, TEXT)).toBe('copied');
  });
});

describe('statusFor', () => {
  it('has a sentence for each result and none for a cancel', () => {
    expect(statusFor('cancelled')).toBe('');
    for (const outcome of ['shared', 'downloaded-and-copied', 'downloaded', 'copied', 'failed'] as const) {
      expect(statusFor(outcome).length).toBeGreaterThan(0);
    }
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArtFailureLog } from './art-failure-log';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createArtFailureLog', () => {
  it('logs a file once however often it fails', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = createArtFailureLog();
    log('background.webp', 'art-load-failed');
    log('background.webp', 'art-load-failed');
    log('background.webp', 'art-load-failed');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('logs each distinct file once', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = createArtFailureLog();
    log('background.webp', 'art-load-failed');
    log('foreground.webp', 'art-load-failed');
    log('scene.json', 'scene-load-failed');
    log('foreground.webp', 'art-load-failed');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('starts fresh for each room mount', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    createArtFailureLog()('background.webp', 'art-load-failed');
    createArtFailureLog()('background.webp', 'art-load-failed');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('logs only the file name and error type', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const learnerText = 'My private notes about mitochondria';
    createArtFailureLog()('rune-cipher/closed.webp', 'art-load-failed');
    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0] ?? [];
    expect(args).toEqual([{ file: 'rune-cipher/closed.webp', errorType: 'art-load-failed' }]);
    expect(Object.keys(args[0] as object).sort()).toEqual(['errorType', 'file']);
    expect(JSON.stringify(args)).not.toContain(learnerText);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserShareEnv, downloadBlob } from './browser-share-env';

describe('downloadBlob', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('clicks a link with the given file name, removes it and releases the URL', () => {
    const create = vi.fn(() => 'blob:card');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const clicked: Array<{ href: string; download: string }> = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute('href') ?? '', download: this.download });
    });
    downloadBlob(new Blob(['x']), 'escape-the-crypt-card.png');
    expect(clicked).toEqual([{ href: 'blob:card', download: 'escape-the-crypt-card.png' }]);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:card');
    expect(document.querySelector('a')).toBeNull();
    click.mockRestore();
  });

  it('releases the URL even when the click throws', () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:card', revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => downloadBlob(new Blob(['x']), 'a.png')).toThrow('blocked');
    expect(revoke).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
});

describe('browserShareEnv', () => {
  it('uses the navigator it is given and makes a PNG file', () => {
    const nav = { clipboard: { writeText: () => Promise.resolve() } };
    const env = browserShareEnv([], nav);
    expect(env.nav).toBe(nav);
    const file = env.makeFile(new Blob(['x']), 'escape-the-crypt-card.png');
    expect(file.name).toBe('escape-the-crypt-card.png');
    expect(file.type).toBe('image/png');
  });

  it('gives no PNG when the design tokens are not on the page, instead of drawing in the wrong colours', async () => {
    expect(await browserShareEnv([], {}).makePng()).toBeNull();
  });
});

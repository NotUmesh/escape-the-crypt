import { readCardPalette, renderCardPng } from './share-card-image';
import type { CanvasLike } from './share-card-image';
import type { CardLine } from './share-card-lines';
import type { ShareEnv, ShareNavigator } from './share-actions';

/** Starts a download of a blob under a fixed, generic file name. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Waits for the page fonts when the browser reports them, so the PNG uses the same type as the page. */
async function fontsReady(): Promise<void> {
  try {
    await document.fonts?.ready;
  } catch {
    // Drawing with a fallback font is better than no card.
  }
}

/** The real browser, wired for `performShare`. The PNG is drawn from the card's own lines. */
export function browserShareEnv(lines: readonly CardLine[], nav: ShareNavigator = navigator): ShareEnv {
  return {
    nav,
    makePng: async () => {
      const palette = readCardPalette(getComputedStyle(document.documentElement));
      if (palette === null) return null;
      await fontsReady();
      return renderCardPng(lines, {
        palette,
        createCanvas: () => document.createElement('canvas') as CanvasLike,
      });
    },
    makeFile: (blob, name) => new File([blob], name, { type: 'image/png' }),
    download: downloadBlob,
  };
}

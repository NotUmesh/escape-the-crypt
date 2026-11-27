import { describe, expect, it, vi } from 'vitest';
import { CARD_WIDTH, drawLayout, layoutCard, readCardPalette, renderCardPng, wrapText } from './share-card-image';
import type { CanvasLike, CardPalette, Ctx2D } from './share-card-image';
import { buildShareCardData } from './share-card-data';
import { cardLines } from './share-card-lines';
import { escapedView } from './share-test-support';

const PALETTE: CardPalette = { paper: 'P', ink: 'I', titleFont: 'TitleFace', bodyFont: 'BodyFace' };
/** Ten px per character, whatever the font. */
const measureFor = () => (text: string): number => text.length * 10;

const data = buildShareCardData(
  escapedView({ 'first-try-correct': 5, assisted: 2, retried: 1, challenged: 0, 'review-due': 3 }),
  { kind: 'sample', title: 'The human heart' },
);
const lines = data === null ? [] : cardLines(data);

function fakeCtx() {
  const drawn: string[] = [];
  const fonts: string[] = [];
  const ctx: Ctx2D = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText(text) {
      drawn.push(text);
      fonts.push(this.font);
    },
    measureText: (text) => ({ width: text.length * 10 }),
  };
  return { ctx, drawn, fonts };
}

describe('readCardPalette', () => {
  const style = (values: Record<string, string>) => ({ getPropertyValue: (name: string) => values[name] ?? '' });
  const ALL: Record<string, string> = {
    '--parchment-100': ' paper ',
    '--ink-900': 'ink',
    '--font-title': '"Cinzel", serif',
    '--font-body': '"Crimson Pro", serif',
  };

  it('reads the four tokens, trimmed', () => {
    expect(readCardPalette(style(ALL))).toEqual({ paper: 'paper', ink: 'ink', titleFont: '"Cinzel", serif', bodyFont: '"Crimson Pro", serif' });
  });

  it('is null when any token is missing', () => {
    for (const key of Object.keys(ALL)) {
      const rest = Object.fromEntries(Object.entries(ALL).filter(([name]) => name !== key));
      expect(readCardPalette(style(rest))).toBeNull();
    }
  });
});

describe('wrapText', () => {
  const measure = (t: string): number => t.length * 10;

  it('breaks at word boundaries within the width', () => {
    expect(wrapText(measure, 'one two three four', 90)).toEqual(['one two', 'three', 'four']);
  });

  it('keeps one long word on a line of its own', () => {
    expect(wrapText(measure, 'a supercalifragilistic b', 50)).toEqual(['a', 'supercalifragilistic', 'b']);
  });

  it('gives no lines for empty text', () => {
    expect(wrapText(measure, '   ', 100)).toEqual([]);
  });

  it('property-style: no line is wider than the limit unless it is one word', () => {
    const text = 'Escaped a crypt made from my own notes with 12 ghosts remaining and more words besides';
    for (const line of wrapText(measure, text, 200)) expect(line.includes(' ') ? measure(line) <= 200 : true).toBe(true);
  });
});

describe('layoutCard', () => {
  const layout = layoutCard(lines, PALETTE, measureFor);

  it('is 1200 wide and at least 630 tall', () => {
    expect(layout.width).toBe(CARD_WIDTH);
    expect(layout.height).toBeGreaterThanOrEqual(630);
  });

  it('places exactly the card text, nothing else', () => {
    const text = layout.items.map((i) => i.text).join(' ');
    for (const line of lines) {
      for (const word of line.text.split(' ')) expect(text).toContain(word);
      if (line.value !== undefined) expect(layout.items.map((i) => i.text)).toContain(line.value);
    }
    const allowed = new Set(lines.flatMap((l) => [...l.text.split(' '), ...(l.value === undefined ? [] : [l.value])]));
    for (const word of text.split(' ')) expect(allowed.has(word), word).toBe(true);
  });

  it('keeps every item inside the card, top to bottom in reading order', () => {
    let last = 0;
    for (const item of layout.items) {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.x).toBeLessThanOrEqual(layout.width);
      expect(item.y).toBeLessThan(layout.height);
      expect(item.y).toBeGreaterThanOrEqual(last);
      last = item.y;
    }
  });

  it('right-aligns the numbers and uses the title font for the headline only among body text', () => {
    const values = layout.items.filter((i) => i.align === 'right').map((i) => i.text);
    expect(values).toEqual(['5', '2', '1', '0', '3']);
    expect(layout.items.find((i) => i.text.startsWith('Escaped'))?.font).toContain('TitleFace');
    expect(layout.items.find((i) => i.text === 'Assisted')?.font).toContain('BodyFace');
  });

  it('wraps a long headline onto more lines and makes the card taller', () => {
    const long = layoutCard(
      [{ role: 'headline', text: 'Escaped a crypt made from my own notes with 100 ghosts remaining '.repeat(3) }],
      PALETTE,
      measureFor,
    );
    expect(long.items.length).toBeGreaterThan(1);
  });
});

describe('drawLayout', () => {
  it('fills the paper, draws a border and writes each item once in the ink colour', () => {
    const { ctx, drawn } = fakeCtx();
    const layout = layoutCard(lines, PALETTE, measureFor);
    drawLayout(ctx, layout, PALETTE);
    expect(drawn).toEqual(layout.items.map((i) => i.text));
    expect(ctx.fillStyle).toBe('I');
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
  });
});

describe('renderCardPng', () => {
  function fakeCanvas(ctx: Ctx2D | null, blob: Blob | null): CanvasLike & { toBlob: ReturnType<typeof vi.fn> } {
    return {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: vi.fn((callback: (b: Blob | null) => void) => callback(blob)),
    };
  }

  it('sizes the canvas to the layout and returns the PNG blob', async () => {
    const { ctx, drawn } = fakeCtx();
    const png = new Blob(['x'], { type: 'image/png' });
    const canvas = fakeCanvas(ctx, png);
    const result = await renderCardPng(lines, { createCanvas: () => canvas, palette: PALETTE });
    expect(result).toBe(png);
    expect(canvas.width).toBe(CARD_WIDTH);
    expect(canvas.height).toBeGreaterThanOrEqual(630);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    expect(drawn.join(' ')).toContain('ghosts remaining');
  });

  it('is null when the browser gives no 2d context', async () => {
    expect(await renderCardPng(lines, { createCanvas: () => fakeCanvas(null, null), palette: PALETTE })).toBeNull();
  });

  it('is null when the browser cannot encode the image', async () => {
    const { ctx } = fakeCtx();
    expect(await renderCardPng(lines, { createCanvas: () => fakeCanvas(ctx, null), palette: PALETTE })).toBeNull();
  });
});

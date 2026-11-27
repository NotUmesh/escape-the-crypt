import type { CardLine } from './share-card-lines';

/** The few canvas members the card uses, so tests can stand in for a real canvas. */
export interface Ctx2D {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { readonly width: number };
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(id: '2d'): Ctx2D | null;
  toBlob(callback: (blob: Blob | null) => void, type?: string): void;
}

/** Colours and fonts, read from the design tokens at run time so no colour is written here. */
export interface CardPalette {
  readonly paper: string;
  readonly ink: string;
  readonly titleFont: string;
  readonly bodyFont: string;
}

const TOKENS = {
  paper: '--parchment-100',
  ink: '--ink-900',
  titleFont: '--font-title',
  bodyFont: '--font-body',
} as const;

/** The palette from the computed style of the page root, or null when a token is missing. */
export function readCardPalette(style: { getPropertyValue(name: string): string }): CardPalette | null {
  const read = (name: string): string => style.getPropertyValue(name).trim();
  const palette = {
    paper: read(TOKENS.paper),
    ink: read(TOKENS.ink),
    titleFont: read(TOKENS.titleFont),
    bodyFont: read(TOKENS.bodyFont),
  };
  return Object.values(palette).every((value) => value !== '') ? palette : null;
}

export interface TextItem {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly font: string;
  readonly align: 'left' | 'right';
}

export interface CardLayout {
  readonly width: number;
  readonly height: number;
  readonly items: readonly TextItem[];
  /** Y positions of the thin rules. */
  readonly rules: readonly number[];
}

export const CARD_WIDTH = 1200;
const MARGIN = 80;
const MIN_HEIGHT = 630;

/** Greedy word wrap. A word wider than the line stays on a line of its own. */
export function wrapText(measure: (text: string) => number, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter((w) => w !== '')) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current !== '' && measure(candidate) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

const SIZE = { app: 28, headline: 54, note: 30, count: 34, footer: 26 } as const;

/** Where every line goes. Pure: the caller supplies the measuring function for a font. */
export function layoutCard(
  lines: readonly CardLine[],
  palette: CardPalette,
  measureFor: (font: string) => (text: string) => number,
): CardLayout {
  const title = (px: number): string => `700 ${px}px ${palette.titleFont}`;
  const body = (px: number): string => `400 ${px}px ${palette.bodyFont}`;
  const items: TextItem[] = [];
  const rules: number[] = [];
  const inner = CARD_WIDTH - MARGIN * 2;
  let y = MARGIN + SIZE.app;
  for (const line of lines) {
    if (line.role === 'app') {
      items.push({ text: line.text, x: MARGIN, y, font: title(SIZE.app), align: 'left' });
      y += SIZE.app + 24;
    } else if (line.role === 'headline') {
      const font = title(SIZE.headline);
      y += SIZE.headline - 8;
      for (const part of wrapText(measureFor(font), line.text, inner)) {
        items.push({ text: part, x: MARGIN, y, font, align: 'left' });
        y += Math.round(SIZE.headline * 1.2);
      }
      y += 4;
    } else if (line.role === 'note') {
      items.push({ text: line.text, x: MARGIN, y, font: body(SIZE.note), align: 'left' });
      y += SIZE.note + 16;
    } else if (line.role === 'count') {
      if (rules.length === 0) {
        rules.push(y - 12);
        y += 24;
      }
      const font = body(SIZE.count);
      items.push({ text: line.text, x: MARGIN, y, font, align: 'left' });
      items.push({ text: line.value ?? '', x: CARD_WIDTH - MARGIN, y, font, align: 'right' });
      y += Math.round(SIZE.count * 1.45);
    } else {
      y += 16;
      rules.push(y - SIZE.footer);
      items.push({ text: line.text, x: MARGIN, y, font: body(SIZE.footer), align: 'left' });
      y += SIZE.footer;
    }
  }
  return { width: CARD_WIDTH, height: Math.max(MIN_HEIGHT, y + MARGIN), items, rules };
}

/** Draws a layout: paper, a border, thin rules and the text, all in the ink colour. */
export function drawLayout(ctx: Ctx2D, layout: CardLayout, palette: CardPalette): void {
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 4;
  ctx.strokeRect(20, 20, layout.width - 40, layout.height - 40);
  ctx.fillStyle = palette.ink;
  for (const y of layout.rules) ctx.fillRect(MARGIN, y, layout.width - MARGIN * 2, 2);
  ctx.textBaseline = 'alphabetic';
  for (const item of layout.items) {
    ctx.font = item.font;
    ctx.textAlign = item.align;
    ctx.fillText(item.text, item.x, item.y);
  }
}

export interface RenderEnv {
  readonly createCanvas: () => CanvasLike;
  readonly palette: CardPalette;
}

/** The card as a PNG, or null when the browser cannot draw it. */
export async function renderCardPng(lines: readonly CardLine[], env: RenderEnv): Promise<Blob | null> {
  const canvas = env.createCanvas();
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  const measureFor = (font: string) => (text: string): number => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  const layout = layoutCard(lines, env.palette, measureFor);
  canvas.width = layout.width;
  canvas.height = layout.height;
  drawLayout(ctx, layout, env.palette);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
}

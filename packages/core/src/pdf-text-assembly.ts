/** One pdf.js text item reduced to the fields the assembler needs. */
export interface TextItemData {
  str: string;
  /** Vertical position, `transform[5]` in pdf.js. */
  y: number;
  /** Item height. */
  height: number;
  hasEOL: boolean;
}

/** A gap above this multiple of the median line height is a paragraph break. */
export const PARAGRAPH_GAP_FACTOR = 1.5;

/** A y change above this fraction of the item height starts a new line. */
export const LINE_Y_TOLERANCE_FACTOR = 0.5;

interface Line {
  text: string;
  y: number;
  height: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function buildLines(items: readonly TextItemData[]): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  let lastY = 0;
  let breakPending = false;

  for (const item of items) {
    if (item.str === '') {
      if (item.hasEOL) breakPending = true;
      continue;
    }
    const tolerance = Math.abs(item.height) * LINE_Y_TOLERANCE_FACTOR;
    if (current === null || breakPending || Math.abs(item.y - lastY) > tolerance) {
      current = { text: '', y: item.y, height: 0 };
      lines.push(current);
    }
    current.text += item.str;
    current.height = Math.max(current.height, item.height);
    lastY = item.y;
    breakPending = item.hasEOL;
  }
  return lines;
}

/**
 * Turns pdf.js text items (in reading order) into page text.
 * Lines are joined with "\n"; a vertical gap above
 * PARAGRAPH_GAP_FACTOR times the median line height gives "\n\n".
 */
export function assemblePageText(items: readonly TextItemData[]): string {
  const lines = buildLines(items);
  const first = lines[0];
  if (first === undefined) return '';

  const limit = PARAGRAPH_GAP_FACTOR * median(lines.map((l) => l.height));
  let out = first.text;
  for (let i = 1; i < lines.length; i += 1) {
    const prev = lines[i - 1] as Line;
    const line = lines[i] as Line;
    const gap = Math.abs(prev.y - line.y);
    out += (gap > limit ? '\n\n' : '\n') + line.text;
  }
  return out;
}

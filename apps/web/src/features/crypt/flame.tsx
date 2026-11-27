import type { ReactNode } from 'react';
import './flame.css';

export type FlameKind = 'progress' | 'ambient' | 'spirit';

/** Flame width as a share of the art frame width, per `scale` of 1. Every progress candle gets the same size. */
const WIDTH_SHARE: Readonly<Record<FlameKind, number>> = { progress: 0.011, ambient: 0.008, spirit: 0.008 };
const MIN_WIDTH_PX = 6;

export function flameWidth(kind: FlameKind, scale: number, frameWidth: number): number {
  return Math.max(WIDTH_SHARE[kind] * frameWidth * scale, MIN_WIDTH_PX);
}

export interface FlameProps {
  readonly kind: FlameKind;
  /** Where the base of the flame sits, in stage px. */
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  /** Width of the art frame in stage px. */
  readonly frameWidth: number;
  /** True for a flame lit by a fresh notice (short flare, then flicker). False draws the steady flicker at once. */
  readonly ignite: boolean;
  readonly data?: Readonly<Record<string, string>>;
}

/**
 * A gold flame drawn in code (asset contract: the art holds no flame). Colours come from tokens in CSS.
 * The animation lives in CSS classes so reduced motion can switch it off.
 */
export function Flame({ kind, x, y, scale, frameWidth, ignite, data }: FlameProps): ReactNode {
  const width = flameWidth(kind, scale, frameWidth);
  const dataAttributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(data ?? {})) dataAttributes[`data-${key}`] = value;
  return (
    <span
      className={`flame flame--${kind}${ignite ? ' flame--ignite' : ''}`}
      data-flame={kind}
      data-ignite={ignite ? 'true' : 'false'}
      style={{ left: x, top: y, width, height: width * 1.5 }}
      aria-hidden="true"
      {...dataAttributes}
    >
      <svg className="flame__body" viewBox="0 0 20 30" focusable="false">
        <path className="flame__outer" d="M10 1 C 12 8 18 13 18 20 A 8 8 0 0 1 2 20 C 2 14 7 11 10 1 Z" />
        <path className="flame__core" d="M10 14 C 11.5 18 14 20 14 23 A 4 4 0 0 1 6 23 C 6 20 8.5 18 10 14 Z" />
      </svg>
    </span>
  );
}

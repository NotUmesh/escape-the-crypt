import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

type Pair = readonly [string, string];
type Buttons = RefObject<Map<string, HTMLButtonElement>>;

interface Props {
  readonly pairs: readonly Pair[];
  readonly hintedPair: Pair | null;
  readonly leftButtons: Buttons;
  readonly rightButtons: Buttons;
}

export function ThreadLines({ pairs, hintedPair, leftButtons, rightButtons }: Props) {
  const drawing = useRef<SVGSVGElement>(null);
  const [lines, setLines] = useState<readonly { id: string; path: string; knot: readonly [number, number] | null }[]>([]);

  useLayoutEffect(() => {
    function measure(): void {
      const board = drawing.current;
      if (board === null) return;
      const { left: originX, top: originY } = board.getBoundingClientRect();
      setLines(pairs.flatMap(([left, right]) => {
        const from = leftButtons.current.get(left)?.getBoundingClientRect();
        const to = rightButtons.current.get(right)?.getBoundingClientRect();
        if (from === undefined || to === undefined) return [];
        const x1 = from.right - originX;
        const x2 = to.left - originX;
        const y1 = from.top + from.height / 2 - originY;
        const y2 = to.top + to.height / 2 - originY;
        const mid = (x1 + x2) / 2;
        return [{
          id: left,
          path: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`,
          knot: hintedPair?.[0] === left ? [mid, (y1 + y2) / 2] : null,
        }];
      }));
    }

    const board = drawing.current;
    if (board === null) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    for (const button of [...leftButtons.current.values(), ...rightButtons.current.values()]) observer.observe(button);
    return () => observer.disconnect();
  }, [pairs, hintedPair, leftButtons, rightButtons]);

  return (
    <svg ref={drawing} className="bound-threads-panel__strings" aria-hidden="true" focusable="false">
      {lines.map(({ id, path, knot }) => (
        <g key={id}>
          <path d={path} data-hinted={knot !== null} />
          {knot === null ? null : <circle cx={knot[0]} cy={knot[1]} r="2" />}
        </g>
      ))}
    </svg>
  );
}

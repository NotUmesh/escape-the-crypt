import { useCallback, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Flame } from '../crypt/flame';
import { usePrefersReducedMotion } from '../use-prefers-reduced-motion';
import { useElementSize, useWindowViewport } from '../crypt/use-stage-size';
import {
  DESK_ANCHOR_Y,
  DESK_ART_SIZE,
  DESK_BOOK_POINT,
  DESK_CANDLE_POINT,
  coverPoint,
  coverScale,
  deskSetFor,
} from './desk-scene-layout';
import type { Size } from './desk-scene-layout';
import './desk-scene.css';

export interface DeskSceneProps {
  /** `book` pushes the camera in on the open book when the screen mounts. */
  readonly variant: 'hub' | 'book';
  readonly children: ReactNode;
  /** Window size; the real window when omitted. Tests pass one. */
  readonly viewport?: Size;
}

const ART = '/art/desk';

/**
 * The desk as art layers behind the screen's own panels. The art is decoration: it has no text,
 * no controls and `aria-hidden`, and the candle flame is drawn in code.
 */
export function DeskScene({ variant, children, viewport }: DeskSceneProps): ReactNode {
  const window = useWindowViewport(viewport);
  const set = deskSetFor(window);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stage = useElementSize(stageRef, window);
  const reducedMotion = usePrefersReducedMotion();
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const onFail = useCallback((file: string): void => setFailed((prev) => new Set(prev).add(file)), []);

  const source = DESK_ART_SIZE[set];
  const anchorY = DESK_ANCHOR_Y[set];
  const scale = coverScale(source, stage);
  const candle = useMemo(() => coverPoint(DESK_CANDLE_POINT[set], source, stage, anchorY), [set, source, stage, anchorY]);
  const book = useMemo(() => coverPoint(DESK_BOOK_POINT[set], source, stage, anchorY), [set, source, stage, anchorY]);
  const pushes = variant === 'book' && !reducedMotion;
  const stageStyle = { '--push-origin': `${Math.round(book.x)}px ${Math.round(book.y)}px` } as CSSProperties;
  const img = (file: string, className: string, srcSet?: string): ReactNode =>
    failed.has(file) ? null : (
      <img
        alt=""
        draggable={false}
        className={`desk-scene__layer ${className}`}
        src={`${ART}/${file}`}
        srcSet={srcSet}
        onError={() => onFail(file)}
      />
    );

  return (
    <div
      className="desk-scene"
      data-testid="desk-scene"
      data-set={set}
      data-variant={variant}
      data-push={pushes ? 'true' : 'false'}
    >
      <div className="desk-scene__stage" ref={stageRef} style={stageStyle} aria-hidden="true">
        {img(
          `${set}/background.webp`,
          'desk-scene__background',
          set === 'desktop' ? `${ART}/desktop/background.webp 1x, ${ART}/desktop/background@2x.webp 2x` : undefined,
        )}
        {img(`${set}/candle.webp`, 'desk-scene__candle')}
        {scale > 0 ? (
          <Flame kind="ambient" x={candle.x} y={candle.y} scale={1.4} frameWidth={source.width * scale} ignite={false} />
        ) : null}
        {set === 'desktop' ? img('desktop/foreground.webp', 'desk-scene__foreground') : null}
      </div>
      <div className="desk-scene__content">{children}</div>
    </div>
  );
}

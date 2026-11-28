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
import { DESK_ART, DESK_PROPS, deskPropFile, useDeskPlacement } from './desk-props';
import type { DeskPlacement, DeskProp } from './desk-props';
import { createArtFailureLog } from '../crypt/art-failure-log';
import './desk-scene.css';

export interface DeskSceneProps {
  /** `book` pushes the camera in on the open book when the screen mounts. */
  readonly variant: 'hub' | 'book';
  readonly children: ReactNode | ((placement: DeskPlacement | null, stage: Size) => ReactNode);
  /** Window size; the real window when omitted. Tests pass one. */
  readonly viewport?: Size;
  readonly litProps?: readonly (DeskProp | null)[];
}

const ART = DESK_ART;

/**
 * The desk as art layers behind the screen's own panels. The art is decoration: it has no text,
 * no controls and `aria-hidden`, and the candle flame is drawn in code.
 */
export function DeskScene({ variant, children, viewport, litProps }: DeskSceneProps): ReactNode {
  const window = useWindowViewport(viewport);
  const set = deskSetFor(window);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stage = useElementSize(stageRef, window);
  const reducedMotion = usePrefersReducedMotion();
  const placement = useDeskPlacement(variant === 'hub' && set === 'desktop');
  const [log] = useState(createArtFailureLog);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const onFail = useCallback((file: string): void => {
    log(`${ART}/${file}`, 'art-load-failed');
    setFailed((prev) => new Set(prev).add(file));
  }, [log]);

  const source = placement?.size ?? DESK_ART_SIZE[set];
  const anchorY = DESK_ANCHOR_Y[set];
  const scale = coverScale(source, stage);
  const candle = useMemo(() => coverPoint(placement === null ? DESK_CANDLE_POINT[set] : {
    x: placement.candle.x * source.width, y: placement.candle.y * source.height,
  }, source, stage, anchorY), [set, placement, source, stage, anchorY]);
  const book = useMemo(() => coverPoint(DESK_BOOK_POINT[set], source, stage, anchorY), [set, source, stage, anchorY]);
  const pushes = variant === 'book' && !reducedMotion;
  const stageStyle = { '--push-origin': `${Math.round(book.x)}px ${Math.round(book.y)}px` } as CSSProperties;
  const img = (file: string, className: string, srcSet?: string, visible?: boolean): ReactNode =>
    failed.has(file) ? null : (
      <img
        key={file}
        alt=""
        draggable={false}
        className={`desk-scene__layer ${className}`}
        src={`${ART}/${file}`}
        srcSet={srcSet}
        data-visible={visible}
        onLoad={file.endsWith('-hover.webp') ? () => setLoaded((prev) => new Set(prev).add(file)) : undefined}
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
        {set === 'desktop' ? DESK_PROPS.map((prop) => {
          const baseFile = deskPropFile(prop);
          const hoverFile = deskPropFile(prop, true);
          const lit = (litProps?.includes(prop) === true || failed.has(baseFile)) && loaded.has(hoverFile) && !failed.has(hoverFile);
          return [
            img(baseFile, 'desk-scene__prop', undefined, !lit),
            variant === 'book' ? null : img(hoverFile, 'desk-scene__prop', undefined, lit),
          ];
        }) : null}
        {img(`${set}/candle.webp`, 'desk-scene__candle')}
        {scale > 0 ? (
          <Flame kind="ambient" x={candle.x} y={candle.y} scale={placement?.candle.scale ?? 1.4} frameWidth={source.width * scale} ignite={false} />
        ) : null}
        {set === 'desktop' ? img('desktop/foreground.webp', 'desk-scene__foreground') : null}
      </div>
      <div className="desk-scene__content">
        {typeof children === 'function' ? children(failed.has('desktop/background.webp') ? null : placement, stage) : children}
      </div>
    </div>
  );
}

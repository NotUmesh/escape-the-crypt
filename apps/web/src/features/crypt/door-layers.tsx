import type { ReactNode } from 'react';
import { ArtImage } from './art-image';
import type { ArtContext } from './art-image';

export interface DoorLayersProps {
  readonly ctx: ArtContext;
  /** The room is cleared: the door is open and its light is on. */
  readonly open: boolean;
  /** True on the render where `roomCleared` arrived: crossfade closed to open, fade the light in (about 600 ms). */
  readonly animate: boolean;
}

/**
 * The door image and, once it is open, its additive light. A door drawn from State alone has no
 * animation; the closed image is kept only while it fades out.
 */
export function DoorLayers({ ctx, open, animate }: DoorLayersProps): ReactNode {
  return (
    <>
      {!open || animate ? (
        <ArtImage
          ctx={ctx}
          layer="door"
          file="door-closed.webp"
          className={open ? 'art-layer--fade-out' : undefined}
          data={{ door: 'closed' }}
        />
      ) : null}
      {open ? (
        <>
          <ArtImage
            ctx={ctx}
            layer="door"
            file="door-open.webp"
            className={animate ? 'art-layer--fade-in' : undefined}
            data={{ door: 'open' }}
          />
          <ArtImage
            ctx={ctx}
            layer="door"
            file="light-door.webp"
            className={`art-layer--light${animate ? ' art-layer--fade-in' : ''}`}
            data={{ door: 'light' }}
          />
        </>
      ) : null}
    </>
  );
}

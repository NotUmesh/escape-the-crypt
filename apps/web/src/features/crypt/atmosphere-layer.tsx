import type { CSSProperties, ReactNode } from 'react';
import './atmosphere-layer.css';

export interface AtmosphereLayerProps {
  /** Lit candles over all candles in the room, 0..1. The darkness thins as it rises. */
  readonly lit: number;
}

/**
 * Darkness, vignette, grain and mist, drawn in code over the art (design: built in code, never art).
 * Every part ignores the pointer, and the stage keeps it below the control layer. Lantern_Mode does not
 * mount it at all (Requirement 12.4). Nothing here flashes or shakes.
 */
export function AtmosphereLayer({ lit }: AtmosphereLayerProps): ReactNode {
  const style = { '--atmosphere-lit': String(Math.max(0, Math.min(1, lit))) } as CSSProperties;
  return (
    <div className="atmosphere" data-testid="atmosphere" aria-hidden="true" style={style}>
      <span className="atmosphere__darkness" />
      <span className="atmosphere__mist" />
      <span className="atmosphere__vignette" />
      <span className="atmosphere__grain" />
    </div>
  );
}

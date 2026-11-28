import { useCallback, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { LockSlotState, LockType, Outcome_Notice } from '@escape-the-crypt/core';
import { artEffectsFrom } from './art-effects';
import { ArtImage } from './art-image';
import type { ArtContext } from './art-image';
import type { ArtFailureLog } from './art-failure-log';
import type { Viewport } from './crop-mapping';
import { DoorLayers } from './door-layers';
import { Flame } from './flame';
import { GhostLayer } from './ghost-layer';
import type { GhostItem } from './ghost-list';
import { HotspotButton } from './hotspot-button';
import { usePrefersReducedMotion } from '../use-prefers-reduced-motion';
import { LockLayer, lightImageFile, shouldDrawFlame } from './lock-layer';
import { momentsForStage } from './motion-moments';
import { chooseBlock, isPhoneViewport, layoutScene } from './scene-layout';
import type { SceneLayout } from './scene-layout';
import type { SceneFile } from './scene-types';
import { useParallax } from './use-parallax';
import { useElementSize, useWindowViewport } from './use-stage-size';
import './art-stage.css';

export interface ArtStageProps {
  readonly artRoom: string;
  readonly scene: SceneFile;
  /** The slots that have art (see `partitionDrawnSlots`). */
  readonly slots: readonly LockSlotState[];
  readonly cleared: boolean;
  /** The room this stage draws, to match 
oomCleared notices. */
  readonly roomId?: string;
  readonly log: ArtFailureLog;
  /** Opens a lock. Without it the stage draws no lock buttons (the final door and the escape view). */
  readonly onActivate?: (slot: LockSlotState, opener: HTMLButtonElement) => void;
  /** Notices from the latest accepted dispatch. Only these start animations. */
  readonly notices?: readonly Outcome_Notice[];
  readonly ghosts?: readonly GhostItem[];
  readonly spiritCandleCount?: number;
  /** Drawn in the controls layer, above the art (the seals). */
  readonly overlay?: (layout: SceneLayout) => ReactNode;
  /** Window size; the real window when omitted. Tests pass one. */
  readonly viewport?: Viewport;
}

const NO_NOTICES: readonly Outcome_Notice[] = [];
const NO_GHOSTS: readonly GhostItem[] = [];
function toggled<T>(set: ReadonlySet<T>, value: T, on: boolean): ReadonlySet<T> {
  if (set.has(value) === on) return set;
  const next = new Set(set);
  if (on) next.add(value);
  else next.delete(value);
  return next;
}

/**
 * The room as layers: background, one lock layer per drawn lock, light passes, the door, the foreground,
 * all at 0,0 in that order (Requirement 7.4), with a native button over each lock (Requirement 10.1).
 */
export function ArtStage({
  artRoom,
  scene,
  slots,
  cleared,
  roomId,
  log,
  onActivate,
  notices = NO_NOTICES,
  ghosts = NO_GHOSTS,
  spiritCandleCount = 0,
  overlay,
  viewport,
}: ArtStageProps): ReactNode {
  const windowSize = useWindowViewport(viewport);
  const phone = isPhoneViewport(windowSize);
  const { block } = chooseBlock(scene, phone);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fallback = useMemo<Viewport>(
    () =>
      phone ? windowSize : { width: windowSize.width, height: (windowSize.width * block.size[1]) / block.size[0] },
    [phone, windowSize, block.size],
  );
  const stage = useElementSize(stageRef, fallback);
  const reducedMotion = usePrefersReducedMotion();
  useParallax(stageRef, !reducedMotion);
  const layout = useMemo(() => layoutScene(scene, slots, stage, phone), [scene, slots, stage, phone]);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [hovering, setHovering] = useState<ReadonlySet<LockType>>(new Set());
  const [focused, setFocused] = useState<ReadonlySet<LockType>>(new Set());
  const onFail = useCallback(
    (path: string) => {
      log(path, 'art-load-failed');
      setFailed((prev) => toggled(prev, path, true));
    },
    [log],
  );
  const ctx: ArtContext = { artRoom, directory: layout.directory, frame: layout.frame, failed, onFail };
  const effects = artEffectsFrom(notices);
  // Which moments are playing, for tests and styles to read. Derived from the notices and what is drawn.
  const moments = momentsForStage(notices, {
    litSlotIds: new Set(slots.filter((s) => s.candleLit).map((s) => s.slotId)),
    pendingConceptIds: new Set(ghosts.map((g) => g.conceptId)),
  });
  const doorAnimates = cleared && roomId !== undefined && effects.clearedRooms.has(roomId);
  const stageStyle = {
    ...(phone ? {} : { aspectRatio: `${block.size[0]} / ${block.size[1]}` }),
    '--parallax-background': String(block.parallax.background),
    '--parallax-locks': String(block.parallax.locks),
    '--parallax-door': String(block.parallax.door ?? block.parallax.locks),
    '--parallax-foreground': String(block.parallax.foreground),
  } as CSSProperties;
  const base = `/art/rooms/${artRoom}/desktop/background`;
  // Only the desktop set has an @2x background.
  const backgroundSrcSet = layout.directory === 'desktop' ? `${base}.webp 1x, ${base}@2x.webp 2x` : undefined;
  return (
    <div
      ref={stageRef}
      className={`art-stage${phone ? ' art-stage--phone' : ''}`}
      data-testid="art-stage"
      data-cropped={layout.cropped ? 'true' : 'false'}
      data-directory={layout.directory}
      data-parallax={reducedMotion ? 'off' : 'on'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-moment={moments.length === 0 ? undefined : moments.map((m) => m.kind).join(' ')}
      style={stageStyle}
    >
      <ArtImage ctx={ctx} layer="background" file="background.webp" srcSet={backgroundSrcSet} />
      {layout.stacked.map((lock) => (
        <LockLayer
          key={lock.slot.slotId}
          ctx={ctx}
          lockType={lock.lockType}
          status={lock.slot.status}
          hovered={hovering.has(lock.lockType) || focused.has(lock.lockType)}
          animateSolve={effects.litSlots.has(lock.slot.slotId) && shouldDrawFlame(lock.slot.status, lock.slot.candleLit)}
        />
      ))}
      {layout.stacked.map((lock) =>
        shouldDrawFlame(lock.slot.status, lock.slot.candleLit) ? (
          <ArtImage
            key={lock.slot.slotId}
            ctx={ctx}
            layer="light"
            file={lightImageFile(lock.lockType)}
            className={effects.litSlots.has(lock.slot.slotId) ? 'art-layer--fade-in' : undefined}
            data={{ lock: lock.lockType }}
          />
        ) : null,
      )}
      <DoorLayers ctx={ctx} open={cleared} animate={doorAnimates} />
      <div className="art-stage__flames" data-testid="art-flames">
        {layout.ambientCandles.map((candle, index) => (
          <Flame
            key={`ambient-${index}`}
            kind="ambient"
            x={candle.x}
            y={candle.y}
            scale={candle.scale}
            frameWidth={layout.frame.width}
            ignite={false}
          />
        ))}
        {layout.stacked.map((lock) =>
          shouldDrawFlame(lock.slot.status, lock.slot.candleLit) ? (
            <Flame
              key={lock.slot.slotId}
              kind="progress"
              x={lock.candle.x}
              y={lock.candle.y}
              scale={lock.candle.scale}
              frameWidth={layout.frame.width}
              ignite={effects.litSlots.has(lock.slot.slotId)}
              data={{ lock: lock.lockType }}
            />
          ) : null,
        )}
      </div>
      <ArtImage ctx={ctx} layer="foreground" file="foreground.webp" />
      <GhostLayer
        anchors={layout.ghostAnchors}
        frameWidth={layout.frame.width}
        ghosts={ghosts}
        spiritCandleCount={spiritCandleCount}
        effects={effects}
      />
      <div className="art-stage__controls">
        {overlay?.(layout)}
        {onActivate === undefined ? null : layout.locks.map((lock) => (
          <HotspotButton
            key={lock.slot.slotId}
            lock={lock}
            zIndex={layout.stacked.indexOf(lock) + 1}
            onActivate={(opener) => onActivate(lock.slot, opener)}
            onHoverChange={(on) => setHovering((prev) => toggled(prev, lock.lockType, on))}
            onFocusChange={(on) => setFocused((prev) => toggled(prev, lock.lockType, on))}
          />
        ))}
      </div>
    </div>
  );
}

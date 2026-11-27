import type { ReactNode } from 'react';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { lockName } from './accessible-names';
import type { DrawnLock } from './scene-layout';

export interface HotspotButtonProps {
  readonly lock: DrawnLock;
  /** Stack position: higher is on top, so the lock with the smaller depth wins (Requirement 10.4). */
  readonly zIndex: number;
  readonly onActivate: (opener: HTMLButtonElement) => void;
  readonly onHoverChange: (hovered: boolean) => void;
  readonly onFocusChange: (focused: boolean) => void;
}

/**
 * One native button over a lock's hotspot (Requirements 10.1, 10.2). Its name is the same
 * `lockName` the plain list uses. Hover and focus only change the picture, never what the button does.
 */
export function HotspotButton({ lock, zIndex, onActivate, onHoverChange, onFocusChange }: HotspotButtonProps): ReactNode {
  const { slot, box } = lock;
  const name = lockName(slot.stationType, slot.status);
  return (
    <>
      <button
        type="button"
        className="room-screen__lock-button room-hotspot"
        data-status={slot.status}
        data-lock={slot.stationType}
        aria-label={name}
        style={{ left: box.x, top: box.y, width: box.width, height: box.height, zIndex }}
        onClick={(event) => onActivate(event.currentTarget)}
        onPointerEnter={() => onHoverChange(true)}
        onPointerLeave={() => onHoverChange(false)}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
      />
      {slot.status === 'challenged' ? (
        <span
          className="room-screen__challenged room-hotspot__note"
          style={{ left: box.x, top: box.y + box.height, maxWidth: Math.max(box.width, 120), zIndex }}
        >
          {ROOM_PLAY_LABELS.challengedLabel}
        </span>
      ) : null}
    </>
  );
}

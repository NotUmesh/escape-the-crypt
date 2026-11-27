import type { ReactNode } from 'react';

export const SAVE_BANNER_TEXT = "Your progress isn't being saved on this device. Export a copy to keep it.";

export interface SaveBannerProps {
  /** True when the writer reports that saving to this device failed. */
  readonly saveFailed: boolean;
  /** Slot for the export control (added in task 9.2). */
  readonly exportSlot?: ReactNode;
}

/**
 * Tells the learner that progress is not being saved. The status region stays mounted so a
 * screen reader announces the text when it appears. It sits in normal flow above the room and
 * never overlays the question or evidence panels.
 */
export function SaveBanner({ saveFailed, exportSlot }: SaveBannerProps): ReactNode {
  return (
    <div role="status" className="save-banner-region" data-testid="save-banner">
      {saveFailed ? (
        <div className="save-banner">
          <p>{SAVE_BANNER_TEXT}</p>
          {exportSlot}
        </div>
      ) : null}
    </div>
  );
}

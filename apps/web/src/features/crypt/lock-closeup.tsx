import { useState } from 'react';
import type { ReactNode } from 'react';
import type { LockType } from '@escape-the-crypt/core';
import type { ArtFailureLog } from './art-failure-log';
import type { PanelSide } from './panel-side';
import './lock-closeup.css';

export interface LockCloseUpProps {
  readonly lockType: LockType;
  /** True for a solved slot: the open art. Open, settled and challenged slots show the closed art. */
  readonly solved: boolean;
  readonly side: PanelSide;
  /** A Phone_Viewport: the panel takes the full width (Requirement 13.4). */
  readonly phone: boolean;
  readonly log: ArtFailureLog;
  readonly children: ReactNode;
}

export function lockCloseUpPath(lockType: LockType, solved: boolean): string {
  return `/art/locks/${lockType}/${solved ? 'open' : 'closed'}.webp`;
}

/**
 * The lock close-up behind a Question_Panel (Requirements 13.1 to 13.4). The art is decoration with empty
 * alt text. If it fails to load it is logged once and dropped; the panel stays as it was.
 * The panel keeps its own opaque surface, so its text contrast does not depend on the art.
 */
export function LockCloseUp({ lockType, solved, side, phone, log, children }: LockCloseUpProps): ReactNode {
  const path = lockCloseUpPath(lockType, solved);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  return (
    <div
      className={`lock-closeup${phone ? ' lock-closeup--phone' : ''}`}
      data-testid="lock-closeup"
      data-side={side}
      data-phone={phone ? 'true' : 'false'}
      data-lock={lockType}
      data-state={solved ? 'open' : 'closed'}
    >
      {failed.has(path) ? null : (
        <img
          alt=""
          draggable={false}
          className="lock-closeup__art"
          src={path}
          onError={() => {
            log(path, 'art-load-failed');
            setFailed((prev) => new Set(prev).add(path));
          }}
        />
      )}
      <div className="lock-closeup__panel">{children}</div>
    </div>
  );
}

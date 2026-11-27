import type { ReactNode } from 'react';
import { LanternToggle } from '../crypt/lantern-toggle';
import { DeskScene } from './desk-scene';
import type { Size } from './desk-scene-layout';
import { FRONT_OF_HOUSE_COPY } from '@escape-the-crypt/core';
import { SettingsSlot } from './settings-slot';
import './open-book.css';

export interface BringNotesScreenProps {
  /** The ingest flow, as the host builds it. It is placed on the open book unchanged. */
  readonly ingest: ReactNode;
  /** True once the notes are confirmed: the settings slot and the actions appear. */
  readonly confirmed: boolean;
  /** `StartActions` or equivalent. Shown after the notes are confirmed. */
  readonly actions?: ReactNode;
  /** Defaults to the (empty) `SettingsSlot`. */
  readonly settingsSlot?: ReactNode;
  /** The "Judge access" disclosure. Shown with the actions, only when generating is possible. */
  readonly judgeAccess?: ReactNode;
  readonly backHref: string;
  /** True while the dig covers this screen: the book stays mounted so the notes survive a cancel. */
  readonly hidden?: boolean;
  readonly viewport?: Size;
}

/**
 * The open book on the desk. The pages are the existing ingest panels laid out in two pages
 * (see open-book.css); nothing about how they work changes. After Confirm the length and
 * difficulty slot and the Generate / sample actions follow, in that order.
 */
export function BringNotesScreen({
  ingest,
  confirmed,
  actions,
  settingsSlot = <SettingsSlot />,
  judgeAccess,
  backHref,
  hidden = false,
  viewport,
}: BringNotesScreenProps): ReactNode {
  const copy = FRONT_OF_HOUSE_COPY;
  return (
    <div hidden={hidden} data-testid="bring-notes-screen">
      <DeskScene variant="book" viewport={viewport}>
        <main className="bring">
          <div className="bring__tools">
            <a className="fh-button" href={backHref}>
              {copy.bring.back}
            </a>
            <LanternToggle label={copy.hub.lantern} />
          </div>
          <h1 className="fh-title bring__title">{copy.bring.title}</h1>
          <div className="book-pages" data-testid="book-pages">
            {ingest}
          </div>
          {confirmed ? (
            <>
              <div className="book-settings-slot" data-testid="settings-slot">
                {settingsSlot}
              </div>
              <div className="bring__actions fh-panel" data-testid="bring-actions">
                {actions}
                {judgeAccess}
              </div>
            </>
          ) : null}
        </main>
      </DeskScene>
    </div>
  );
}

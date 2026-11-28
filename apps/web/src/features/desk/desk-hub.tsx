import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BookStack } from './book-stack';
import { StatusIcon } from './book-spine';
import { DeskScene } from './desk-scene';
import type { Size } from './desk-scene-layout';
import { FRONT_OF_HOUSE_COPY } from '@escape-the-crypt/core';
import { SampleShelf } from './sample-shelf';
import { bookLabel, shelfKey } from './shelf-entry';
import type { SampleEntry, ShelfEntry } from './shelf-entry';
import './desk-hub.css';

export interface DeskHubProps {
  /** Saved crypts, newest first. */
  readonly shelf: readonly ShelfEntry[];
  readonly samples: readonly SampleEntry[];
  /** Where "Bring your notes" goes. A plain link, so reload and Back work. */
  readonly bringHref: string;
  readonly onPlaySample: (id: string) => void;
  /** The buttons for the selected book (Continue, Start again, Export). The hub does not know what they do. */
  readonly renderBookActions?: (entry: ShelfEntry) => ReactNode;
  /** "Import a crypt", shown with the shelf. The hub does not know what it does. */
  readonly importSlot?: ReactNode;
  /** A book to select, such as one that was just imported. Re-selects when it changes. */
  readonly selectKey?: string;
  readonly viewport?: Size;
}

/** The desk: the title, "Bring your notes", the sample crypts and the book stack of saved crypts. */
export function DeskHub({ shelf, samples, bringHref, onPlaySample, renderBookActions, importSlot, selectKey, viewport }: DeskHubProps): ReactNode {
  const copy = FRONT_OF_HOUSE_COPY.hub;
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (selectKey !== undefined) setPicked(selectKey);
  }, [selectKey]);
  const selected = shelf.find((entry) => shelfKey(entry) === picked) ?? shelf[0];
  const label = selected === undefined ? null : bookLabel(selected);
  return (
    <DeskScene variant="hub" viewport={viewport}>
      <main className="desk-hub">
        <section className="fh-panel desk-hub__intro" aria-labelledby="desk-hub-title">
          <h1 className="fh-title" id="desk-hub-title">
            {copy.title}
          </h1>
          <p>{copy.lede}</p>
          <a className="fh-button fh-button--primary" href={bringHref}>
            {copy.bringNotes}
          </a>
          {samples.length === 0 ? null : (
            <section className="desk-hub__samples" aria-labelledby="desk-hub-samples">
              <h2 className="fh-title" id="desk-hub-samples">
                {copy.samplesTitle}
              </h2>
              <SampleShelf samples={samples} onPlay={onPlaySample} />
            </section>
          )}
        </section>
        <section className="fh-panel desk-hub__shelf" aria-labelledby="desk-hub-shelf">
          <h2 className="fh-title" id="desk-hub-shelf">
            {copy.shelfTitle}
          </h2>
          <p className="fh-note">{copy.shelfNote}</p>
          {importSlot}
          {shelf.length === 0 ? (
            <p data-testid="shelf-empty">{copy.shelfEmpty}</p>
          ) : (
            <>
              <BookStack entries={shelf} selectedKey={selected === undefined ? null : shelfKey(selected)} onSelect={setPicked} />
              {selected === undefined || label === null ? null : (
                <section className="desk-hub__card" aria-labelledby="desk-hub-card" data-testid="book-card">
                  <h3 className="desk-hub__card-title" id="desk-hub-card">
                    {`${label.title} · ${label.meta}`}
                  </h3>
                  <p className="desk-hub__card-status">
                    <StatusIcon status={selected.status} />
                    {label.status}
                    {label.reviewDue === null ? null : ` · ${label.reviewDue}`}
                  </p>
                  {renderBookActions?.(selected)}
                </section>
              )}
            </>
          )}
        </section>
      </main>
    </DeskScene>
  );
}

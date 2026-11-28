import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { FRONT_OF_HOUSE_COPY, IMPORT_COPY } from '@escape-the-crypt/core';
import { BookStack } from './book-stack';
import { StatusIcon } from './book-spine';
import { DeskMenu } from './desk-menu';
import type { DeskPanel } from './desk-menu';
import type { DeskProp } from './desk-props';
import { DeskScene } from './desk-scene';
import type { Size } from './desk-scene-layout';
import { SampleShelf } from './sample-shelf';
import { bookLabel, shelfKey } from './shelf-entry';
import type { SampleEntry, ShelfEntry } from './shelf-entry';
import './desk-hub.css';

export interface DeskHubProps {
  /** Saved crypts, newest first. */
  readonly shelf: readonly ShelfEntry[];
  readonly samples: readonly SampleEntry[];
  readonly bringHref: string;
  readonly onPlaySample: (id: string) => void;
  /** Null means the saved run was handed to the game. */
  readonly onEnter?: () => Promise<{ readonly panel: 'shelf' | 'samples'; readonly notice?: string } | null>;
  readonly renderBookActions?: (entry: ShelfEntry) => ReactNode;
  readonly importSlot?: ReactNode;
  /** Select the book just imported when the player opens the shelf. */
  readonly selectKey?: string;
  readonly announcer?: ReactNode;
  readonly viewport?: Size;
}

export function DeskHub({ shelf, samples, bringHref, onPlaySample, onEnter, renderBookActions, importSlot, selectKey, announcer, viewport }: DeskHubProps): ReactNode {
  const copy = FRONT_OF_HOUSE_COPY.hub;
  const [pick, setPick] = useState<{ key: string; importKey: string | undefined } | null>(null);
  const picked = pick?.importKey === selectKey ? pick?.key ?? selectKey : selectKey;
  const [panel, setPanel] = useState<DeskPanel | null>(null);
  const [hovered, setHovered] = useState<DeskProp | null>(null);
  const [focused, setFocused] = useState<DeskProp | null>(null);
  const [busy, setBusy] = useState(false);
  const [entryNotice, setEntryNotice] = useState<string | undefined>();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const selected = shelf.find((entry) => shelfKey(entry) === picked) ?? shelf[0];
  const label = selected === undefined ? null : bookLabel(selected);
  const panelTitle = panel === 'shelf' ? copy.shelfTitle : panel === 'samples' ? copy.samplesTitle : IMPORT_COPY.button;

  useLayoutEffect(() => {
    if (panel === null) return;
    if (dialog.current?.open === false) dialog.current.showModal();
    heading.current?.focus();
  }, [panel]);

  function close(): void {
    dialog.current?.close();
    setPanel(null);
    opener.current?.focus();
  }

  function activate(prop: DeskProp, event: MouseEvent<HTMLButtonElement>): void {
    if (busy) return;
    opener.current = event.currentTarget;
    setEntryNotice(undefined);
    if (prop !== 'crypt-stairs') {
      setPanel(prop === 'crypt-stack' ? 'shelf' : prop === 'sample-chest' ? 'samples' : 'import');
      return;
    }
    if (onEnter === undefined) {
      setPanel('samples');
      return;
    }
    setBusy(true);
    void onEnter().then((result) => {
      if (result !== null) {
        setEntryNotice(result.notice);
        setPanel(result.panel);
      }
    }, () => {
      setEntryNotice(copy.resumeLookupFailed);
      setPanel('samples');
    }).finally(() => setBusy(false));
  }

  return (
    <DeskScene variant="hub" viewport={viewport} litProps={panel === null ? [hovered, focused] : undefined}>
      {(placement, stage) => <main className="desk-hub">
        <header className="fh-panel desk-hub__intro">
          <h1 className="fh-title">{copy.title}</h1>
          <p>{copy.lede}</p>
        </header>
        <DeskMenu placement={placement} stage={stage} bringHref={bringHref} busy={busy}
          onActivate={activate} onHover={setHovered} onFocus={setFocused} />
        {panel === null ? announcer : (
          <dialog ref={dialog} className="desk-hub__dialog fh-panel fh-panel--paper" aria-labelledby={titleId}
            aria-describedby={entryNotice === undefined ? undefined : `${titleId}-notice`}
            onCancel={(event) => { event.preventDefault(); close(); }}>
            <header className="desk-hub__dialog-header">
              <h2 className="fh-title" id={titleId} ref={heading} tabIndex={-1}>{panelTitle}</h2>
              <button type="button" className="fh-button" onClick={close}>{FRONT_OF_HOUSE_COPY.bring.back}</button>
            </header>
            {announcer}
            {entryNotice === undefined ? null : <p id={`${titleId}-notice`}>{entryNotice}</p>}
            {panel === 'samples' ? <SampleShelf samples={samples} onPlay={onPlaySample} /> : null}
            {panel === 'import' ? <div className="desk-hub__panel">
              {importSlot}
              {selectKey === undefined ? null : (
                <button type="button" className="fh-button" onClick={() => setPanel('shelf')}>{copy.shelfTitle}</button>
              )}
            </div> : null}
            {panel === 'shelf' ? <div className="desk-hub__panel">
              <p className="fh-note">{copy.shelfNote}</p>
              {shelf.length === 0 ? <p data-testid="shelf-empty">{copy.shelfEmpty}</p> : (
                <BookStack entries={shelf} selectedKey={selected === undefined ? null : shelfKey(selected)}
                  onSelect={(key) => setPick({ key, importKey: selectKey })} />
              )}
              {selected === undefined || label === null ? null : (
                <section className="desk-hub__card" aria-labelledby="desk-hub-card" data-testid="book-card">
                  <h3 className="desk-hub__card-title" id="desk-hub-card">{`${label.title} · ${label.meta}`}</h3>
                  <p className="desk-hub__card-status">
                    <StatusIcon status={selected.status} />
                    {label.status}
                    {label.reviewDue === null ? null : ` · ${label.reviewDue}`}
                  </p>
                  {renderBookActions?.(selected)}
                </section>
              )}
            </div> : null}
          </dialog>
        )}
      </main>}
    </DeskScene>
  );
}

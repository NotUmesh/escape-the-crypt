import { useContext, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { LockType } from '@escape-the-crypt/core';
import { CandleIcon } from '../costume/ornaments';
import type { ArtFailureLog } from './art-failure-log';
import { GhostFigure } from './ghost-layer';
import { LockActionHost, OverlayStatusHost } from './lock-overlay-context';
import { lockCloseUpPath } from './lock-closeup';
import './lock-overlay.css';

interface Props {
  readonly heading: string;
  readonly lockType: LockType;
  readonly solved: boolean;
  readonly evidence: boolean;
  readonly ghostRises: boolean;
  readonly hints: number | null;
  readonly log: ArtFailureLog;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function LockOverlay({ heading, lockType, solved, evidence, ghostRises, hints, log, onClose, children }: Props): ReactNode {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const statusHost = useContext(OverlayStatusHost);
  const [actionHost, setActionHost] = useState<HTMLElement | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [loadedOpen, setLoadedOpen] = useState<string | null>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  function close(): void {
    dialogRef.current?.close();
    onClose();
  }

  const closedPath = lockCloseUpPath(lockType, false);
  const openPath = lockCloseUpPath(lockType, true);
  const showOpen = solved && loadedOpen === openPath && !failed.has(openPath);

  function art(path: string, open: boolean): ReactNode {
    if (failed.has(path)) return null;
    return (
      <img
        key={path}
        alt=""
        draggable={false}
        className="lock-overlay__art"
        data-visible={open ? showOpen : !showOpen}
        src={path}
        onLoad={open ? () => setLoadedOpen(path) : undefined}
        onError={() => {
          log(path, 'art-load-failed');
          setFailed((prev) => new Set(prev).add(path));
        }}
      />
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="lock-overlay"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!evidence) close();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (!evidence) close();
      }}
    >
      <header className="lock-overlay__hud costume-stone">
        {!evidence ? <button type="button" className="lock-overlay__back" onClick={close}>{ROOM_PLAY_LABELS.backToRoom}</button> : null}
        <h2 id={titleId}>{heading}</h2>
        {hints === null ? null : <p>
          <CandleIcon lit={hints > 0} />{hints > 0 ? ROOM_PLAY_LABELS.hintsLeft(hints) : ROOM_PLAY_LABELS.noHintsLeft}
        </p>}
      </header>
      <div className="lock-overlay__status" ref={statusHost} />
      <div className="lock-overlay__body" data-testid="lock-closeup" data-side="right" data-lock={lockType} data-state={solved ? 'open' : 'closed'}>
        <div className="lock-overlay__object" aria-hidden="true">
          <div className="lock-overlay__frame">
            {art(closedPath, false)}
            {solved ? art(openPath, true) : null}
            {ghostRises ? <span className="lock-overlay__ghost ghost-art ghost-art--rise"><GhostFigure /></span> : null}
          </div>
        </div>
        <div className="lock-overlay__paper costume-paper">
          <LockActionHost.Provider value={actionHost}>{children}</LockActionHost.Provider>
        </div>
      </div>
      <footer className="lock-overlay__ledge costume-stone" ref={setActionHost} hidden={evidence} />
    </dialog>
  );
}

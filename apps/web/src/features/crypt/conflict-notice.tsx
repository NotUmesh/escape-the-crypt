import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { CONFLICT_NOTICE_COPY, ROOM_PLAY_LABELS, conflictLeftOut, conflictNext, conflictPassage } from '@escape-the-crypt/core';
import type { State } from '@escape-the-crypt/core';
import type { CryptNotices } from '../generate/generated-notices';
import type { HeldNotices } from './use-generated-notices';
import './conflict-notice.css';

export interface ConflictNoticeProps {
  readonly notices: CryptNotices;
  /** Sends the notice to the one live region on screen. This component has none. */
  readonly announce: (message: string) => void;
  /** False while a cover (the descent) is up: the notice is read once, when it is over. */
  readonly ready: boolean;
}

/**
 * One calm notice for a crypt that left a topic out because two passages in the learner's notes seem
 * to disagree. Each topic gets the sentence from core's copy and, when both passages checked out
 * against the notes, a "Show passages" disclosure with them as plain text. It reads once through the
 * crypt's live region and has no live role of its own.
 */
export function ConflictNotice({ notices, announce, ready }: ConflictNoticeProps): ReactNode {
  const copy = CONFLICT_NOTICE_COPY;
  const headingId = useId();
  const announced = useRef(false);
  useEffect(() => {
    if (!ready || announced.current) return;
    announced.current = true;
    announce(notices.leftOut.map((concept) => conflictLeftOut(concept.title)).join(' '));
  }, [ready, announce, notices]);
  return (
    <section className="conflict-notice" aria-labelledby={headingId} data-testid="conflict-notice">
      <h2 className="conflict-notice__title" id={headingId}>
        {copy.heading}
      </h2>
      <ul className="conflict-notice__list">
        {notices.leftOut.map((concept) => (
          <li key={concept.conceptId} data-testid="conflict-notice-item">
            <p className="conflict-notice__sentence">{conflictLeftOut(concept.title)}</p>
            {concept.passages.length === 2 ? (
              <details className="conflict-notice__passages">
                <summary aria-label={copy.showPassagesFor(concept.title)}>{copy.showPassages}</summary>
                {concept.passages.map((passage, index) => (
                  <figure className="conflict-notice__passage" key={passage.citationLabel + passage.quote}>
                    <blockquote>{passage.quote}</blockquote>
                    <figcaption>
                      {`${conflictPassage(index + 1)} \u00B7 ${passage.citationLabel} \u00B7 ${ROOM_PLAY_LABELS.excerptMatched}`}
                    </figcaption>
                  </figure>
                ))}
              </details>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="conflict-notice__next">{conflictNext}</p>
    </section>
  );
}

export interface RunConflictNoticeProps {
  readonly held: HeldNotices | null;
  readonly state: State | null;
  readonly running: boolean;
  readonly announce: (message: string) => void;
  readonly ready: boolean;
}

/** Shows the held notice only while the crypt it belongs to is being played, and not after the escape. */
export function RunConflictNotice({ held, state, running, announce, ready }: RunConflictNoticeProps): ReactNode {
  if (held === null || !running || state === null || state.status === 'escaped') return null;
  if (state.manifest.manifestId !== held.manifestId) return null;
  return <ConflictNotice notices={held.notices} announce={announce} ready={ready} />;
}

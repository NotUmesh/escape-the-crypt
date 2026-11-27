import type { ReactNode } from 'react';
import { FRONT_OF_HOUSE_COPY } from './front-of-house-copy';
import { bookLabel } from './shelf-entry';
import type { ShelfEntry } from './shelf-entry';

export interface BookSpineProps {
  readonly entry: ShelfEntry;
  /** Which of the four spine pictures to use. */
  readonly index: number;
  readonly selected: boolean;
  readonly onSelect: () => void;
}

/** Status shown as an icon and a word, never colour alone. Icons are decoration. */
export function StatusIcon({ status }: { readonly status: ShelfEntry['status'] }): ReactNode {
  return (
    <svg className={`book-status-icon book-status-icon--${status}`} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {status === 'escaped' ? (
        <path d="M3 8.5l3.2 3.2L13 5" />
      ) : status === 'active' ? (
        <circle cx="8" cy="8" r="4.5" />
      ) : (
        <path d="M3.5 8h9" />
      )}
    </svg>
  );
}

/**
 * One saved crypt on the stack: the spine picture beside a solid label, in one native button.
 * The picture has no lettering; the text is HTML on the panel.
 */
export function BookSpine({ entry, index, selected, onSelect }: BookSpineProps): ReactNode {
  const label = bookLabel(entry);
  const picture = (index % 4) + 1;
  return (
    <button type="button" className="book-spine" aria-pressed={selected} onClick={onSelect}>
      <img className="book-spine__art" src={`/art/desk/books/book-${picture}.webp`} alt="" draggable={false} />
      <span className="book-spine__text">
        <span className="book-spine__title">{label.title}</span>
        <span className="book-spine__meta">{label.meta}</span>
        <span className="book-spine__status">
          <StatusIcon status={entry.status} />
          {label.status}
          {label.reviewDue === null ? null : <span className="book-spine__due">{` · ${label.reviewDue}`}</span>}
        </span>
        {selected ? <span className="book-spine__selected">{FRONT_OF_HOUSE_COPY.book.selected}</span> : null}
      </span>
    </button>
  );
}

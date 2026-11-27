import type { ReactNode } from 'react';
import { BookSpine } from './book-spine';
import { FRONT_OF_HOUSE_COPY } from '@escape-the-crypt/core';
import { shelfKey } from './shelf-entry';
import type { ShelfEntry } from './shelf-entry';
import './book-stack.css';

export const BOOK_STACK_LIMIT = 6;

export interface BookStackProps {
  /** Newest first. */
  readonly entries: readonly ShelfEntry[];
  readonly selectedKey: string | null;
  readonly onSelect: (key: string) => void;
  readonly limit?: number;
}

/** The saved crypts of this device as a stack of books. Older ones sit behind a disclosure. */
export function BookStack({ entries, selectedKey, onSelect, limit = BOOK_STACK_LIMIT }: BookStackProps): ReactNode {
  const shown = entries.slice(0, limit);
  const rest = entries.slice(limit);
  const item = (entry: ShelfEntry, index: number): ReactNode => {
    const key = shelfKey(entry);
    return (
      <li key={key}>
        <BookSpine entry={entry} index={index} selected={key === selectedKey} onSelect={() => onSelect(key)} />
      </li>
    );
  };
  return (
    <div className="book-stack" data-testid="book-stack">
      <ul className="book-stack__list">{shown.map(item)}</ul>
      {rest.length === 0 ? null : (
        <details className="book-stack__more">
          <summary>{FRONT_OF_HOUSE_COPY.hub.moreCrypts(rest.length)}</summary>
          <ul className="book-stack__list">{rest.map((entry, index) => item(entry, index + shown.length))}</ul>
        </details>
      )}
    </div>
  );
}

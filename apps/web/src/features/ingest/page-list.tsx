import { INGEST_UI_COPY, PAGE_FLAG_COPY } from '@escape-the-crypt/core';
import type { PageFlag } from '@escape-the-crypt/core';
import { useId } from 'react';
import type { IngestUnit } from './ingest-machine';
import './ingest-controls.css';
import './page-list.css';

export interface PageListProps {
  readonly units: readonly IngestUnit[];
  readonly onRemove: (unitId: string) => void;
}

/** A different shape per flag, so the state never relies on colour (4.6, 9.5). */
function FlagIcon({ flag }: { readonly flag: PageFlag }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {flag === 'ok' ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : null}
      {flag === 'low-text' ? <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 13h6" /> : null}
      {flag === 'suspicious' ? <path d="M12 3l10 18H2zM12 10v5M12 18v.5" /> : null}
    </svg>
  );
}

/** Lists the extracted PDF pages with a flag and, on flagged pages, a Remove button (4.5, 4.6). */
export function PageList({ units, onRemove }: PageListProps): React.JSX.Element | null {
  const titleId = useId();
  const pages = units.filter((u) => u.kind === 'pdf');
  if (pages.length === 0) return null;
  return (
    <section className="ingest-block ingest-panel" aria-labelledby={titleId}>
      <h2 className="ingest-title" id={titleId}>
        {INGEST_UI_COPY.pagesReadTitle}
      </h2>
      <ul className="ingest-pages-list">
        {pages.map((unit) => {
          const page = unit.pdfPageIndex + 1;
          const copy = PAGE_FLAG_COPY[unit.flag];
          return (
            <li className="ingest-pages-item" key={unit.id}>
              <div className="ingest-pages-main">
                <span className="ingest-pages-name">{INGEST_UI_COPY.pageName(page)}</span>{' '}
                <span className="ingest-flag" data-flag={unit.flag}>
                  <FlagIcon flag={unit.flag} />
                  {copy.label}
                </span>
                {unit.flag === 'ok' || !unit.included ? null : (
                  <p className="ingest-pages-detail">{copy.detail}</p>
                )}
              </div>
              {!unit.included ? (
                <span className="ingest-hint">{INGEST_UI_COPY.pageRemoved}</span>
              ) : unit.flag === 'ok' ? null : (
                <button
                  type="button"
                  className="ingest-button"
                  aria-label={INGEST_UI_COPY.removePageFor(page)}
                  onClick={() => onRemove(unit.id)}
                >
                  {INGEST_UI_COPY.removePage}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
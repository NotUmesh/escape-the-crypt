import type { ReactNode } from 'react';
import { FRONT_OF_HOUSE_COPY } from '../desk/front-of-house-copy';
import { digStageRows } from './dig-stages';
import type { DigStageInput } from './dig-stages';

export interface DigStageListProps {
  readonly stages?: readonly DigStageInput[];
}

function StageIcon({ status }: { readonly status: DigStageInput['status'] }): ReactNode {
  return (
    <svg className={`dig-stage__icon dig-stage__icon--${status}`} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {status === 'done' ? <path d="M3 8.5l3.2 3.2L13 5" /> : status === 'active' ? <circle cx="8" cy="8" r="4.5" /> : <path d="M4 8h8" />}
    </svg>
  );
}

/**
 * The pipeline stages with real counts ("Writing questions, 6 of 9"). It renders nothing until the
 * job status sends stage data, and there is no bar or percentage: a count is shown only as sent.
 */
export function DigStageList({ stages }: DigStageListProps): ReactNode {
  const rows = digStageRows(stages);
  if (rows.length === 0) return null;
  return (
    <ol className="dig-stages" aria-label={FRONT_OF_HOUSE_COPY.dig.stagesLabel} data-testid="dig-stages">
      {rows.map((row) => (
        <li key={row.id} className="dig-stage" data-status={row.status}>
          <StageIcon status={row.status} />
          <span className="dig-stage__name">{row.name}</span>
          <span className="dig-stage__status">{row.count === null ? row.statusWord : `${row.statusWord}, ${row.count}`}</span>
        </li>
      ))}
    </ol>
  );
}

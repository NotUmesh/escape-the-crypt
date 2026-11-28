import { ERROR_COPY, INGEST_UI_COPY, renderError } from '@escape-the-crypt/core';
import { useId } from 'react';
import type { IngestUnit } from './ingest-machine';
import './ingest-controls.css';
import './preview-editor.css';

export interface PreviewEditorProps {
  readonly units: readonly IngestUnit[];
  /** Result of `canConfirm(state)`. */
  readonly canConfirm: boolean;
  readonly onTextEdited: (unitId: string, text: string) => void;
  readonly onConfirm: () => void;
}

function unitName(unit: IngestUnit): string {
  return unit.kind === 'pdf'
    ? INGEST_UI_COPY.pageName(unit.pdfPageIndex + 1, unit.printedPageLabel)
    : INGEST_UI_COPY.paragraphName(unit.paragraphNumber);
}

/**
 * One textarea per included page or paragraph, plain text only (5.1, 5.2, 5.7).
 * The text is a React value, never HTML.
 */
export function PreviewEditor(props: PreviewEditorProps): React.JSX.Element {
  const { units, canConfirm } = props;
  const id = useId();
  const included = units.filter((u) => u.included);
  return (
    <div className="ingest-on-light">
      <section className="ingest-block ingest-preview" aria-labelledby={`${id}-title`}>
        <h2 className="ingest-title" id={`${id}-title`}>
          {INGEST_UI_COPY.previewTitle}
        </h2>
        <p className="ingest-hint">{INGEST_UI_COPY.previewHint}</p>
        {included.map((unit) => (
          <div className="ingest-preview-unit" key={unit.id}>
            <label htmlFor={`${id}-${unit.id}`}>{unitName(unit)}</label>
            <textarea
              id={`${id}-${unit.id}`}
              value={unit.currentText}
              onChange={(e) => props.onTextEdited(unit.id, e.target.value)}
            />
          </div>
        ))}
        <div className="ingest-preview-actions">
          <button
            type="button"
            className="ingest-button costume-seal"
            disabled={!canConfirm}
            aria-disabled={!canConfirm || undefined}
            aria-describedby={canConfirm ? undefined : `${id}-why`}
            onClick={props.onConfirm}
          >
            {INGEST_UI_COPY.confirm}
          </button>
          {canConfirm ? null : (
            <span id={`${id}-why`}>{renderError(ERROR_COPY.empty)}</span>
          )}
        </div>
      </section>
    </div>
  );
}
import { INGEST_UI_COPY, MAX_SELECTED_PAGES } from '@escape-the-crypt/core';
import { useId } from 'react';
import type { IngestStatus } from './ingest-machine';
import './ingest-controls.css';
import './pdf-picker.css';

export interface PdfPickerProps {
  readonly status: IngestStatus;
  /** Page count of the chosen PDF. Used once the file passed the size check. */
  readonly pageCount: number;
  /** Printed page labels from the count, one per page. */
  readonly pageLabels: readonly (string | null)[];
  /** 0-based indexes of the chosen pages. */
  readonly selectedPages: readonly number[];
  /** Pages read so far and pages expected, while extracting. */
  readonly progress: { readonly done: number; readonly total: number };
  /** Problem message from the state machine (for example the file-size message), or ''. */
  readonly errorMessage: string;
  /** The file size is checked by the state machine on FILE_SELECTED, before any page work. */
  readonly onFileSelected: (file: File) => void;
  readonly onSelectedPagesChange: (pages: number[]) => void;
  readonly onReadPages: () => void;
  readonly onStop: () => void;
}

/** Native file input, page checkboxes (stopping at the page limit) and Stop (2.3, 2.6, 3.2, 3.3). */
export function PdfPicker(props: PdfPickerProps): React.JSX.Element {
  const { status, pageCount, pageLabels, selectedPages, progress, errorMessage } = props;
  const id = useId();
  const extracting = status === 'extracting';
  const counting = status === 'counting';
  const choosing = status === 'pdf-chosen';
  const atLimit = selectedPages.length >= MAX_SELECTED_PAGES;

  const toggle = (index: number, checked: boolean): void => {
    if (checked && atLimit) return;
    const next = checked
      ? [...selectedPages, index].sort((a, b) => a - b)
      : selectedPages.filter((p) => p !== index);
    props.onSelectedPagesChange(next);
  };

  return (
    <section className="ingest-block ingest-panel ingest-pdf">
      <label htmlFor={id}>{INGEST_UI_COPY.pdfLabel}</label>
      <p className="ingest-hint" id={`${id}-hint`}>
        {INGEST_UI_COPY.pdfHint}
      </p>
      <input
        id={id}
        type="file"
        accept="application/pdf,.pdf"
        aria-describedby={`${id}-hint`}
        disabled={extracting || counting}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) props.onFileSelected(file);
        }}
      />
      {errorMessage === '' ? null : <p className="ingest-pdf-error">{errorMessage}</p>}
      {choosing ? (
        <>
          <fieldset aria-describedby={`${id}-count`}>
            <legend>{INGEST_UI_COPY.pagesLegend}</legend>
            <div className="ingest-pdf-pages">
              {Array.from({ length: pageCount }, (_, index) => {
                const checked = selectedPages.includes(index);
                const blocked = !checked && atLimit;
                return (
                  <label className="ingest-pdf-page" key={index} data-disabled={blocked}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={blocked}
                      onChange={(e) => toggle(index, e.target.checked)}
                    />
                    {INGEST_UI_COPY.pageName(index + 1, pageLabels[index] ?? null)}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <p className="ingest-hint" id={`${id}-count`}>
            {atLimit ? INGEST_UI_COPY.pageLimit : INGEST_UI_COPY.pagesChosen(selectedPages.length)}
          </p>
          <div className="ingest-pdf-actions">
            <button
              type="button"
              className="ingest-button"
              disabled={selectedPages.length === 0}
              onClick={props.onReadPages}
            >
              {INGEST_UI_COPY.readPages}
            </button>
            {selectedPages.length === 0 ? (
              <span className="ingest-hint">{INGEST_UI_COPY.readPagesNone}</span>
            ) : null}
          </div>
        </>
      ) : null}
      {extracting || counting ? (
        <div className="ingest-pdf-actions">
          <button type="button" className="ingest-button" onClick={props.onStop}>
            {INGEST_UI_COPY.stop}
          </button>
          <span>
            {counting
              ? INGEST_UI_COPY.counting
              : INGEST_UI_COPY.reading(Math.min(progress.done + 1, progress.total), progress.total)}
          </span>
        </div>
      ) : null}
    </section>
  );
}
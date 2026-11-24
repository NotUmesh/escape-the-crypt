import {
  INGEST_UI_COPY,
  errorMessage,
  makeNotesRecord,
  ANNOUNCEMENT_COPY,
} from '@escape-the-crypt/core';
import type { Chunk } from '@escape-the-crypt/core';
import { useEffect, useRef, useState } from 'react';
import { createBrowserExtractionClient } from './browser-extraction-client';
import type { ExtractionClient } from './extraction-client';
import { canConfirm } from './ingest-machine';
import { LiveAnnouncer } from './live-announcer';
import type { NotesStore } from './notes-store';
import { PageList } from './page-list';
import { PasteInput } from './paste-input';
import { PdfPicker } from './pdf-picker';
import { PreviewEditor } from './preview-editor';
import { PrivacyNotice } from './privacy-notice';
import { useIngestMachine } from './use-ingest-machine';
import './ingest-base.css';
import './ingest-controls.css';
import './ingest-flow.css';

export interface IngestFlowProps {
  /** Where confirmed notes are saved. The flow never reads a file name or bytes into it. */
  readonly store: NotesStore;
  /** Called once with the chunks after Confirm. */
  readonly onConfirmed?: (chunks: readonly Chunk[]) => void;
  /** Test seam: builds the Extraction Client. Defaults to the real Extraction Worker. */
  readonly createClient?: () => ExtractionClient;
}

type Source = 'paste' | 'pdf' | 'preview';

/**
 * Connects the ingest components to the state machine, the Extraction Client and
 * the notes store. It sets no layout and imports no router, so a host screen can
 * place it anywhere.
 */
export function IngestFlow({ store, onConfirmed, createClient }: IngestFlowProps): React.JSX.Element {
  const { state, send, getState } = useIngestMachine();
  const [pasteText, setPasteText] = useState('');
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [source, setSource] = useState<Source>('paste');
  const clientRef = useRef<ExtractionClient | null>(null);
  const fileRef = useRef<File | null>(null);

  const client = (): ExtractionClient => {
    clientRef.current ??= (createClient ?? createBrowserExtractionClient)();
    return clientRef.current;
  };

  useEffect(
    () => () => {
      clientRef.current?.terminate();
      clientRef.current = null;
      fileRef.current = null;
    },
    [],
  );

  const onPasteChanged = (text: string): void => {
    clientRef.current?.cancel();
    fileRef.current = null;
    setSource('paste');
    setPasteText(text);
    send({ type: 'PASTE_CHANGED', text });
  };

  const onFileSelected = (file: File): void => {
    clientRef.current?.cancel();
    fileRef.current = null;
    setSource('pdf');
    setSelectedPages([]);
    // The size check runs first. A file over the limit is never opened.
    const next = send({ type: 'FILE_SELECTED', sizeBytes: file.size });
    if (next.status !== 'counting') return;
    fileRef.current = file;
    const unreadable = (): void => {
      fileRef.current = null;
      send({ type: 'EXTRACTION_ERROR', error: { kind: 'unreadable' } });
    };
    client()
      .count({
        file,
        onMessage: (message) => {
          if (message.type === 'counted') {
            send({ type: 'PAGE_COUNT_KNOWN', pageCount: message.pageCount, labels: message.labels });
          } else if (message.type === 'error') {
            fileRef.current = null;
            send({ type: 'EXTRACTION_ERROR', error: message.error });
          }
        },
      })
      .then((result) => {
        if (!result.ok) send({ type: 'EXTRACTION_ERROR', error: result.error });
      }, unreadable);
  };

  const onReadPages = (): void => {
    const file = fileRef.current;
    if (file === null) return;
    const next = send({ type: 'PAGES_CHOSEN', pageIndexes: selectedPages });
    if (next.status !== 'extracting') return;
    const unreadable = (): void => {
      fileRef.current = null;
      send({ type: 'EXTRACTION_ERROR', error: { kind: 'unreadable' } });
    };
    client()
      .start({
        file,
        pageIndexes: selectedPages,
        onMessage: (message) => {
          if (message.type === 'page') {
            send({
              type: 'EXTRACTION_PAGE',
              pdfPageIndex: message.pdfPageIndex,
              printedPageLabel: message.printedPageLabel,
              text: message.text,
              flag: message.flag,
            });
          } else if (message.type === 'error') {
            fileRef.current = null;
            send({ type: 'EXTRACTION_ERROR', error: message.error });
          } else if (message.type === 'done') {
            // Drop the file reference once its text has been read.
            fileRef.current = null;
          }
        },
      })
      .then((result) => {
        if (!result.ok) send({ type: 'EXTRACTION_ERROR', error: result.error });
      }, unreadable);
  };

  const onStop = (): void => {
    clientRef.current?.cancel();
    fileRef.current = null;
    send({ type: 'CANCEL' });
  };

  const onConfirm = (): void => {
    if (getState().status !== 'preview') return;
    setSource('preview');
    const next = send({ type: 'CONFIRM' });
    if (next.status !== 'confirmed') return;
    onConfirmed?.(next.chunks);
    // A failed save keeps the chunks in the session store and tells the learner.
    store.save(makeNotesRecord(next.chunks)).then(
      (result) => send({ type: result.ok ? 'SAVE_SUCCEEDED' : 'SAVE_FAILED' }),
      () => send({ type: 'SAVE_FAILED' }),
    );
  };

  const problem = state.error === null ? '' : errorMessage(state.error);
  const confirmed = state.status === 'confirmed';

  return (
    <div className="ingest-root ingest-flow">
      <PrivacyNotice />
      {confirmed ? (
        <section className={`ingest-block ingest-panel ingest-confirmed${state.saveStatus === 'failed' ? '' : ' is-lit'}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          <div>
            <h2 className="ingest-title">{INGEST_UI_COPY.confirmedTitle}</h2>
            <p className="ingest-text">{INGEST_UI_COPY.chunkCount(state.chunks.length)}</p>
            <p className="ingest-hint">
              {state.saveStatus === 'failed'
                ? errorMessage({ kind: 'storage-unavailable' })
                : state.saveStatus === 'saved'
                  ? ANNOUNCEMENT_COPY.saved
                  : ANNOUNCEMENT_COPY.confirmed}
            </p>
          </div>
        </section>
      ) : (
        <>
          <PasteInput
            value={pasteText}
            onChange={onPasteChanged}
            errorMessage={source === 'paste' ? problem : ''}
          />
          <PdfPicker
            status={state.status}
            pageCount={state.pageCount}
            pageLabels={state.pageLabels}
            selectedPages={selectedPages}
            progress={{ done: state.units.length, total: state.expectedPages }}
            errorMessage={source === 'pdf' ? problem : ''}
            onFileSelected={onFileSelected}
            onSelectedPagesChange={setSelectedPages}
            onReadPages={onReadPages}
            onStop={onStop}
          />
          <PageList units={state.units} onRemove={(unitId) => send({ type: 'PAGE_REMOVED', unitId })} />
          {state.status === 'preview' ? (
            <PreviewEditor
              units={state.units}
              canConfirm={canConfirm(state)}
              onTextEdited={(unitId, text) => send({ type: 'TEXT_EDITED', unitId, text })}
              onConfirm={onConfirm}
            />
          ) : null}
        </>
      )}
      <LiveAnnouncer message={state.announcement} />
    </div>
  );
}
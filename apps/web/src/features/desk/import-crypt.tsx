import { useCallback, useId, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { IMPORT_COPY, renderError } from '@escape-the-crypt/core';
import { importCryptFile } from '../../state/storage/import-crypt';
import type { ImportDeps } from '../../state/storage/import-crypt';
import type { ImportResult, ImportedCrypt } from '../../state/storage/import-result';

export interface ImportCryptProps {
  readonly deps: ImportDeps;
  /** Called once with the new crypt's IDs after it is saved. The host reloads its shelf. */
  readonly onImported: (imported: ImportedCrypt) => void;
  /** The shell announcer's `announce`. The result sentence is also shown, as plain text. */
  readonly announce: (message: string) => void;
  /** Test seam. Defaults to the real import. */
  readonly importFile?: (deps: ImportDeps, file: Blob) => Promise<ImportResult<ImportedCrypt>>;
  readonly inDeskPanel?: boolean;
}

/** The sentence for a result. Fixed copy by kind: nothing from the file is ever shown. */
function sentenceFor(result: ImportResult<ImportedCrypt>): string {
  return result.ok ? IMPORT_COPY.done[result.value.status] : renderError(IMPORT_COPY.errors[result.error.kind]);
}

/**
 * "Import a crypt": a button that opens the file chooser, the counterpart of "Export a copy". The
 * chosen file is read on this device and handed to the importer, which refuses anything it cannot
 * verify and changes nothing when it does. The result sentence has no live role of its own: the
 * shell announcer reads it.
 */
export function ImportCrypt({ deps, onImported, announce, importFile = importCryptFile, inDeskPanel = false }: ImportCryptProps): ReactNode {
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [text, setText] = useState('');

  const onChoose = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0];
      // Clearing the value lets the same file be chosen again after a refusal.
      const reset = (): void => {
        if (input.current !== null) input.current.value = '';
      };
      if (file === undefined) return;
      setWorking(true);
      setText(IMPORT_COPY.working);
      void importFile(deps, file).then(
        (result) => {
          reset();
          const sentence = sentenceFor(result);
          setWorking(false);
          setText(sentence);
          announce(sentence);
          if (result.ok) onImported(result.value);
        },
        () => {
          reset();
          const sentence = renderError(IMPORT_COPY.errors['write-failed']);
          setWorking(false);
          setText(sentence);
          announce(sentence);
        },
      );
    },
    [deps, importFile, onImported, announce],
  );

  return (
    <div className="import-crypt" data-testid="import-crypt">
      <button
        type="button"
        className={`fh-button${inDeskPanel ? ' fh-button--primary' : ''}`}
        onClick={() => input.current?.click()}
        disabled={working}
        aria-disabled={working || undefined}
        aria-describedby={hintId}
      >
        {inDeskPanel ? IMPORT_COPY.chooseFile : IMPORT_COPY.button}
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        tabIndex={-1}
        aria-label={IMPORT_COPY.button}
        data-testid="import-file"
        onChange={onChoose}
      />
      <p className="fh-note" id={hintId}>
        {IMPORT_COPY.hint}
      </p>
      <p className="fh-note" data-testid="import-status">
        {text}
      </p>
    </div>
  );
}

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { Chunk } from '@escape-the-crypt/core';
import { CryptFlow } from '../crypt/crypt-flow';
import type { CryptFlowProps } from '../crypt/crypt-flow';
import type { CryptStartContext } from '../crypt/crypt-start-context';
import { notesStats } from '../dig/notes-stats';
import { notesTextFromChunks } from '../generate/generated-crypt';
import type { GenerateSeams } from '../generate/generate-seams';
import type { IngestFlowProps } from '../ingest/ingest-flow';
import type { NotesStore } from '../ingest/notes-store';
import { FrontOfHouseStart } from './front-of-house-start';
import type { FrontOfHouseRoute } from './screen-flow';
import { useShellAnnouncer } from './shell-announcer';

export interface FrontOfHouseProps {
  readonly route: FrontOfHouseRoute;
  readonly store: NotesStore;
  /** Vite's `BASE_URL`: the links are built from it so a subpath deploy works. */
  readonly baseUrl?: string;
  /** Test seams, passed straight through. */
  readonly createClient?: IngestFlowProps['createClient'];
  readonly useBinding?: CryptFlowProps['useBinding'];
  readonly generate?: GenerateSeams;
}

interface Notes {
  readonly text: string;
  readonly digest: string | undefined;
  readonly stats: ReturnType<typeof notesStats>;
}

/**
 * Everything from the desk to the crypt. It owns the confirmed notes text (which only the Generate
 * button sends, to the worker) and the one announcer for the screens before the crypt. `CryptFlow`
 * owns the run; this hands it the start screens to draw while no run is playing.
 */
export function FrontOfHouse({ route, store, baseUrl = '/', createClient, useBinding, generate }: FrontOfHouseProps): ReactNode {
  const [notes, setNotes] = useState<Notes | null>(null);
  const { message, announce } = useShellAnnouncer();
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const onConfirmed = useCallback((chunks: readonly Chunk[]): void => {
    const text = notesTextFromChunks(chunks);
    setNotes({ text, digest: chunks[0]?.documentDigest, stats: notesStats(chunks, text) });
  }, []);
  const onNotesGone = useCallback((): void => setNotes(null), []);
  const renderStart = (context: CryptStartContext): ReactNode => (
    <FrontOfHouseStart
      context={context}
      route={route}
      homeHref={base}
      ingestHref={`${base}ingest`}
      store={store}
      createClient={createClient}
      notes={notes === null ? null : { stats: notes.stats }}
      onConfirmed={onConfirmed}
      onNotesGone={onNotesGone}
      message={message}
      announce={announce}
    />
  );
  return (
    <CryptFlow
      useBinding={useBinding}
      notesText={notes?.text}
      notesDigest={notes?.digest}
      generate={generate}
      onAnnounce={announce}
      renderStart={renderStart}
    />
  );
}

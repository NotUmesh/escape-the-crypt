import { useState } from 'react';
import { CryptFlow } from './features/crypt/crypt-flow';
import type { CryptFlowProps } from './features/crypt/crypt-flow';
import { IngestFlow } from './features/ingest/ingest-flow';
import type { IngestFlowProps } from './features/ingest/ingest-flow';
import { createIdbStore } from './features/ingest/notes-store-idb';
import { createMemoryStore } from './features/ingest/notes-store-memory';
import { createSessionStore } from './features/ingest/notes-store';
import type { NotesStore } from './features/ingest/notes-store';
import { routeFor } from './routes';
import './styles/app.css';

// Saved on this device when IndexedDB works; kept for the session when it does not.
const store = createSessionStore(createIdbStore(globalThis.indexedDB), createMemoryStore());

export interface IngestScreenProps {
  readonly store: NotesStore;
  /** Test seams, passed straight through. */
  readonly createClient?: IngestFlowProps['createClient'];
  readonly useBinding?: CryptFlowProps['useBinding'];
}

/**
 * The notes step, then the crypt. Once notes are confirmed, CryptFlow's start view
 * offers "Enter the crypt" with the sample-crypt line. The run uses the built-in
 * sample crypt: the confirmed notes are not passed to it. Nothing about the run is
 * saved, so a reload starts again at the notes preview.
 */
export function IngestScreen({ store: notesStore, createClient, useBinding }: IngestScreenProps): React.JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <>
      <IngestFlow store={notesStore} createClient={createClient} onConfirmed={() => setConfirmed(true)} />
      {confirmed ? <CryptFlow useBinding={useBinding} /> : null}
    </>
  );
}

export function App(): React.JSX.Element {
  const baseUrl = import.meta.env.BASE_URL;
  if (routeFor(globalThis.location.pathname, baseUrl) === 'ingest') {
    return (
      <main className="screen">
        <IngestScreen store={store} />
      </main>
    );
  }
  return (
    <main className="screen">
      <h1 className="screen-title">Escape the Crypt</h1>
      <p>
        <a href={`${baseUrl}ingest`}>Bring your notes</a>
      </p>
    </main>
  );
}

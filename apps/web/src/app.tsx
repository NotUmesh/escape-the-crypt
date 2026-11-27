import { useState } from 'react';
import { CryptFlow } from './features/crypt/crypt-flow';
import type { CryptFlowProps } from './features/crypt/crypt-flow';
import { notesTextFromChunks } from './features/generate/generated-crypt';
import type { GenerateSeams } from './features/generate/generate-seams';
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
  readonly generate?: GenerateSeams;
}

/**
 * The notes step, then the crypt. Once notes are confirmed, CryptFlow's start view
 * offers "Enter the crypt" with the sample-crypt line, and "Generate from my notes" when a worker is
 * configured. "Enter the crypt" plays the built-in sample crypt; the confirmed notes text goes only to
 * the worker, and only after the learner presses Generate. Nothing about the run is
 * saved, so a reload starts again at the notes preview.
 */
export function IngestScreen({ store: notesStore, createClient, useBinding, generate }: IngestScreenProps): React.JSX.Element {
  const [notesText, setNotesText] = useState<string | null>(null);
  const [notesDigest, setNotesDigest] = useState<string | undefined>(undefined);
  // Generation progress is read through the notes step's one polite live region.
  const [announcement, setAnnouncement] = useState('');
  return (
    <>
      <IngestFlow store={notesStore} createClient={createClient} announcement={announcement} onConfirmed={(chunks) => {
        setNotesText(notesTextFromChunks(chunks));
        setNotesDigest(chunks[0]?.documentDigest);
      }} />
      {notesText !== null ? <CryptFlow useBinding={useBinding} notesText={notesText} notesDigest={notesDigest} generate={generate} onAnnounce={setAnnouncement} /> : null}
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

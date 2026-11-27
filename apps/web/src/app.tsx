import { FrontOfHouse } from './features/desk/front-of-house';
import type { FrontOfHouseProps } from './features/desk/front-of-house';
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
  readonly createClient?: FrontOfHouseProps['createClient'];
  readonly useBinding?: FrontOfHouseProps['useBinding'];
  readonly generate?: FrontOfHouseProps['generate'];
}

/**
 * The open book: bring notes, confirm them, then choose the sample crypt or Generate. The confirmed
 * notes text goes only to the worker, and only after the learner presses Generate. Nothing about the
 * run is kept for a reload except what the saved-crypt storage already holds.
 */
export function IngestScreen({ store: notesStore, createClient, useBinding, generate }: IngestScreenProps): React.JSX.Element {
  return <FrontOfHouse route="ingest" store={notesStore} createClient={createClient} useBinding={useBinding} generate={generate} />;
}

/** `/` is the desk; `/ingest` is the open book. Each screen draws its own `main`. */
export function App(): React.JSX.Element {
  const baseUrl = import.meta.env.BASE_URL;
  const route = routeFor(globalThis.location.pathname, baseUrl);
  return <FrontOfHouse route={route} store={store} baseUrl={baseUrl} />;
}

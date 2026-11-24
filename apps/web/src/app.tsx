import { IngestFlow } from './features/ingest/ingest-flow';
import { createIdbStore } from './features/ingest/notes-store-idb';
import { createMemoryStore } from './features/ingest/notes-store-memory';
import { createSessionStore } from './features/ingest/notes-store';
import { routeFor } from './routes';
import './styles/app.css';

// Saved on this device when IndexedDB works; kept for the session when it does not.
const store = createSessionStore(createIdbStore(), createMemoryStore());

export function App(): React.JSX.Element {
  const baseUrl = import.meta.env.BASE_URL;
  if (routeFor(globalThis.location.pathname, baseUrl) === 'ingest') {
    return (
      <main className="screen">
        <IngestFlow store={store} />
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
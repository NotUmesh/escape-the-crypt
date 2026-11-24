import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { IngestFlow } from './features/ingest/ingest-flow';
import { createMemoryStore } from './features/ingest/notes-store-memory';
import { TestParent } from './features/ingest/test-parent';
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/app.css';

// Layout-test entry, built only in e2e mode. `?width=` sets the parent width.
const width = Number(new URLSearchParams(globalThis.location.search).get('width') ?? '360');
const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');
createRoot(container).render(
  <StrictMode>
    <TestParent width={Number.isFinite(width) && width > 0 ? width : 360}>
      <IngestFlow store={createMemoryStore()} />
    </TestParent>
  </StrictMode>,
);
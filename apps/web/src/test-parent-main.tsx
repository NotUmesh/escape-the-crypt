import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserExtractionClient } from './features/ingest/browser-extraction-client';
import type { ExtractionClient } from './features/ingest/extraction-client';
import { IngestFlow } from './features/ingest/ingest-flow';
import { createMemoryStore } from './features/ingest/notes-store-memory';
import { TestParent } from './features/ingest/test-parent';
import { createCannedExtractionClient } from './test-support/canned-extraction-client';
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/app.css';
import './styles/costume.css';

/** Hooks the layout test calls to let a held count or read go ahead. */
export interface IngestTestHooks {
  releaseCount(): void;
  releaseStart(): void;
}

/**
 * The real client, except that `count` and `start` wait until the test releases
 * them. This keeps the Stop button on screen long enough to measure.
 */
function createHeldClient(): ExtractionClient {
  const real = createBrowserExtractionClient();
  let stopped = 0;
  const gate = (): { wait: Promise<void>; release: () => void } => {
    let release: () => void = () => undefined;
    const wait = new Promise<void>((resolve) => (release = resolve));
    return { wait, release };
  };
  const count = gate();
  const start = gate();
  (globalThis as { ingestTest?: IngestTestHooks }).ingestTest = {
    releaseCount: count.release,
    releaseStart: start.release,
  };
  return {
    count: async (request) => {
      const mine = stopped;
      await count.wait;
      return mine === stopped ? real.count(request) : { ok: true, value: true };
    },
    start: async (request) => {
      const mine = stopped;
      await start.wait;
      return mine === stopped ? real.start(request) : { ok: true, value: true };
    },
    cancel: () => {
      stopped += 1;
      real.cancel();
    },
    terminate: () => {
      stopped += 1;
      real.terminate();
    },
  };
}

// Layout-test entry, built only in e2e mode. `?width=` sets the parent width and
// `?hold=1` holds the count and read steps until released. `?client=canned` uses
// canned pages and runs no pdf.js worker.
const params = new URLSearchParams(globalThis.location.search);
const width = Number(params.get('width') ?? '360');
const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');
createRoot(container).render(
  <StrictMode>
    <TestParent width={Number.isFinite(width) && width > 0 ? width : 360}>
      <IngestFlow
        store={createMemoryStore()}
        createClient={
          params.get('client') === 'canned'
            ? createCannedExtractionClient
            : params.get('hold') === '1'
              ? createHeldClient
              : undefined
        }
      />
    </TestParent>
  </StrictMode>,
);
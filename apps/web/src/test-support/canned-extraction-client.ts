import { classifyPage } from '@escape-the-crypt/core';
import type { ExtractionClient } from '../features/ingest/extraction-client';

/** Three canned pages: prose (ok), a near-empty scan (low-text) and short table rows (suspicious). */
export const CANNED_PAGES: ReadonlyArray<{ readonly label: string; readonly text: string }> = [
  {
    label: 'iv',
    text:
      'Active recall means producing an answer from memory instead of re-reading the notes. ' +
      'Spaced repetition schedules each review just before the learner would forget the item.',
  },
  { label: 'v', text: 'Figure 3' },
  {
    label: 'vi',
    text: Array.from({ length: 12 }, (_, i) => `R${i + 1}  ${i}  ${i * 2}`).join('\n'),
  },
];

/**
 * An Extraction Client that runs no pdf.js and no worker. It reports the canned
 * pages, with printed labels, and flags each with the real Page Checker. Used
 * by the e2e test parent so axe can scan the page list where a worker cannot run.
 */
export function createCannedExtractionClient(): ExtractionClient {
  let generation = 0;
  const later = (run: () => void): void => {
    const mine = generation;
    setTimeout(() => {
      if (mine === generation) run();
    }, 0);
  };
  return {
    count: ({ onMessage }) => {
      later(() =>
        onMessage({ type: 'counted', pageCount: CANNED_PAGES.length, labels: CANNED_PAGES.map((p) => p.label) }),
      );
      return Promise.resolve({ ok: true, value: true });
    },
    start: ({ pageIndexes, onMessage }) => {
      later(() => {
        pageIndexes.forEach((index, i) => {
          const page = CANNED_PAGES[index];
          if (page === undefined) return;
          onMessage({ type: 'progress', page: i + 1, total: pageIndexes.length });
          onMessage({
            type: 'page',
            pdfPageIndex: index,
            printedPageLabel: page.label,
            text: page.text,
            flag: classifyPage(page.text),
          });
        });
        onMessage({ type: 'done' });
      });
      return Promise.resolve({ ok: true, value: true });
    },
    cancel: () => {
      generation += 1;
    },
    terminate: () => {
      generation += 1;
    },
  };
}
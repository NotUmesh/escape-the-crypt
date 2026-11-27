import { describe, expect, it } from 'vitest';
import { INGEST_UI_COPY, chunkDocument } from '@escape-the-crypt/core';
import { clickButton, typeNotes, useMount } from '../../test-support/flow-dom';
import { IngestFlow } from './ingest-flow';
import { createMemoryStore } from './notes-store-memory';

const mount = useMount();

const P1 = 'Active recall means producing an answer from memory instead of re-reading the notes.';
const P2 = 'Spaced repetition schedules each review just before the learner would forget the item.';
const P3 = 'Interleaving mixes related topics in one session so similar ideas stay distinct.';

function chunkTotal(text: string): number {
  return chunkDocument({ sourceType: 'paste', text, originalText: text }).length;
}

/** The text of the paragraph in the notes-ready card that reports the piece count. */
function readyCardText(container: HTMLElement): string {
  const card = container.querySelector('.ingest-confirmed');
  if (card === null) throw new Error('no notes-ready card');
  return card.querySelector('.ingest-text')?.textContent ?? '';
}

describe('notes-ready card piece count', () => {
  it('shows the real chunk count for several paragraphs', async () => {
    const text = `${P1}\n\n${P2}\n\n${P3}`;
    const n = chunkTotal(text);
    expect(n).toBe(3);
    mount.render(<IngestFlow store={createMemoryStore()} />);
    typeNotes(mount.container, text);
    await clickButton(mount.container, 'Confirm notes');
    expect(readyCardText(mount.container)).toBe(INGEST_UI_COPY.chunkCount(n));
    expect(readyCardText(mount.container)).toBe('3 pieces of your notes');
    expect(readyCardText(mount.container)).toMatch(/\d/);
  });

  it('shows "1 piece of your notes" for a single paragraph', async () => {
    expect(chunkTotal(P1)).toBe(1);
    mount.render(<IngestFlow store={createMemoryStore()} />);
    typeNotes(mount.container, P1);
    await clickButton(mount.container, 'Confirm notes');
    expect(readyCardText(mount.container)).toBe('1 piece of your notes');
  });
});

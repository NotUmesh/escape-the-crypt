import { chunkDocument } from '@escape-the-crypt/core';
import { describe, expect, it } from 'vitest';
import { SAMPLE_BUNDLE, SAMPLE_CRYPT, SAMPLE_NOTES_TEXT } from '../../test-support/sample-bundle';
import { buildGeneratedCrypt, notesTextFromChunks } from './generated-crypt';

const pasteChunks = (text: string) => chunkDocument({ sourceType: 'paste', text, originalText: text });

describe('buildGeneratedCrypt', () => {
  it('resolves every excerpt chunk id of a bundle built from the notes text', () => {
    const chunkIds = new Set(pasteChunks(SAMPLE_NOTES_TEXT).map((c) => c.id));
    // The ids the sample builder cited are the ids chunkDocument gives the same text.
    for (const id of SAMPLE_CRYPT.chunks.keys()) expect(chunkIds.has(id)).toBe(true);
    const built = buildGeneratedCrypt(SAMPLE_BUNDLE, SAMPLE_NOTES_TEXT);
    if (!built.ok) throw new Error('bundle rejected');
    const entries = Object.values(SAMPLE_BUNDLE.content.questions);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      for (const excerpt of entry.excerpts) expect(built.value.chunks.has(excerpt.chunkId)).toBe(true);
    }
    expect(built.value.source).toBe('notes');
  });

  it('sets a bundle aside when an excerpt cites a chunk the notes do not have', () => {
    const built = buildGeneratedCrypt(SAMPLE_BUNDLE, 'A different set of notes.\n\nWith two paragraphs of text.');
    expect(built).toEqual({ ok: false, error: { kind: 'excerpt-chunk-unknown' } });
  });
});

describe('notesTextFromChunks', () => {
  it('gives text that chunks back to the same chunk texts', () => {
    const confirmed = pasteChunks(SAMPLE_NOTES_TEXT);
    const sent = notesTextFromChunks(confirmed);
    expect(pasteChunks(sent).map((c) => c.text)).toEqual(confirmed.map((c) => c.text));
  });
});
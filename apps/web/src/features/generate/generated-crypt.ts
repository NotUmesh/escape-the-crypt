import { chunkDocument } from '@escape-the-crypt/core';
import type { Chunk, CryptBundle, Result, RunSettings, SampleCryptResult } from '@escape-the-crypt/core';

/** The text the worker is sent: the confirmed chunks' text, one paragraph each. */
export function notesTextFromChunks(chunks: readonly Chunk[]): string {
  return chunks.map((chunk) => chunk.text).join('\n\n');
}

/** A playable crypt from notes. documentDigest is the digest of the confirmed notes record, kept so a restore finds the notes. */
export type GeneratedCrypt = SampleCryptResult & {
  readonly source: 'notes';
  readonly documentDigest?: string;
  /** The settings the learner chose when generating. */
  readonly settings?: RunSettings;
};

export type GeneratedCryptError = { readonly kind: 'excerpt-chunk-unknown' };

/**
 * Pairs a worker bundle with the chunks of the notes text that was sent. The worker chunks that
 * text as pasted notes, so chunking it the same way here gives the same code-assigned chunk IDs.
 * A bundle that cites an ID outside those chunks is set aside.
 */
export function buildGeneratedCrypt(
  bundle: CryptBundle,
  notesText: string,
  documentDigest?: string,
  settings?: RunSettings,
): Result<GeneratedCrypt, GeneratedCryptError> {
  const chunks = new Map<string, Chunk>();
  for (const chunk of chunkDocument({ sourceType: 'paste', text: notesText, originalText: notesText })) {
    chunks.set(chunk.id, chunk);
  }
  for (const entry of Object.values(bundle.content.questions)) {
    for (const excerpt of entry.excerpts) {
      if (!chunks.has(excerpt.chunkId)) return { ok: false, error: { kind: 'excerpt-chunk-unknown' } };
    }
  }
  return {
    ok: true,
    value: {
      manifest: bundle.manifest,
      content: bundle.content,
      chunks,
      source: 'notes',
      ...(settings === undefined ? {} : { settings }),
      ...(documentDigest === undefined || documentDigest === '' ? {} : { documentDigest }),
    },
  };
}

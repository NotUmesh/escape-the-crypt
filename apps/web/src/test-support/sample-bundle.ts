import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHumanHeartSampleCrypt } from '@escape-the-crypt/core';
import type { CryptBundle, HumanHeartQuestionsFile, SampleCryptResult } from '@escape-the-crypt/core';

const SAMPLES = join(process.cwd(), '..', '..', 'samples');

/** The bundled sample notes, exactly as the sample builder reads them. */
export const SAMPLE_NOTES_TEXT = readFileSync(join(SAMPLES, 'human-heart.txt'), 'utf8');

function build(): SampleCryptResult {
  const file = JSON.parse(
    readFileSync(join(SAMPLES, 'questions', 'human-heart.json'), 'utf8'),
  ) as HumanHeartQuestionsFile;
  const built = buildHumanHeartSampleCrypt(SAMPLE_NOTES_TEXT, file);
  if (!built.ok) throw new Error(`sample crypt failed: ${built.error.kind}`);
  return built.value;
}

export const SAMPLE_CRYPT: SampleCryptResult = build();

/** A worker bundle built from the sample notes: what a fake worker would return for them. */
export const SAMPLE_BUNDLE: CryptBundle = { manifest: SAMPLE_CRYPT.manifest, content: SAMPLE_CRYPT.content };

import type { Result } from '../types';
import { buildHttpsSampleCrypt } from './https';
import { buildHumanHeartSampleCrypt } from './human-heart';
import { buildPrintingPressSampleCrypt } from './printing-press';
import type { SampleCryptError, SampleCryptResult, SampleQuestionsFile, UnknownSampleError } from './sample-builder';

export type { UnknownSampleError };

/** The sample crypts, in the order the hub lists them. */
export const SAMPLE_IDS = ['human-heart', 'https', 'printing-press'] as const;
export type SampleId = (typeof SAMPLE_IDS)[number];

export type SampleBuilder = (
  notesText: string,
  questionsJson: SampleQuestionsFile,
) => Result<SampleCryptResult, SampleCryptError>;

const BUILDERS: Readonly<Record<SampleId, SampleBuilder>> = {
  'human-heart': buildHumanHeartSampleCrypt,
  https: buildHttpsSampleCrypt,
  'printing-press': buildPrintingPressSampleCrypt,
};

/** The `manifestId` each sample's builder produces. A saved run records it, so a run can find its sample again. */
export const SAMPLE_MANIFEST_IDS: Readonly<Record<SampleId, string>> = {
  'human-heart': 'human-heart-sample',
  https: 'https-sample',
  'printing-press': 'printing-press-sample',
};

/** The sample a saved run's manifest came from, or null when the ID is not a sample's. */
export function sampleIdForManifestId(manifestId: string): SampleId | null {
  return SAMPLE_IDS.find((id) => SAMPLE_MANIFEST_IDS[id] === manifestId) ?? null;
}

export function isSampleId(id: string): id is SampleId {
  return (SAMPLE_IDS as readonly string[]).includes(id);
}

/** The builder for a sample, or a typed `unknown-sample` error. Never falls back to another sample. */
export function getSampleBuilder(id: string): Result<SampleBuilder, UnknownSampleError> {
  return isSampleId(id) ? { ok: true, value: BUILDERS[id] } : { ok: false, error: { kind: 'unknown-sample', id } };
}

import { getSampleBuilder } from '@escape-the-crypt/core';
import type { SampleId, SampleQuestionsFile } from '@escape-the-crypt/core';
import httpsQuestions from '../../../../../samples/questions/https.json';
import humanHeartQuestions from '../../../../../samples/questions/human-heart.json';
import printingPressQuestions from '../../../../../samples/questions/printing-press.json';
import httpsNotes from '../../../../../samples/https.txt?raw';
import humanHeartNotes from '../../../../../samples/human-heart.txt?raw';
import printingPressNotes from '../../../../../samples/printing-press.txt?raw';
import type { BuildCrypt } from '../../state/room-binding';

/**
 * The bundled notes and questions of each sample, imported at build time so no request leaves the
 * origin. Keyed by the same IDs as the hub's sample list and the core sample registry.
 */
const SOURCES: Readonly<Record<SampleId, { readonly notes: string; readonly questions: SampleQuestionsFile }>> = {
  'human-heart': { notes: humanHeartNotes, questions: humanHeartQuestions as SampleQuestionsFile },
  https: { notes: httpsNotes, questions: httpsQuestions as SampleQuestionsFile },
  'printing-press': { notes: printingPressNotes, questions: printingPressQuestions as SampleQuestionsFile },
};

/**
 * A `BuildCrypt` for one sample, in the shape `useRoomBinding` accepts. An ID that names no sample
 * gives a typed `unknown-sample` error and never another sample's crypt.
 *
 * Resume: a saved https or printing-press run restores through `restoreRun` in `state/storage`,
 * which rebuilds the sample's chunks. Until it calls this function with the sample its manifest came
 * from (`sampleIdForManifestId`), such a run returns `record-unreadable`.
 */
export function buildCryptForSample(id: string): BuildCrypt {
  return () => {
    const builder = getSampleBuilder(id);
    if (!builder.ok) return builder;
    const source = SOURCES[id as SampleId];
    return builder.value(source.notes, source.questions);
  };
}

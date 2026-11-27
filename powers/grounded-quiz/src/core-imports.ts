/**
 * The only file in this Power that reaches into `packages/core`. Nothing in core is edited.
 *
 * The Power imports core's source files directly rather than `@escape-the-crypt/core`, because core's
 * public index exports only part of the evidence-check API (`runChecks`, the check registry and the
 * authoring schema are not in it). Relative paths into `src` keep core untouched and keep the Power out
 * of the pnpm workspace graph, so it adds no dependency and no lockfile change. The build bundles all of
 * it into one file, `server/index.mjs`, so an installed Power needs nothing from this repository.
 */
export { parseAuthoringQuestion } from '../../../packages/core/src/authoring/parse';
export type { AuthoringQuestion } from '../../../packages/core/src/authoring/schema';
export { CHECK_REGISTRY, CHECK_VERSION } from '../../../packages/core/src/checks/registry';
export { runChecks, runRoomChecks } from '../../../packages/core/src/checks/run-checks';
export type { CheckableQuestion, EvidenceContext } from '../../../packages/core/src/checks/run-checks';
export { MAX_QUOTE_WORDS } from '../../../packages/core/src/checks/evidence';
export type { CheckFailure, CheckId } from '../../../packages/core/src/checks/types';
export { MAX_EXTRACTED_WORDS, checkWordCount, countWords } from '../../../packages/core/src/limits';
export { normaliseWithMap } from '../../../packages/core/src/normalise';
export { prepareDocument, toEvidenceContext } from '../../../packages/core/src/pipeline/prepare-input';
export type { PreparedDocument } from '../../../packages/core/src/pipeline/prepare-input';
export { MIN_QUOTE_CHARS, MIN_QUOTE_WORDS, resolveQuote } from '../../../packages/core/src/quote-resolver';
export type { Chunk } from '../../../packages/core/src/types';

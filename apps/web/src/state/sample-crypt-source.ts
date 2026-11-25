import { buildHumanHeartSampleCrypt } from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, Result, SampleCryptError, SampleCryptResult } from '@escape-the-crypt/core';
import questionsFile from '../../../../samples/questions/human-heart.json';
import notesText from '../../../../samples/human-heart.txt?raw';

/**
 * The default `buildCrypt` seam: builds the sample crypt from the bundled notes and questions.
 * Both are imported at build time, so no request leaves the origin.
 */
export function buildSampleCrypt(): Result<SampleCryptResult, SampleCryptError> {
  return buildHumanHeartSampleCrypt(notesText, questionsFile as HumanHeartQuestionsFile);
}

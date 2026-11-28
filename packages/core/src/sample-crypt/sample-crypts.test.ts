import { beforeAll, describe, expect, it } from 'vitest';
import { parseCryptBundle } from '../mapper/crypt-bundle-parse';
import { CryptContentSchema } from '../mapper/crypt-content';
import { apply } from '../runtime/apply';
import { initial } from '../runtime/initial';
import { parseManifest } from '../runtime/manifest-schema';
import type { CryptManifest, QuestionSpec } from '../runtime/manifest-types';
import type { State } from '../runtime/state-types';
import { playToEscape } from '../test-support/escape-driver';
import { submissionFor } from '../test-support/question-answers';
import { SETTINGS } from '../test-support/run-settings';
import { openTargets, questionFor } from '../test-support/runtime-model-support';
import type { Event, LockType } from '../types';
import { LOCK_TYPES } from '../types';
import { SAMPLE_IDS, SAMPLE_MANIFEST_IDS, getSampleBuilder, sampleIdForManifestId } from './sample-registry';
import type { SampleId } from './sample-registry';
import type { SampleCryptResult, SampleQuestionsFile } from './sample-builder';

// packages/core compiles without Node types, so load Node modules dynamically.
async function readSample(id: string): Promise<{ notes: string; file: SampleQuestionsFile }> {
  const fsSpecifier: string = 'node:fs';
  const urlSpecifier: string = 'node:url';
  const fs = (await import(fsSpecifier)) as unknown as { readFileSync(path: string, enc: string): string };
  const url = (await import(urlSpecifier)) as unknown as { fileURLToPath(href: string): string };
  const href = (import.meta as unknown as { url: string }).url;
  const here = url.fileURLToPath(href).replace(/\\/g, '/').replace(/\/[^/]*$/, '');
  const root = `${here}/../../../..`;
  return {
    notes: fs.readFileSync(`${root}/samples/${id}.txt`, 'utf8'),
    file: JSON.parse(fs.readFileSync(`${root}/samples/questions/${id}.json`, 'utf8')) as SampleQuestionsFile,
  };
}
async function build(id: SampleId): Promise<SampleCryptResult> {
  const { notes, file } = await readSample(id);
  const builder = getSampleBuilder(id);
  if (!builder.ok) throw new Error(`no builder for ${id}`);
  const built = builder.value(notes, file);
  if (!built.ok) throw new Error(`${id} failed: ${JSON.stringify(built.error)}`);
  return built.value;
}
/** Primary and alternate questions of every slot, then the final door's. */
function allQuestions(m: CryptManifest): QuestionSpec[] {
  const out: QuestionSpec[] = [];
  for (const room of m.rooms) {
    for (const slot of room.lockSlots) {
      out.push(slot.primaryQuestion);
      if (slot.alternateQuestion !== null) out.push(slot.alternateQuestion);
    }
  }
  for (const slot of m.finalDoor.slots) out.push(slot.question);
  return out;
}
/** The types a player meets without challenging anything: every slot's primary and the final door. */
function placedTypes(m: CryptManifest): Set<LockType> {
  const types = new Set<LockType>();
  for (const room of m.rooms) for (const slot of room.lockSlots) types.add(slot.primaryQuestion.lockType);
  for (const slot of m.finalDoor.slots) types.add(slot.question.lockType);
  return types;
}
function step(state: State, event: Event): State {
  const result = apply(state, event);
  if (!result.ok) throw new Error(`${event.kind} rejected: ${result.error.kind}`);
  return result.state;
}
/** Answers every question correctly, in order, continuing each evidence panel, room by room, then the door. */
function playAllCorrect(manifest: CryptManifest): State {
  let state = initial(manifest, SETTINGS);
  state = step(state, { kind: 'RunStarted', manifestId: state.manifestId });
  const first = manifest.rooms[0]?.roomId ?? '';
  state = step(state, { kind: 'RoomPublished', roomId: first });
  state = step(state, { kind: 'CryptFinalised', finalRoomCount: manifest.rooms.length });
  state = step(state, { kind: 'RoomEntered', roomId: first });
  for (let guard = 0; guard < 80 && state.status !== 'escaped'; guard += 1) {
    const target = state.atFinalDoor
      ? state.finalDoor.slots.filter((s) => s.status === 'open').map((s) => ({ slotId: s.slotId, questionId: s.currentQuestionId }))[0]
      : openTargets(state)[0];
    if (target !== undefined) {
      const question = questionFor(manifest, target.questionId);
      state = step(state, { kind: 'AnswerSubmitted', slotId: target.slotId, submission: submissionFor(question, true) });
      // The answer that escapes ends the run: the runtime then refuses events, and the screen closes the panel locally.
      if (state.status !== 'escaped') state = step(state, { kind: 'EvidenceContinued', slotId: target.slotId });
      continue;
    }
    if (state.atFinalDoor) break;
    if (state.finalDoor.available) {
      state = step(state, { kind: 'FinalDoorEntered' });
      continue;
    }
    const index = state.rooms.findIndex((r) => r.roomId === state.currentRoomId);
    const next = manifest.rooms[index + 1];
    if (next === undefined) break;
    if (state.rooms[index + 1]?.published !== true) state = step(state, { kind: 'RoomPublished', roomId: next.roomId });
    state = step(state, { kind: 'RoomEntered', roomId: next.roomId });
  }
  return state;
}

const NEW_SAMPLES: readonly SampleId[] = ['https', 'printing-press'];

describe.each(SAMPLE_IDS)('sample crypt %s', (id) => {
  let sample: SampleCryptResult;
  beforeAll(async () => {
    sample = await build(id);
  });

  it('is published with the manifest ID the registry records', () => {
    expect(sample.manifest.manifestId).toBe(SAMPLE_MANIFEST_IDS[id]);
    expect(sampleIdForManifestId(sample.manifest.manifestId)).toBe(id);
  });
  it('passes the manifest schema and the bundle parser, and its content passes the content schema', () => {
    expect(parseManifest(JSON.parse(JSON.stringify(sample.manifest))).ok).toBe(true);
    expect(CryptContentSchema.safeParse(sample.content).success).toBe(true);
    const bundle = parseCryptBundle(JSON.parse(JSON.stringify({ manifest: sample.manifest, content: sample.content })));
    expect(bundle.ok).toBe(true);
  });
  it('has a content entry and a concept title for every question', () => {
    for (const q of allQuestions(sample.manifest)) expect(sample.content.questions[q.questionId], q.questionId).toBeDefined();
    for (const room of sample.manifest.rooms) {
      for (const slot of room.lockSlots) expect(sample.content.concepts[slot.conceptId]?.title, slot.conceptId).toBeTruthy();
    }
  });
  it('cites chunks that exist, and every quote is found in its chunk', () => {
    for (const q of allQuestions(sample.manifest)) {
      const entry = sample.content.questions[q.questionId];
      expect(q.evidenceRefs.length, q.questionId).toBeGreaterThan(0);
      for (const ref of q.evidenceRefs) expect(sample.chunks.has(ref), `${q.questionId} cites ${ref}`).toBe(true);
      const cited = new Set(entry?.excerpts.map((e) => e.chunkId));
      expect([...cited].sort(), q.questionId).toEqual([...q.evidenceRefs].sort());
      for (const excerpt of entry?.excerpts ?? []) {
        const text = sample.chunks.get(excerpt.chunkId)?.text ?? '';
        expect(text.includes(excerpt.quote), `${q.questionId}: "${excerpt.quote}"`).toBe(true);
      }
    }
  });
  it('gives each item its text under the payload IDs, and a dial none', () => {
    for (const q of allQuestions(sample.manifest)) {
      const options = sample.content.questions[q.questionId]?.options;
      const p = q.payload as Record<string, unknown>;
      const ids = (key: string): string[] => (Array.isArray(p[key]) ? (p[key] as string[]) : []);
      if (q.lockType === 'bone-ordering') expect(Object.keys(options ?? {}).sort()).toEqual([...ids('itemIds')].sort());
      if (q.lockType === 'bound-threads') expect(Object.keys(options ?? {}).sort()).toEqual([...ids('leftIds'), ...ids('rightIds')].sort());
      if (q.lockType === 'cursed-object') expect(Object.keys(options ?? {}).sort()).toEqual([...ids('optionIds')].sort());
      if (q.lockType === 'seance-board') expect(Object.keys(options ?? {}).sort()).toEqual([...ids('optionIds')].sort());
      if (q.lockType === 'combination-dial') expect(options).toBeUndefined();
      for (const text of Object.values(options ?? {})) expect(text.trim()).not.toBe('');
    }
  });
  it('is deterministic', async () => {
    expect(await build(id)).toEqual(sample);
  });
  it('reaches escaped by answering every question correctly', () => {
    const state = playAllCorrect(sample.manifest);
    expect(state.status).toBe('escaped');
  });
  it.each(['all skip', 'all challenge', 'all wrong'] as const)('reaches escaped when %s, from several seeds', (policy) => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const result = playToEscape(sample.manifest, policy, seed);
      expect(result.state.status, `${policy} seed ${seed}`).toBe('escaped');
    }
  });
});

describe.each(NEW_SAMPLES)('sample crypt %s places every lock type', (id) => {
  it('has all six types among its slot primaries and final-door questions, across two rooms and a final door', async () => {
    const sample = await build(id);
    expect([...placedTypes(sample.manifest)].sort()).toEqual([...LOCK_TYPES].sort());
    expect(sample.manifest.rooms.length).toBeGreaterThanOrEqual(2);
    expect(sample.manifest.finalDoor.slots.length).toBeGreaterThanOrEqual(3);
  });
  it('rejects a corrupted payload at the schema', async () => {
    const sample = await build(id);
    const raw = JSON.parse(JSON.stringify(sample.manifest)) as CryptManifest;
    const bound = allQuestions(raw).find((q) => q.lockType === 'bound-threads');
    expect(bound).toBeDefined();
    if (bound === undefined) return;
    (bound.payload as { keyPairs: unknown }).keyPairs = 'not pairs';
    expect(parseManifest(raw).ok).toBe(false);
  });
});

describe('sample crypt human-heart', () => {
  // human-heart still places only the rune cipher and the séance board. Widening it moves the
  // number of final-door seals, which tests under apps/web/src/state pin; see the phase 3 report.
  it.todo('places all six lock types (waits for a decision on the state tests that pin its shape)');
});

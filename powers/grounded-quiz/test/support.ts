import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNotesStore } from '../src/notes-store';
import { SUPPORTED_LOCK_TYPES } from '../src/tool-checks';
import { callTool } from '../src/tools';
import type { ToolContext } from '../src/tool-types';

export const POWER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = resolve(POWER_DIR, '..', '..');

/** The sample notes the Power's tests run on. */
export const HUMAN_HEART = readFileSync(join(REPO_DIR, 'samples', 'human-heart.txt'), 'utf8');

export interface SampleQuestion {
  readonly id: string;
  readonly lockType: string;
  readonly role: string;
  readonly conceptId: string;
  readonly [key: string]: unknown;
}

/** The sample question file for the human heart, in the authoring format. */
export function sampleQuestions(): readonly SampleQuestion[] {
  const file = JSON.parse(readFileSync(join(REPO_DIR, 'samples', 'questions', 'human-heart.json'), 'utf8')) as {
    questions: SampleQuestion[];
  };
  return file.questions;
}

/** The sample questions of a lock type the Power checks. */
export function supportedSampleQuestions(): readonly SampleQuestion[] {
  return sampleQuestions().filter((q) => (SUPPORTED_LOCK_TYPES as readonly string[]).includes(q.lockType));
}

export function newContext(): ToolContext {
  return { store: createNotesStore() };
}

export type Json = Record<string, unknown>;

/** Runs a tool and returns its value; fails the test with the refusal if it refused. */
export function run(name: string, args: Json, ctx: ToolContext): Json {
  const outcome = callTool(name, args, ctx);
  if (!outcome.ok) throw new Error(`${name} refused: ${outcome.error.code}: ${outcome.error.message}`);
  return outcome.value as Json;
}

/** Prepares the human-heart notes and returns the id. */
export function prepareHeart(ctx: ToolContext): { notesId: string; value: Json } {
  const value = run('prepare_notes', { text: HUMAN_HEART }, ctx);
  return { notesId: String(value['notesId']), value };
}

export function byId(id: string): SampleQuestion {
  const found = sampleQuestions().find((q) => q.id === id);
  if (found === undefined) throw new Error(`no sample question ${id}`);
  return found;
}

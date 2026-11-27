import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHECK_VERSION,
  makeMockLedger,
  parseCassetteFile,
  type CassetteFile,
  type Provider,
  type ProviderRequest,
  type ProviderUsage,
} from '@escape-the-crypt/core';
import { costOfUsage } from '../budget/interim-ledger';
import { EVAL_ALLOWED_LOCK_TYPES } from '../config';
import { settingsFor } from '../evaluation/cli';
import { runDevSet, type DevSetDeps, type DevSetRun } from '../evaluation/run-dev-set';
import { HEART_NOTES, HEART_SETTINGS } from '../http/http-test-support';
import { geminiBody, makeGeminiProvider, type FetchLike } from './gemini-provider';

/**
 * Contract: the same pipeline cassette flow runs unchanged when the live provider is the Gemini
 * adapter. Pass A replays the synthetic human-heart cassette and notes, for every request, the
 * Gemini body it maps to and the recorded JSON. Pass B records through `makeGeminiProvider` with a
 * fake fetch that answers each body with that JSON in a Gemini envelope. No network.
 */
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const heartCassette = (): CassetteFile => {
  const parsed = parseCassetteFile(JSON.parse(readFileSync(`${repoRoot}packages/core/src/test-support/cassettes/human-heart-e2e.json`, 'utf8')));
  if (!parsed.ok) throw new Error('cassette does not parse');
  return parsed.value;
};
const NOTE = { name: 'dev-00-heart.txt', text: HEART_NOTES };
const GEMINI_MODEL = 'gemini-fake-model';
const PRICES = { inputUsdPerMTok: 2, outputUsdPerMTok: 12 };
// Per call: 100 prompt + 40 answer + 10 thinking tokens. Thinking is billed as output.
const USAGE_METADATA = { promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 10 };
const PER_CALL: ProviderUsage = { inputTokens: 100, outputTokens: 50 };
const SUPPORTED = new Set(['type', 'properties', 'required', 'additionalProperties', 'enum', 'format', 'minimum', 'maximum', 'items', 'prefixItems', 'minItems', 'maxItems', 'anyOf', 'title', 'description', 'minLength', 'maxLength']);

const keyOf = (body: unknown): string => JSON.stringify(body);

function deps(over: Partial<DevSetDeps>): DevSetDeps {
  return {
    notes: [NOTE],
    loadCassette: () => null,
    saveCassette: () => undefined,
    live: null,
    ledger: makeMockLedger({ dailyCapUsd: 10 }),
    settings: { ...HEART_SETTINGS, costOf: (u) => costOfUsage(u, PRICES) },
    providerName: 'gemini',
    checkVersion: CHECK_VERSION,
    now: () => 0,
    log: () => undefined,
    ...over,
  };
}

/** Pass A: replay, remembering body → recorded JSON for every call. */
async function replayAndRemember(): Promise<{ run: DevSetRun; answers: Map<string, unknown> }> {
  const answers = new Map<string, unknown>();
  const spy = (inner: Provider): Provider => ({
    async complete(request: ProviderRequest) {
      const result = await inner.complete(request);
      if (result.ok) answers.set(keyOf(geminiBody(request)), result.json);
      return result;
    },
  });
  const run = await runDevSet(deps({ loadCassette: () => heartCassette(), providerName: 'synthetic', wrap: spy }));
  return { run, answers };
}

function fakeGemini(answers: Map<string, unknown>, override?: (body: Record<string, unknown>) => unknown): { fetch: FetchLike; urls: string[]; bodies: Record<string, unknown>[] } {
  const urls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const fetch: FetchLike = async (url, init) => {
    urls.push(url);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    bodies.push(body);
    const json = override?.(body) ?? answers.get(keyOf(body));
    if (json === undefined) return new Response('{}', { status: 404 });
    const envelope = { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(json) }] } }], usageMetadata: USAGE_METADATA };
    return new Response(JSON.stringify(envelope), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch, urls, bodies };
}

function walkSchema(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walkSchema(n, visit));
  if (node === null || typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  visit(rec);
  for (const [key, value] of Object.entries(rec)) {
    if (key === 'properties' && value !== null && typeof value === 'object') Object.values(value).forEach((c) => walkSchema(c, visit));
    else if (key === 'items' || key === 'anyOf' || key === 'prefixItems') walkSchema(value, visit);
  }
}

describe('Gemini provider in the pipeline cassette flow', () => {
  it('records through the Gemini adapter with the same outcome, usage in the ledger and a replayable cassette', async () => {
    const a = await replayAndRemember();
    const noteA = a.run.notes[0]!;
    expect(noteA.ok).toBe(true);
    expect(noteA.replayedCalls).toBeGreaterThan(0);

    const fake = fakeGemini(a.answers);
    const ledger = makeMockLedger({ dailyCapUsd: 10 });
    const saved = new Map<string, CassetteFile>();
    const live = makeGeminiProvider({ apiKey: 'AIza-fake-key', fetch: fake.fetch });
    const b = await runDevSet(
      deps({ live, ledger, settings: { ...HEART_SETTINGS, modelId: GEMINI_MODEL, costOf: (u) => costOfUsage(u, PRICES) }, saveCassette: (n, f) => void saved.set(n, f) }),
    );
    const noteB = b.notes[0]!;

    // Same pipeline outcome as the replay.
    expect(noteB.ok).toBe(true);
    expect(noteB.liveCalls).toBe(noteA.replayedCalls);
    expect(noteB.concepts).toEqual(noteA.concepts);
    expect(noteB.candidates).toEqual(noteA.candidates);
    expect(noteB.codeCheckRejections).toEqual(noteA.codeCheckRejections);
    expect(noteB.room?.slots.map((s) => [s.stationType, s.conceptId])).toEqual(noteA.room?.slots.map((s) => [s.stationType, s.conceptId]));

    // Every call went to the Gemini model's generateContent with a schema in Gemini's subset.
    expect(fake.urls.every((u) => u.endsWith(`/models/${GEMINI_MODEL}:generateContent`))).toBe(true);
    for (const body of fake.bodies) {
      const schema = (body['generationConfig'] as Record<string, unknown>)['responseJsonSchema'];
      walkSchema(schema, (n) => {
        for (const key of Object.keys(n)) expect(SUPPORTED, `keyword ${key}`).toContain(key);
        if (n['type'] === 'object') {
          expect(n['additionalProperties']).toBe(false);
          expect([...(n['required'] as string[])].sort()).toEqual(Object.keys(n['properties'] as object).sort());
        }
      });
    }

    // Usage reached the ledger through callWithBudget: one reservation per call, each reconciled.
    const calls = noteB.liveCalls;
    expect(noteB.tokens).toEqual({ inputTokens: calls * PER_CALL.inputTokens, outputTokens: calls * PER_CALL.outputTokens });
    expect([ledger.reservations, ledger.reconciles, ledger.releases, ledger.outstandingMicroUsd]).toEqual([calls, calls, 0, 0]);
    expect(ledger.spentMicroUsd).toBe(calls * Math.round(costOfUsage(PER_CALL, PRICES) * 1_000_000));
    expect(noteB.costUsd).toBeCloseTo(calls * costOfUsage(PER_CALL, PRICES), 9);

    // The recorded cassette replays at no cost for the Gemini model only.
    const cassette = saved.get(NOTE.name);
    expect(cassette?.entries).toHaveLength(calls);
    expect(cassette?.entries.every((e) => e.origin === 'recorded' && e.response.usage.outputTokens === 50)).toBe(true);
    const replayGemini = await runDevSet(deps({ loadCassette: () => cassette ?? null, settings: { ...HEART_SETTINGS, modelId: GEMINI_MODEL } }));
    expect([replayGemini.notes[0]?.ok, replayGemini.notes[0]?.liveCalls, replayGemini.notes[0]?.replayedCalls]).toEqual([true, 0, calls]);
    const replayOther = await runDevSet(deps({ loadCassette: () => cassette ?? null }));
    expect([replayOther.notes[0]?.ok, replayOther.notes[0]?.replayedCalls]).toEqual([false, 0]);
  });

  it('adapts every model-facing schema, for all six lock types, into Gemini’s subset', async () => {
    const schemas = new Map<string, Record<string, unknown>[]>();
    const spy = (inner: Provider): Provider => ({
      complete(request: ProviderRequest) {
        const body = geminiBody(request);
        const schema = (body['generationConfig'] as Record<string, unknown>)['responseJsonSchema'] as Record<string, unknown>;
        schemas.set(request.stage, [...(schemas.get(request.stage) ?? []), schema]);
        return inner.complete(request);
      },
    });
    // Recorded dev notes that between them reach all six lock types; replay only.
    const read = (path: string): string => readFileSync(`${repoRoot}${path}`, 'utf8');
    const names = ['dev-01-vaccines', 'dev-08-butterfly-life-cycle', 'dev-10-averages'];
    await runDevSet(
      deps({
        notes: names.map((n) => ({ name: `${n}.txt`, text: read(`eval/dev/notes/${n}.txt`) })),
        loadCassette: (note) => {
          const parsed = parseCassetteFile(JSON.parse(read(`packages/core/src/test-support/cassettes/dev/${note.replace(/\.txt$/, '.json')}`)));
          return parsed.ok ? parsed.value : null;
        },
        settings: settingsFor('gpt-5.4-mini', PRICES, EVAL_ALLOWED_LOCK_TYPES),
        wrap: spy,
      }),
    );
    expect([...schemas.keys()].sort()).toEqual(['concept-extraction', 'generation', 'review']);
    const text = JSON.stringify([...schemas.values()]);
    for (const lockType of EVAL_ALLOWED_LOCK_TYPES) expect(text).toContain(`"enum":["${lockType}"]`);
    expect(text).not.toContain('"const"');
    expect(text).not.toContain('exclusiveM');
    for (const schema of [...schemas.values()].flat()) {
      walkSchema(schema, (n) => {
        for (const key of Object.keys(n)) expect(SUPPORTED, `keyword ${key}`).toContain(key);
      });
    }
  });

  it('a Gemini reply that breaks our Zod schema is rejected by the pipeline, not published', async () => {
    const fake = fakeGemini(new Map(), () => ({ concepts: 'not a list' }));
    const live = makeGeminiProvider({ apiKey: 'AIza-fake-key', fetch: fake.fetch });
    const run = await runDevSet(deps({ live, settings: { ...HEART_SETTINGS, modelId: GEMINI_MODEL, costOf: (u) => costOfUsage(u, PRICES) } }));
    expect(run.notes[0]?.ok).toBe(false);
    expect(run.notes[0]?.errorKind).not.toBeNull();
    expect(run.notes[0]?.room).toBeNull();
    expect(fake.urls.length).toBeGreaterThan(0);
  });
});

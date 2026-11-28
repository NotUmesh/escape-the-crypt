import { describe, expect, it } from 'vitest';
import { AuthoringQuestionSchema } from '../authoring/schema';
import { makeMockLedger } from '../budget/mock-ledger';
import { checkRoomForConflicts, type ConflictCheckOptions } from './conflict-check';
import { CONFLICT_CHECK_PROMPT_VERSION } from './conflict-prompt';
import { makeScriptedProvider, userMessageOf, type StageHandler } from './orchestrator-fixtures';
import { prepareDocument, type PreparedDocument } from './prepare-input';

// packages/core compiles without Node types, so load Node modules dynamically.
const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');
const repoRoot = `${here}/../../../..`;

// Read only: the adversarial fixtures and notes are never edited here.
const fixtures = (
  JSON.parse(fs.readFileSync(`${repoRoot}/eval/adversarial/fixtures.json`, 'utf8')) as {
    fixtures: { id: string; question: unknown }[];
  }
).fixtures;
const adv18 = AuthoringQuestionSchema.parse(fixtures.find((f) => f.id === 'adv-18')!.question);
const doc: PreparedDocument = prepareDocument(
  fs.readFileSync(`${repoRoot}/eval/adversarial/notes/adv-01-moon.txt`, 'utf8'),
);

function ordinalContaining(text: string): number {
  for (const [ordinal, chunk] of doc.quotableChunksByOrdinal) if (chunk.text.includes(text)) return ordinal;
  throw new Error(`no paragraph holds: ${text}`);
}

const P_27 = ordinalContaining('The Moon takes about 27 days to orbit Earth.');
const P_35 = ordinalContaining('takes about 35 days');
const P_TIDAL = ordinalContaining('always shows the same face');
const QUOTE_35 = 'One orbit of the Moon around Earth takes about 35 days.';
const QUOTE_27 = 'The Moon takes about 27 days to orbit Earth.';

const room = [adv18];
const NO_CONFLICT = { results: [{ questionId: 'q1', conflict: false, paragraph: null, quote: null }] };
const reply = (paragraph: number | null, quote: string | null) => ({
  results: [{ questionId: 'q1', conflict: true, paragraph, quote }],
});
const FAILURE = { ok: false, error: { kind: 'provider-error', retryable: true } };

const stub: StageHandler = () => ({});
function providerOf(handler: StageHandler) {
  return makeScriptedProvider({
    'concept-extraction': stub,
    generation: stub,
    review: stub,
    'conflict-check': handler,
  });
}

const options: ConflictCheckOptions = {
  modelId: 'test-model',
  maxOutputTokens: 1000,
  timeoutMs: 5000,
  retryLimit: 0,
  worstCaseUsd: 0.001,
  costOf: () => 0.0005,
};
const newLedger = () => makeMockLedger({ dailyCapUsd: 1000 });

describe('checkRoomForConflicts', () => {
  it('makes one call with the conflict-check request shape and reports a clean room', async () => {
    const provider = providerOf(() => NO_CONFLICT);
    const ledger = newLedger();
    const out = await checkRoomForConflicts(provider, ledger, room, doc, options);
    expect(out).toEqual({
      ok: true,
      value: { status: 'checked', confirmed: [], conflictReportsIgnored: 0 },
    });
    expect(provider.requests).toHaveLength(1);
    const r = provider.requests[0]!;
    expect(r.stage).toBe('conflict-check');
    expect(r.promptVersion).toBe(CONFLICT_CHECK_PROMPT_VERSION);
    expect(r.temperature).toBe(0);
    expect([r.maxOutputTokens, r.timeoutMs, r.retryLimit]).toEqual([1000, 5000, 0]);
    expect(ledger.reservations).toBe(1);
  });

  it('confirms a resolvable conflict with both passages', async () => {
    const provider = providerOf(() => reply(P_35, QUOTE_35));
    const out = await checkRoomForConflicts(provider, newLedger(), room, doc, options);
    if (!out.ok || out.value.status !== 'checked') throw new Error('expected checked');
    expect(out.value.confirmed).toHaveLength(1);
    expect(out.value.confirmed[0]!.own.quote).toBe(QUOTE_27);
    expect(out.value.confirmed[0]!.other.quote).toBe(QUOTE_35);
    expect(out.value.conflictReportsIgnored).toBe(0);
  });

  it.each([
    ['an unresolvable quote', () => reply(P_35, 'The Moon takes about 99 days to orbit the Sun.')],
    ['a quote from the question’s own evidence', () => reply(P_27, QUOTE_27)],
    [
      'a numeric key with no differing number',
      () => reply(P_TIDAL, 'The Moon always shows the same face to Earth'),
    ],
  ])('ignores and counts %s', async (_name, make) => {
    const out = await checkRoomForConflicts(providerOf(make), newLedger(), room, doc, options);
    expect(out).toEqual({
      ok: true,
      value: { status: 'checked', confirmed: [], conflictReportsIgnored: 1 },
    });
  });

  it('retries once after a schema failure, with a note and its own reservation', async () => {
    let n = 0;
    const provider = providerOf(() => (n++ === 0 ? { nope: true } : NO_CONFLICT));
    const ledger = newLedger();
    const out = await checkRoomForConflicts(provider, ledger, room, doc, options);
    expect(out.ok && out.value.status).toBe('checked');
    expect(provider.requests).toHaveLength(2);
    expect(ledger.reservations).toBe(2);
    expect(userMessageOf(provider.requests[1]!).length).toBeGreaterThan(
      userMessageOf(provider.requests[0]!).length,
    );
  });

  it('retries once after a reply with a missing id', async () => {
    let n = 0;
    const provider = providerOf(() => (n++ === 0 ? { results: [] } : NO_CONFLICT));
    const out = await checkRoomForConflicts(provider, newLedger(), room, doc, options);
    expect(out.ok && out.value.status).toBe('checked');
    expect(provider.requests).toHaveLength(2);
  });

  it('returns an unchecked room after two schema failures', async () => {
    const provider = providerOf(() => ({ nope: true }));
    const ledger = newLedger();
    const out = await checkRoomForConflicts(provider, ledger, room, doc, options);
    expect(out).toEqual({ ok: true, value: { status: 'unchecked' } });
    expect(provider.requests).toHaveLength(2);
    expect(ledger.reservations).toBe(2);
  });

  it('returns an unchecked room on a provider failure, without a retry', async () => {
    const provider = providerOf(() => FAILURE);
    const ledger = newLedger();
    const out = await checkRoomForConflicts(provider, ledger, room, doc, options);
    expect(out).toEqual({ ok: true, value: { status: 'unchecked' } });
    expect(provider.requests).toHaveLength(1);
    expect(ledger.releases).toBe(1);
  });

  it('makes no call when the reservation is refused', async () => {
    const provider = providerOf(() => NO_CONFLICT);
    const ledger = makeMockLedger({ dailyCapUsd: 1000, refuseAfter: 0 });
    const out = await checkRoomForConflicts(provider, ledger, room, doc, options);
    expect(out).toEqual({ ok: false, error: { kind: 'budget-exhausted' } });
    expect(provider.requests).toHaveLength(0);
  });

  it('stops on a refused retry reservation', async () => {
    const provider = providerOf(() => ({ nope: true }));
    const ledger = makeMockLedger({ dailyCapUsd: 1000, refuseAfter: 1 });
    const out = await checkRoomForConflicts(provider, ledger, room, doc, options);
    expect(out).toEqual({ ok: false, error: { kind: 'budget-exhausted' } });
    expect(provider.requests).toHaveLength(1);
  });

  it('reserves nothing and calls nothing when already aborted', async () => {
    const provider = providerOf(() => NO_CONFLICT);
    const ledger = newLedger();
    const out = await checkRoomForConflicts(provider, ledger, room, doc, {
      ...options,
      signal: { aborted: true },
    });
    expect(out).toEqual({ ok: false, error: { kind: 'cancelled' } });
    expect(provider.requests).toHaveLength(0);
    expect(ledger.reservations).toBe(0);
  });

  it('starts no retry after an abort during the first call', async () => {
    const signal = { aborted: false };
    const provider = providerOf(() => {
      signal.aborted = true;
      return { nope: true };
    });
    const ledger = newLedger();
    const out = await checkRoomForConflicts(provider, ledger, room, doc, { ...options, signal });
    expect(out).toEqual({ ok: false, error: { kind: 'cancelled' } });
    expect(provider.requests).toHaveLength(1);
    expect(ledger.reservations).toBe(1);
  });
});

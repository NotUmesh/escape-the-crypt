import { describe, expect, it } from 'vitest';
import { countingProvider, makeMockLedger } from '../budget/mock-ledger';
import type { ProviderRequest } from '../provider/types';
import {
  HEART,
  OPTIONS,
  VALVES,
  chunkIdContaining,
  concept,
  heart,
  ledger,
  ok,
  recordingProvider,
  response,
  rune,
  seance,
} from './generation-fixtures';
import { generateForConcept, type GenerationOptions } from './generation';
import { DEFAULT_ALLOWED_LOCK_TYPES, buildGenerationSystemPrompt } from './generation-prompt';
import { prepareDocument } from './prepare-input';

describe('generateForConcept results', () => {
  it('makes one call and maps a primary and a different-type alternate', async () => {
    const provider = recordingProvider([ok(response(rune(), seance()))]);
    const l = ledger();
    const result = await generateForConcept(provider, l, concept, heart, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) throw new Error('expected a value');
    expect(result.value.primary).toMatchObject({
      id: 'concept-1-primary',
      conceptId: 'concept-1',
      role: 'primary',
      lockType: 'rune-cipher',
    });
    expect(result.value.alternate).toMatchObject({
      id: 'concept-1-alternate',
      role: 'alternate',
      lockType: 'seance-board',
    });
    expect(provider.requests).toHaveLength(1);
    expect(l.reservations).toBe(1);
  });

  it('short-circuits a null primary to Ok(null) after one call', async () => {
    const provider = countingProvider(recordingProvider([ok(response(null, seance()))]));
    const result = await generateForConcept(provider, ledger(), concept, heart, OPTIONS);
    expect(result).toEqual({ ok: true, value: null });
    expect(provider.calls).toBe(1);
  });

  it('makes no call when no lock type is allowed', async () => {
    const provider = countingProvider(recordingProvider([ok(response(rune(), null))]));
    const result = await generateForConcept(provider, ledger(), concept, heart, {
      ...OPTIONS,
      allowedLockTypes: [],
    });
    expect(result).toEqual({ ok: true, value: null });
    expect(provider.calls).toBe(0);
  });

  it('keeps the primary and nulls an alternate that shares its lock type', async () => {
    const provider = recordingProvider([ok(response(rune(), rune()))]);
    const result = await generateForConcept(provider, ledger(), concept, heart, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) throw new Error('expected a value');
    expect(result.value.primary.lockType).toBe('rune-cipher');
    expect(result.value.alternate).toBeNull();
  });

  it('nulls an alternate whose type is not allowed', async () => {
    const provider = recordingProvider([ok(response(rune(), seance()))]);
    const result = await generateForConcept(provider, ledger(), concept, heart, {
      ...OPTIONS,
      allowedLockTypes: ['rune-cipher'],
    });
    expect(result.ok && result.value?.alternate).toBeNull();
    expect(result.ok && result.value?.primary.lockType).toBe('rune-cipher');
  });

  it('nulls an alternate that cites an unassigned chunk ID', async () => {
    const provider = recordingProvider([ok(response(rune(), seance('chunk-nope')))]);
    const result = await generateForConcept(provider, ledger(), concept, heart, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) throw new Error('expected a value');
    expect(result.value.alternate).toBeNull();
  });

  it('returns pipeline-unknown-chunk for a primary citing an unassigned chunk ID, with one call', async () => {
    const provider = recordingProvider([ok(response(rune('chunk-nope'), null))]);
    const l = ledger();
    const result = await generateForConcept(provider, l, concept, heart, OPTIONS);
    expect(result).toEqual({ ok: false, error: { kind: 'pipeline-unknown-chunk', chunkId: 'chunk-nope' } });
    expect(provider.requests).toHaveLength(1);
    expect(l.reservations).toBe(1);
  });

  it('returns lock-type-not-allowed for a séance primary when séance board is excluded (Req 14.9)', async () => {
    const provider = recordingProvider([ok(response(seance(), null))]);
    const result = await generateForConcept(provider, ledger(), concept, heart, {
      ...OPTIONS,
      allowedLockTypes: ['rune-cipher'],
    });
    expect(result).toEqual({ ok: false, error: { kind: 'lock-type-not-allowed' } });
    expect(provider.requests[0]!.system).not.toContain('seance-board');
  });
});

describe('generateForConcept failures and budget', () => {
  const bad = { justification: 'x', primary: { lockType: 'rune-cipher' } };

  it('retries once after a schema failure, with its own reservation and a retry note', async () => {
    const provider = recordingProvider([ok(bad), ok(response(rune(), null))]);
    const l = ledger();
    const result = await generateForConcept(provider, l, concept, heart, OPTIONS);
    expect(result.ok).toBe(true);
    expect(provider.requests).toHaveLength(2);
    expect(l.reservations).toBe(2);
    expect(l.reconciles).toBe(2);
    const [first, second] = provider.requests.map((r) => r.messages[0]!.content);
    expect(second!.startsWith(first!)).toBe(true);
    expect(second!.length).toBeGreaterThan(first!.length);
  });

  it('sets the question aside as schema-rejected after two schema failures, without notes text', async () => {
    const provider = recordingProvider([ok(bad)]);
    const l = ledger();
    const result = await generateForConcept(provider, l, concept, heart, OPTIONS);
    expect(result).toEqual({ ok: false, error: { kind: 'schema-rejected', stage: 'generation' } });
    expect(provider.requests).toHaveLength(2);
    expect(l.reservations).toBe(2);
    expect(JSON.stringify(result)).not.toContain('valve');
  });

  it('makes zero provider calls when the budget refuses', async () => {
    const provider = countingProvider(recordingProvider([ok(response(rune(), null))]));
    const result = await generateForConcept(
      provider,
      makeMockLedger({ dailyCapUsd: 0 }),
      concept,
      heart,
      OPTIONS,
    );
    expect(result).toEqual({ ok: false, error: { kind: 'budget-exhausted' } });
    expect(provider.calls).toBe(0);
  });

  it('reports a provider failure by kind and stage only', async () => {
    const provider = recordingProvider([{ ok: false, error: { kind: 'timeout', retryable: true } }]);
    const result = await generateForConcept(provider, ledger(), concept, heart, OPTIONS);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'provider-failed', stage: 'generation', retryable: true },
    });
  });

  it('carries no notes text in a lock-type or unknown-chunk error', async () => {
    const a = await generateForConcept(
      recordingProvider([ok(response(seance(), null))]),
      ledger(),
      concept,
      heart,
      { ...OPTIONS, allowedLockTypes: ['rune-cipher'] },
    );
    const b = await generateForConcept(
      recordingProvider([ok(response(rune('chunk-nope'), null))]),
      ledger(),
      concept,
      heart,
      OPTIONS,
    );
    expect(JSON.stringify(a)).not.toMatch(/valve|atri/i);
    expect(JSON.stringify(b)).not.toMatch(/valve|atri/i);
  });
});

describe('generation prompt', () => {
  async function requestFor(options: GenerationOptions = OPTIONS): Promise<ProviderRequest> {
    const provider = recordingProvider([ok(response(null, null))]);
    await generateForConcept(provider, ledger(), concept, heart, options);
    return provider.requests[0]!;
  }

  it('states the generated-only-when rules, According to your notes, and no not-mentioned options', async () => {
    const { system } = await requestFor();
    expect(system).toContain('use only when the notes state a term, name or short phrase');
    expect(system).toContain('use only when the notes support exactly one correct option');
    expect(system).toContain('According to your notes');
    expect(system).toMatch(/No negative questions/);
    expect(system).toMatch(/merely "not mentioned"/);
    expect(system).toMatch(/set primary to null/);
  });

  it('asks for 4 to 25 word quotes with chunk IDs and never mentions offsets as something to give', async () => {
    const { system } = await requestFor();
    expect(system).toContain('4 to 25 words');
    expect(system).toContain('chunk ID');
    expect(system).toContain('Never give character offsets');
    expect(system.replace('Never give character offsets', '')).not.toMatch(/offset/i);
  });

  it('offers only the allowed types', async () => {
    const { system } = await requestFor({ ...OPTIONS, allowedLockTypes: ['rune-cipher'] });
    expect(system).toContain('rune-cipher');
    expect(system).not.toContain('seance-board');
    expect(buildGenerationSystemPrompt(DEFAULT_ALLOWED_LOCK_TYPES)).toContain('seance-board');
  });

  it('puts only the concept\'s cited chunks plus heading context in the notes block', async () => {
    const headed = prepareDocument('THE HUMAN HEART\n\n' + HEART);
    const id = chunkIdContaining(headed, VALVES);
    const provider = recordingProvider([ok(response(null, null))]);
    await generateForConcept(provider, ledger(), { ...concept, chunkIds: [id] }, headed, OPTIONS);
    const user = provider.requests[0]!.messages[0]!.content;
    expect(user).toContain(`[chunk ${id}]`);
    expect(user).toContain(VALVES);
    expect(user).not.toContain(`[chunk ${chunkIdContaining(headed, 'natural pacemaker')}]`);
    expect(user).not.toContain('natural pacemaker');
    expect(user).not.toContain('four chambers');
    expect(user).toContain('Headings (context only');
    expect(user).toContain('THE HUMAN HEART');
    expect(user.match(/\[chunk /g)).toHaveLength(1);
  });
});

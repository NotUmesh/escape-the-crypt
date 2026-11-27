import fc from 'fast-check';
import { describe, it } from 'vitest';
import { promptDigest } from './prompt-digest';
import type { ProviderRequest, ProviderStage } from './types';

const RUNS = { numRuns: 200 };

type Message = ProviderRequest['messages'][number];

const keyArb = fc.stringMatching(/^[a-z]{1,6}$/);
const jsonLeafArb = fc.oneof(
  fc.string({ maxLength: 8 }),
  fc.integer({ min: -1000, max: 1000 }),
  fc.boolean(),
  fc.constant(null),
);
const jsonValueArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small', maxDepth: 3 },
    jsonLeafArb,
    fc.array(tie('value'), { maxLength: 3 }),
    fc.dictionary(keyArb, tie('value'), { maxKeys: 3 }),
  ),
})).value;
const schemaArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(keyArb, jsonValueArb, {
  minKeys: 1,
  maxKeys: 4,
});

const messageArb: fc.Arbitrary<Message> = fc.record({
  role: fc.constantFrom<Message['role']>('user', 'assistant'),
  content: fc.string({ maxLength: 20 }),
});
const stageArb = fc.constantFrom<ProviderStage>('concept-extraction', 'generation', 'review');

const requestArb: fc.Arbitrary<ProviderRequest> = fc.record({
  stage: stageArb,
  promptVersion: fc.string({ maxLength: 10 }),
  modelId: fc.string({ maxLength: 10 }),
  system: fc.string({ maxLength: 30 }),
  messages: fc.array(messageArb, { minLength: 1, maxLength: 4 }),
  temperature: fc.double({ min: 0, max: 2, noNaN: true }),
  maxOutputTokens: fc.integer({ min: 1, max: 100000 }),
  jsonSchema: schemaArb,
  timeoutMs: fc.integer({ min: 1, max: 600000 }),
  retryLimit: fc.integer({ min: 0, max: 10 }),
});

/** Rebuilds every object with its keys inserted in reverse order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).reverse()) {
      out[key] = reverseKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

describe('Prompt_Digest (property)', () => {
  // Feature: generation-and-evaluation, Property 18: Prompt_Digest is a canonical function of the semantic request
  // **Validates: Requirements 12.1, 12.3**
  it('is stable across repeated calls and is 64 lowercase hex characters', () => {
    fc.assert(
      fc.property(requestArb, (req) => {
        const a = promptDigest(req);
        return a === promptDigest(req) && /^[0-9a-f]{64}$/.test(a);
      }),
      RUNS,
    );
  });

  // Feature: generation-and-evaluation, Property 18: Prompt_Digest is a canonical function of the semantic request
  // **Validates: Requirements 12.1, 12.3**
  it('is invariant under object key reordering, including nested jsonSchema keys', () => {
    fc.assert(
      fc.property(requestArb, (req) => {
        const reordered = reverseKeys(req) as ProviderRequest;
        return promptDigest(req) === promptDigest(reordered);
      }),
      RUNS,
    );
  });

  // Feature: generation-and-evaluation, Property 18: Prompt_Digest is a canonical function of the semantic request
  // **Validates: Requirements 12.1, 12.3**
  it('is invariant to timeoutMs and retryLimit', () => {
    fc.assert(
      fc.property(
        requestArb,
        fc.integer({ min: 1, max: 600000 }),
        fc.integer({ min: 0, max: 10 }),
        (req, timeoutMs, retryLimit) =>
          promptDigest(req) === promptDigest({ ...req, timeoutMs, retryLimit }),
      ),
      RUNS,
    );
  });

  // Feature: generation-and-evaluation, Property 18: Prompt_Digest is a canonical function of the semantic request
  // **Validates: Requirements 12.1, 12.3**
  describe('changing any one hashed field changes the digest', () => {
    const differs = (name: string, mutate: (req: ProviderRequest) => ProviderRequest) => {
      it(name, () => {
        fc.assert(
          fc.property(requestArb, (req) => promptDigest(req) !== promptDigest(mutate(req))),
          RUNS,
        );
      });
    };

    differs('system', (r) => ({ ...r, system: `${r.system}x` }));
    differs('modelId', (r) => ({ ...r, modelId: `${r.modelId}x` }));
    differs('promptVersion', (r) => ({ ...r, promptVersion: `${r.promptVersion}x` }));
    differs('temperature', (r) => ({ ...r, temperature: r.temperature + 1 }));
    differs('maxOutputTokens', (r) => ({ ...r, maxOutputTokens: r.maxOutputTokens + 1 }));
    differs('stage', (r) => ({
      ...r,
      stage: r.stage === 'generation' ? 'review' : 'generation',
    }));
    differs('jsonSchema (added key)', (r) => ({
      ...r,
      jsonSchema: { ...r.jsonSchema, $extra: 1 },
    }));
    differs('jsonSchema (existing value replaced)', (r) => {
      const firstKey = Object.keys(r.jsonSchema)[0] as string;
      return { ...r, jsonSchema: { ...r.jsonSchema, [firstKey]: { replaced: [r.jsonSchema[firstKey]] } } };
    });

    it('any message content', () => {
      fc.assert(
        fc.property(requestArb, fc.nat(), (req, i) => {
          const idx = i % req.messages.length;
          const messages = req.messages.map((m, j) =>
            j === idx ? { ...m, content: `${m.content}x` } : m,
          );
          return promptDigest(req) !== promptDigest({ ...req, messages });
        }),
        RUNS,
      );
    });

    it('any message role', () => {
      fc.assert(
        fc.property(requestArb, fc.nat(), (req, i) => {
          const idx = i % req.messages.length;
          const messages = req.messages.map((m, j) =>
            j === idx ? { ...m, role: m.role === 'user' ? ('assistant' as const) : ('user' as const) } : m,
          );
          return promptDigest(req) !== promptDigest({ ...req, messages });
        }),
        RUNS,
      );
    });

    it('message order', () => {
      fc.assert(
        fc.property(
          requestArb,
          fc.tuple(messageArb, messageArb).filter(([a, b]) => a.role !== b.role || a.content !== b.content),
          (req, [a, b]) =>
            promptDigest({ ...req, messages: [a, b] }) !==
            promptDigest({ ...req, messages: [b, a] }),
        ),
        RUNS,
      );
    });
  });
});

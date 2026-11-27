import {
  countingProvider,
  makeMockLedger,
  type CountingProvider,
  type MockLedger,
  type Provider,
  type ProviderRequest,
} from '@escape-the-crypt/core';
import {
  createJobStore,
  requestDigest,
  type CreateJobInput,
  type CreateJobResult,
  type JobStore,
  type JobStoreConfig,
} from './job-store';

export const TOKEN_A = 'token-a-SECRET-0123456789abcdef0123456789abcdef';
export const TOKEN_B = 'token-b-SECRET-fedcba9876543210fedcba9876543210';
export const KEY_1 = 'idem-key-ONE-aaaaaaaaaaaaaaaa';
export const KEY_2 = 'idem-key-TWO-bbbbbbbbbbbbbbbb';
export const NOTES = 'NOTES-TEXT-the-mitochondria-is-the-powerhouse';
export const DIGEST_1 = requestDigest({ notes: 'one' });
export const DIGEST_2 = requestDigest({ notes: 'two' });

export interface Harness {
  readonly store: JobStore;
  readonly clock: { t: number };
}

export function makeStore(config: Partial<JobStoreConfig> = {}): Harness {
  const clock = { t: 1_000_000 };
  let n = 0;
  const store = createJobStore({
    now: () => clock.t,
    newId: () => {
      n += 1;
      return `job-${n}`;
    },
    ...config,
  });
  return { store, clock };
}

export function input(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    sessionToken: TOKEN_A,
    idempotencyKey: KEY_1,
    requestDigest: DIGEST_1,
    notesText: NOTES,
    ...overrides,
  };
}

const REQUEST: ProviderRequest = {
  stage: 'generation',
  promptVersion: 'test',
  modelId: 'test',
  system: '',
  messages: [{ role: 'user', content: 'x' }],
  temperature: 0,
  maxOutputTokens: 1,
  jsonSchema: {},
  timeoutMs: 1,
  retryLimit: 0,
};

export interface Spend {
  readonly ledger: MockLedger;
  readonly provider: CountingProvider;
  /**
   * Mirrors the HTTP layer's required order: `create` first, then reserve and call the Provider
   * only for a `new` job. (Core's `callWithBudget` is not exported from the package index, so this
   * does what it does: reserve, then one `complete`.)
   */
  startJob(store: JobStore, jobInput: CreateJobInput): Promise<CreateJobResult>;
}

export function makeSpend(): Spend {
  const ledger = makeMockLedger({ dailyCapUsd: 1 });
  const inner: Provider = {
    complete: async () => ({ ok: true, json: {}, usage: { inputTokens: 1, outputTokens: 1 } }),
  };
  const provider = countingProvider(inner);
  return {
    ledger,
    provider,
    async startJob(store, jobInput) {
      const created = store.create(jobInput);
      if (created.kind === 'new') {
        const reserved = await ledger.reserve(0.01);
        if (reserved.ok) await provider.complete(REQUEST);
      }
      return created;
    },
  };
}

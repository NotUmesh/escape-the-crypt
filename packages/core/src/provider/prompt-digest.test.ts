import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { promptDigest } from './prompt-digest.js';
import type { ProviderRequest } from './types.js';

// REGRESSION ANCHOR. Changing EXPECTED_DIGEST (or the canonical JSON below) invalidates every
// recorded cassette, because cassettes are looked up by prompt digest. Only change it
// deliberately, and re-record all cassettes in the same change.

const FIXED_REQUEST: ProviderRequest = {
  stage: 'generation',
  promptVersion: 'v1',
  modelId: 'fixture-model',
  system: 'Fixed system.',
  messages: [{ role: 'user', content: 'Fixed message.' }],
  temperature: 0,
  maxOutputTokens: 512,
  jsonSchema: {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
  },
  // Excluded from the digest.
  timeoutMs: 1000,
  retryLimit: 2,
};

// Written by hand: keys sorted, no whitespace.
const EXPECTED_CANONICAL =
  '{"jsonSchema":{"properties":{"answer":{"type":"string"}},"required":["answer"],"type":"object"},' +
  '"maxOutputTokens":512,"messages":[{"content":"Fixed message.","role":"user"}],' +
  '"modelId":"fixture-model","promptVersion":"v1","stage":"generation","system":"Fixed system.",' +
  '"temperature":0}';

const EXPECTED_DIGEST = '8a2bea4d648f3d34a38be3c18425d9feaaf59c83f887efb9e5f114718cb9421f';

describe('promptDigest regression anchor', () => {
  it('hand-written canonical JSON hashes to the pinned digest', () => {
    expect(bytesToHex(sha256(utf8ToBytes(EXPECTED_CANONICAL)))).toBe(EXPECTED_DIGEST);
  });

  it('promptDigest of the fixed request equals the pinned digest', () => {
    expect(promptDigest(FIXED_REQUEST)).toBe(EXPECTED_DIGEST);
  });
});

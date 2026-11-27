import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { ProviderRequest } from './types.js';

const MAX_DEPTH = 64;

/**
 * Canonical JSON: object keys sorted (UTF-16 code-unit order) recursively, array order
 * preserved, no whitespace.
 *
 * Pinned edge cases (they match `JSON.stringify` where it is defined):
 * - `undefined`, functions and symbols: the key is omitted in an object, `null` in an array.
 * - Non-finite numbers (`NaN`, `Infinity`, `-Infinity`): `null`. `-0` becomes `0`.
 * - `bigint`: `null`.
 * - Nesting deeper than 64 levels (e.g. a cycle): `null`, so the function never throws.
 */
function canonicalJson(value: unknown, depth: number): string {
  if (depth > MAX_DEPTH) return 'null';
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    case 'object': {
      if (Array.isArray(value)) {
        const items = (value as readonly unknown[]).map((item) =>
          isOmitted(item) ? 'null' : canonicalJson(item, depth + 1),
        );
        return `[${items.join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const child = record[key];
        if (isOmitted(child)) continue;
        parts.push(`${JSON.stringify(key)}:${canonicalJson(child, depth + 1)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      return 'null';
  }
}

function isOmitted(value: unknown): boolean {
  return (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  );
}

/**
 * SHA-256 (lowercase hex) of the canonical JSON of
 * `{ stage, promptVersion, modelId, system, messages, temperature, maxOutputTokens, jsonSchema }`.
 * `system` is included because it carries the template rules and the data-delimiter line, so a
 * changed prompt template changes the digest.
 * `timeoutMs` and `retryLimit` are excluded: they change how a call runs, not what is asked.
 * See `canonicalJson` for how `undefined` and non-finite numbers are handled.
 */
export function promptDigest(request: ProviderRequest): string {
  const {
    stage,
    promptVersion,
    modelId,
    system,
    messages,
    temperature,
    maxOutputTokens,
    jsonSchema,
  } = request;
  const canonical = canonicalJson(
    { stage, promptVersion, modelId, system, messages, temperature, maxOutputTokens, jsonSchema },
    0,
  );
  return bytesToHex(sha256(utf8ToBytes(canonical)));
}

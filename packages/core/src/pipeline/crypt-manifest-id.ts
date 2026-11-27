import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** JSON with object keys sorted, so equal content always serialises to the same string. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`);
  return `{${parts.join(',')}}`;
}

/**
 * A manifest ID that follows the crypt's content: `<base>-<8 hex of a SHA-256 over the rooms and
 * content>`. The same content always gives the same ID, so saving it twice is a no-op. A different
 * crypt from the same notes (another length, another generation) gets its own ID instead of
 * colliding with the saved one. The base keeps the link to the notes.
 */
export function contentManifestId(base: string, rooms: unknown, content: unknown): string {
  const hash = bytesToHex(sha256(utf8ToBytes(stableJson({ rooms, content }))));
  return `${base}-${hash.slice(0, 8)}`;
}

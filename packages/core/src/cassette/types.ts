import { z } from '../zod.js';
import type { Result } from '../types.js';
import type { ProviderSuccess } from '../provider/types.js';

export type CassetteOrigin = 'synthetic' | 'recorded';

export interface CassetteEntry {
  readonly digest: string;
  readonly origin: CassetteOrigin;
  readonly response: ProviderSuccess;
}

export interface CassetteFile {
  /** CHECK_VERSION at record time, a human-readable staleness signal. */
  readonly checkVersion: string;
  readonly entries: readonly CassetteEntry[];
}

/** Cassette-only error kind. Deliberately not part of the shared `ProviderErrorKind` union. */
export type CassetteProviderErrorKind = 'cassette-missing';

export type CassetteParseError = { readonly kind: 'cassette-invalid' };

const entrySchema = z.strictObject({
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  origin: z.enum(['synthetic', 'recorded']),
  response: z.strictObject({
    ok: z.literal(true),
    json: z.unknown(),
    usage: z.strictObject({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    }),
  }),
});

export const cassetteFileSchema = z.strictObject({
  checkVersion: z.string(),
  entries: z.array(entrySchema),
});

/** Validates untrusted, already-parsed JSON. Core does no file I/O; the caller reads the file. */
export function parseCassetteFile(raw: unknown): Result<CassetteFile, CassetteParseError> {
  const parsed = cassetteFileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: { kind: 'cassette-invalid' } };
  return { ok: true, value: parsed.data as CassetteFile };
}

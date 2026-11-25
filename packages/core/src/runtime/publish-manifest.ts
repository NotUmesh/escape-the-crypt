import type { Result } from '../types';
import { manifestCheck } from './manifest-check';
import type { InvalidManifestError } from './manifest-check';
import { parseManifest } from './manifest-schema';
import type { ManifestSchemaError } from './manifest-schema';
import type { CryptManifest } from './manifest-types';

/** Either the schema rejected the input, or `manifestCheck` rejected a schema-valid manifest. */
export type PublishManifestError = ManifestSchemaError | InvalidManifestError;

/**
 * Gate for publishing a manifest: schema parse first, then `manifestCheck`.
 * Only a manifest that passes both is returned. Pure; never throws.
 * Distinguish failures by `error.kind`: `'manifest-schema-invalid'` or `'invalid-manifest'`.
 */
export function validateManifestForPublish(raw: unknown): Result<CryptManifest, PublishManifestError> {
  const parsed = parseManifest(raw);
  if (!parsed.ok) return parsed;
  const checked = manifestCheck(parsed.value);
  if (!checked.ok) return { ok: false, error: checked.error };
  return { ok: true, value: parsed.value };
}

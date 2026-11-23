import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** Separator between paste paragraphs in the digest input. */
export const PASTE_UNIT_SEPARATOR = '\n\n';
/** Separator between PDF pages in the digest input (a form feed). */
export const PDF_UNIT_SEPARATOR = '\f';

/**
 * SHA-256 (lowercase hex) of the confirmed text. The units' texts are joined
 * by `\n\n` for paste and `\f` for PDF, so identical text on different pages
 * gives a different digest.
 */
export function documentDigest(
  units: readonly string[],
  sourceType: 'paste' | 'pdf',
): string {
  const separator =
    sourceType === 'pdf' ? PDF_UNIT_SEPARATOR : PASTE_UNIT_SEPARATOR;
  return bytesToHex(sha256(utf8ToBytes(units.join(separator))));
}

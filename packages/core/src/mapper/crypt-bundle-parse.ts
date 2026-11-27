import { z } from '../zod';
import type { Result } from '../types';
import { validateManifestForPublish } from '../runtime/publish-manifest';
import type { PublishManifestError } from '../runtime/publish-manifest';
import type { CryptManifest } from '../runtime/manifest-types';
import { CryptContentSchema } from './crypt-content';
import type { CryptContent } from './crypt-content';

/** A Crypt_Bundle as the web app plays it (generation-and-evaluation Requirement 31). */
export interface CryptBundle {
  readonly manifest: CryptManifest;
  readonly content: CryptContent;
}

/**
 * Why a bundle was rejected. Kinds, IDs and schema paths only: never notes text,
 * question text or model output.
 */
export type CryptBundleError =
  | { readonly kind: 'bundle-shape-invalid' }
  | PublishManifestError
  | {
      readonly kind: 'bundle-content-invalid';
      readonly paths: readonly (readonly (string | number)[])[];
    }
  | { readonly kind: 'bundle-content-missing'; readonly questionId: string }
  | { readonly kind: 'bundle-concept-missing'; readonly conceptId: string };

const BundleShapeSchema = z.object({ manifest: z.unknown(), content: z.unknown() });

function manifestQuestionIds(manifest: CryptManifest): string[] {
  const ids: string[] = [];
  for (const room of manifest.rooms) {
    for (const slot of room.lockSlots) {
      ids.push(slot.primaryQuestion.questionId);
      if (slot.alternateQuestion !== null) ids.push(slot.alternateQuestion.questionId);
    }
  }
  for (const slot of manifest.finalDoor.slots) ids.push(slot.question.questionId);
  return ids;
}

function manifestConceptIds(manifest: CryptManifest): string[] {
  const ids = new Set<string>();
  for (const room of manifest.rooms) for (const slot of room.lockSlots) ids.add(slot.conceptId);
  for (const slot of manifest.finalDoor.slots) ids.add(slot.conceptId);
  return [...ids];
}

/**
 * Validates an untrusted Crypt_Bundle: the manifest through `validateManifestForPublish`,
 * the content through `CryptContentSchema`, then checks that every manifest question has a
 * content entry and every manifest concept has a title. Extra top-level keys are ignored.
 * Pure; never throws.
 */
export function parseCryptBundle(raw: unknown): Result<CryptBundle, CryptBundleError> {
  const shape = BundleShapeSchema.safeParse(raw);
  if (!shape.success) return { ok: false, error: { kind: 'bundle-shape-invalid' } };

  const manifest = validateManifestForPublish(shape.data.manifest);
  if (!manifest.ok) return manifest;

  const content = CryptContentSchema.safeParse(shape.data.content);
  if (!content.success) {
    return {
      ok: false,
      error: {
        kind: 'bundle-content-invalid',
        paths: content.error.issues.map((issue) =>
          issue.path.map((p) => (typeof p === 'number' ? p : String(p))),
        ),
      },
    };
  }

  for (const questionId of manifestQuestionIds(manifest.value)) {
    if (!Object.hasOwn(content.data.questions, questionId)) {
      return { ok: false, error: { kind: 'bundle-content-missing', questionId } };
    }
  }
  for (const conceptId of manifestConceptIds(manifest.value)) {
    if (!Object.hasOwn(content.data.concepts, conceptId)) {
      return { ok: false, error: { kind: 'bundle-concept-missing', conceptId } };
    }
  }

  return { ok: true, value: { manifest: manifest.value, content: content.data } };
}

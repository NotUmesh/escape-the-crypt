import { z } from '../zod';
import { LOCK_TYPES } from '../types';
import type { LockType, Result } from '../types';
import { narrowHint } from './manifest-hints';
import type { CryptManifest } from './manifest-types';

export { narrowHint } from './manifest-hints';

export const HintEffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('remove-option'), optionId: z.string() }),
  z.strictObject({ kind: z.literal('lock-first-bone'), boneId: z.string() }),
  z.strictObject({ kind: z.literal('tie-thread'), pair: z.tuple([z.string(), z.string()]) }),
  z.strictObject({ kind: z.literal('reveal-digit'), position: z.number().int().nonnegative() }),
  z.strictObject({
    kind: z.literal('reveal-first-letter'),
    firstLetter: z.string().length(1),
    length: z.number().int().positive(),
  }),
]);

/** Mirrors `RuneCipherQuestion` in `locks/rune-cipher.ts`. */
export const RuneCipherPayloadSchema = z.strictObject({
  answer: z.string().min(1),
  aliases: z.array(z.string()),
  caseSensitive: z.boolean(),
});

/** Mirrors `SeanceBoardQuestion` in `locks/seance-board.ts`. */
export const SeanceBoardPayloadSchema = z
  .strictObject({
    optionIds: z.array(z.string().min(1)).min(3).max(4),
    keyOptionId: z.string().min(1),
  })
  .refine((v) => v.optionIds.includes(v.keyOptionId), {
    message: 'keyOptionId must be one of optionIds',
  });

/** Mirrors `BoneOrderingQuestion` in `locks/bone-ordering.ts`; `keyOrder` is a permutation of `itemIds`. */
export const BoneOrderingPayloadSchema = z
  .strictObject({
    itemIds: z.array(z.string().min(1)).min(3).max(5),
    keyOrder: z.array(z.string().min(1)).min(3).max(5),
  })
  .refine(
    (v) =>
      new Set(v.itemIds).size === v.itemIds.length &&
      v.keyOrder.length === v.itemIds.length &&
      new Set(v.keyOrder).size === v.keyOrder.length &&
      v.keyOrder.every((id) => v.itemIds.includes(id)),
    { message: 'keyOrder must be a permutation of itemIds' },
  );

/**
 * Mirrors `BoundThreadsQuestion` in `locks/bound-threads.ts`; `keyPairs` tie each left ID and
 * each right ID exactly once.
 */
export const BoundThreadsPayloadSchema = z
  .strictObject({
    leftIds: z.array(z.string().min(1)).min(3).max(4),
    rightIds: z.array(z.string().min(1)).min(3).max(4),
    keyPairs: z.array(z.tuple([z.string().min(1), z.string().min(1)])).min(3).max(4),
  })
  .refine(
    (v) =>
      new Set(v.leftIds).size === v.leftIds.length &&
      new Set(v.rightIds).size === v.rightIds.length &&
      v.rightIds.length === v.leftIds.length &&
      v.keyPairs.length === v.leftIds.length &&
      new Set(v.keyPairs.map((p) => p[0])).size === v.keyPairs.length &&
      new Set(v.keyPairs.map((p) => p[1])).size === v.keyPairs.length &&
      v.keyPairs.every((p) => v.leftIds.includes(p[0]) && v.rightIds.includes(p[1])),
    { message: 'keyPairs must tie every left ID and every right ID exactly once' },
  );

/** Mirrors `CursedObjectQuestion` in `locks/cursed-object.ts`. */
export const CursedObjectPayloadSchema = z
  .strictObject({
    optionIds: z.array(z.string().min(1)).length(4),
    oddOneOutId: z.string().min(1),
  })
  .refine((v) => new Set(v.optionIds).size === v.optionIds.length, {
    message: 'optionIds must be unique',
  })
  .refine((v) => v.optionIds.includes(v.oddOneOutId), {
    message: 'oddOneOutId must be one of optionIds',
  });

/** Returns `null` for lock types with no payload schema yet; the manifest rejects them. */
export function payloadSchemaFor(
  lockType: LockType,
):
  | typeof RuneCipherPayloadSchema
  | typeof SeanceBoardPayloadSchema
  | typeof BoneOrderingPayloadSchema
  | typeof BoundThreadsPayloadSchema
  | typeof CursedObjectPayloadSchema
  | null {
  switch (lockType) {
    case 'rune-cipher':
      return RuneCipherPayloadSchema;
    case 'seance-board':
      return SeanceBoardPayloadSchema;
    case 'bone-ordering':
      return BoneOrderingPayloadSchema;
    case 'bound-threads':
      return BoundThreadsPayloadSchema;
    case 'cursed-object':
      return CursedObjectPayloadSchema;
    default:
      return null;
  }
}

export const QuestionSpecSchema = z
  .strictObject({
    questionId: z.string().min(1),
    lockType: z.enum(LOCK_TYPES),
    payload: z.unknown(),
    evidenceRefs: z.array(z.string().min(1)).min(1),
    hintEffect: HintEffectSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    const schema = payloadSchemaFor(value.lockType);
    if (schema === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['payload'],
        message: `lock-type-not-supported: ${value.lockType}`,
      });
      return;
    }
    const result = schema.safeParse(value.payload);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', path: ['payload', ...issue.path], message: issue.message });
      }
      return;
    }
    narrowHint(value.lockType, result.data, value.hintEffect, ctx);
  });

export const LockSlotSpecSchema = z
  .strictObject({
    slotId: z.string().min(1),
    stationType: z.enum(LOCK_TYPES),
    conceptId: z.string().min(1),
    primaryQuestion: QuestionSpecSchema,
    alternateQuestion: QuestionSpecSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.primaryQuestion.lockType !== v.stationType) {
      ctx.addIssue({
        code: 'custom',
        path: ['primaryQuestion', 'lockType'],
        message: 'primaryQuestion lockType must equal stationType',
      });
    }
    if (v.alternateQuestion !== null && v.alternateQuestion.lockType === v.primaryQuestion.lockType) {
      ctx.addIssue({
        code: 'custom',
        path: ['alternateQuestion', 'lockType'],
        message: 'alternateQuestion must have a different lockType from primaryQuestion',
      });
    }
  });

export const RoomSpecSchema = z
  .strictObject({
    roomId: z.string().min(1),
    lockSlots: z.array(LockSlotSpecSchema),
  })
  .refine((v) => new Set(v.lockSlots.map((s) => s.stationType)).size === v.lockSlots.length, {
    message: 'at most one lock slot per lock type per room',
  });

export const FinalDoorSlotSpecSchema = z.strictObject({
  slotId: z.string().min(1),
  conceptId: z.string().min(1),
  question: QuestionSpecSchema,
});

export const CryptManifestSchema = z
  .strictObject({
    manifestId: z.string().min(1),
    rooms: z.array(RoomSpecSchema),
    finalDoor: z.strictObject({ slots: z.array(FinalDoorSlotSpecSchema).min(0).max(4) }),
  })
  .superRefine((manifest, ctx) => {
    const ids = new Set<string>();
    const note = (id: string): void => {
      if (ids.has(id)) {
        ctx.addIssue({ code: 'custom', path: ['questionId'], message: `duplicate questionId: ${id}` });
      }
      ids.add(id);
    };
    for (const room of manifest.rooms) {
      for (const slot of room.lockSlots) {
        note(slot.primaryQuestion.questionId);
        if (slot.alternateQuestion !== null) note(slot.alternateQuestion.questionId);
      }
    }
    for (const slot of manifest.finalDoor.slots) note(slot.question.questionId);
  });

export interface ManifestSchemaError {
  readonly kind: 'manifest-schema-invalid';
  readonly issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[];
}

/** Parses untrusted JSON into a `CryptManifest`. Never throws. */
export function parseManifest(raw: unknown): Result<CryptManifest, ManifestSchemaError> {
  try {
    const parsed = CryptManifestSchema.safeParse(raw);
    if (parsed.success) return { ok: true, value: parsed.data as CryptManifest };
    return {
      ok: false,
      error: {
        kind: 'manifest-schema-invalid',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.filter((p): p is string | number => typeof p !== 'symbol'),
          message: i.message,
        })),
      },
    };
  } catch {
    return {
      ok: false,
      error: { kind: 'manifest-schema-invalid', issues: [{ path: [], message: 'unparseable input' }] },
    };
  }
}

import { z } from '@escape-the-crypt/core';
import type { LockType } from '@escape-the-crypt/core';

// Mirrors docs/art/asset-contract.md section 4 (Requirements 7.3, 23.3).
// Positions are fractions (0 to 1) of the frame, measured from the top-left.

// Compile-time check: this tuple must name every LockType and nothing else.
const SCENE_LOCK_TYPES = [
  'rune-cipher',
  'seance-board',
  'bone-ordering',
  'bound-threads',
  'cursed-object',
  'combination-dial',
] as const satisfies readonly LockType[];
type MissingLockType = Exclude<LockType, (typeof SCENE_LOCK_TYPES)[number]>;
const lockTypesComplete: [MissingLockType] extends [never] ? true : never = true;
void lockTypesComplete;

const fraction = z.number().min(0).max(1);
const pointSchema = z.tuple([fraction, fraction]);
const polygonSchema = z.array(pointSchema).min(3);
const anchorSchema = z.object({ x: fraction, y: fraction });
const candleSchema = z.object({ x: fraction, y: fraction, scale: z.number().positive() });

export const LockSceneEntrySchema = z.object({
  depth: z.number().nonnegative(),
  hotspot: polygonSchema,
  candle: candleSchema,
  panelSide: z.enum(['left', 'right']),
});

const SceneBlockSchema = z.object({
  size: z.tuple([z.number().positive(), z.number().positive()]),
  layers: z.array(z.string()),
  parallax: z.object({
    background: z.number(),
    locks: z.number(),
    door: z.number().optional(),
    foreground: z.number(),
  }),
  // Only the lock types the room draws need an entry.
  locks: z.partialRecord(z.enum(SCENE_LOCK_TYPES), LockSceneEntrySchema),
  notes: z.string().optional(),
  ambientCandles: z.array(candleSchema),
  ghostAnchors: z.array(anchorSchema),
  door: z.object({ hotspot: polygonSchema }),
});

export const SceneFileSchema = z.object({
  room: z.string().min(1),
  version: z.number().int(),
  desktop: SceneBlockSchema,
  mobile: SceneBlockSchema.optional(),
});

export type LockSceneEntry = z.infer<typeof LockSceneEntrySchema>;
export type SceneBlock = z.infer<typeof SceneBlockSchema>;
export type SceneFile = z.infer<typeof SceneFileSchema>;

export type SceneFileError =
  | { readonly kind: 'network' }
  | { readonly kind: 'http'; readonly status: number }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'invalid'; readonly paths: readonly string[] };

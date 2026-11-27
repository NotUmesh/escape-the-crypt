import { z } from '@escape-the-crypt/core';
import type { RunSettings } from '@escape-the-crypt/core';

/** Zod schema for core's `RunSettings` type. The `satisfies` check fails to compile if the type drifts. */
export const RunSettingsSchema = z
  .object({
    length: z.enum(['short', 'standard', 'long']),
    difficulty: z.enum(['apprentice', 'gravedigger', 'lich']),
    hintAllowance: z.number().int().min(0),
  })
  .strict() satisfies z.ZodType<RunSettings>;

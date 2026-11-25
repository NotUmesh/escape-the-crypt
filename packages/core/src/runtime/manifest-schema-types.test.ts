import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { CryptManifestSchema } from './manifest-schema';
import type { CryptManifest } from './manifest-types';

/** Zod infers mutable arrays and tuples; `CryptManifest` is readonly. Normalise the inferred side only. */
type DeepReadonly<T> = T extends readonly (infer U)[]
  ? T extends readonly [unknown, ...unknown[]]
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

type Inferred = DeepReadonly<z.infer<typeof CryptManifestSchema>>;

/** Resolves to `true` only when both directions are assignable; otherwise `never`, which fails the build. */
type TwoWay<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// Compile-time check (Req 2.1): the build fails if the schema and `CryptManifest` diverge.
export const manifestTypesAgree: TwoWay<Inferred, CryptManifest> = true;

describe('CryptManifestSchema types', () => {
  it('keeps the schema and CryptManifest assignable in both directions', () => {
    expect(manifestTypesAgree).toBe(true);
  });
});

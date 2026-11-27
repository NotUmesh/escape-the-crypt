import { describe, expect, it } from 'vitest';
import { z } from '../zod.js';
import { toModelJsonSchema } from './model-json-schema.js';

describe('toModelJsonSchema', () => {
  it('describes a strict object with a nullable field', () => {
    const result = toModelJsonSchema(
      z.strictObject({ answer: z.string(), note: z.string().nullable() }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const schema = result.value as {
      type: string;
      additionalProperties: unknown;
      required: string[];
      properties: Record<string, { type?: unknown }>;
      $schema?: unknown;
    };
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(['answer', 'note']);
    expect(schema.properties['note']?.type).toEqual(['string', 'null']);
    expect(schema.$schema).toBeUndefined();
  });

  it('returns a typed error instead of throwing for unrepresentable types', () => {
    const result = toModelJsonSchema(z.strictObject({ at: z.date() }));
    expect(result).toEqual({ ok: false, error: { kind: 'schema-not-representable' } });
  });
});

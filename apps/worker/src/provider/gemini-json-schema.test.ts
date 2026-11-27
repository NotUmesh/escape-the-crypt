import { describe, expect, it } from 'vitest';
import { toGeminiJsonSchema } from './gemini-json-schema';

describe('toGeminiJsonSchema', () => {
  it('turns const into a one-value enum, keeping the type', () => {
    expect(toGeminiJsonSchema({ type: 'string', const: 'seance-board' })).toEqual({ type: 'string', enum: ['seance-board'] });
  });

  it('leaves an existing enum alone when const is also present', () => {
    expect(toGeminiJsonSchema({ type: 'string', const: 'a', enum: ['a'] })).toEqual({ type: 'string', enum: ['a'] });
  });

  it('turns integer exclusive bounds into the equivalent inclusive bounds, keeping the tighter one', () => {
    expect(toGeminiJsonSchema({ type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 })).toEqual({ type: 'integer', minimum: 1, maximum: 9007199254740991 });
    expect(toGeminiJsonSchema({ type: 'integer', exclusiveMinimum: 2.5, exclusiveMaximum: 10 })).toEqual({ type: 'integer', minimum: 3, maximum: 9 });
    expect(toGeminiJsonSchema({ type: 'integer', minimum: 5, exclusiveMinimum: 0 })).toEqual({ type: 'integer', minimum: 5 });
    expect(toGeminiJsonSchema({ type: 'integer', maximum: 3, exclusiveMaximum: 10 })).toEqual({ type: 'integer', maximum: 3 });
  });

  it('leaves out an exclusive bound on a non-integer number (no exact equivalent; Zod still checks it)', () => {
    expect(toGeminiJsonSchema({ type: 'number', exclusiveMinimum: 0, maximum: 1 })).toEqual({ type: 'number', maximum: 1 });
  });

  it('recurses through properties, items, anyOf and additionalProperties without touching property names', () => {
    const input = {
      type: 'object',
      properties: {
        const: { type: 'string', const: 'x' },
        list: { type: 'array', items: { anyOf: [{ type: 'string', const: 'a' }, { type: 'null' }] }, minItems: 1, maxItems: 4 },
      },
      required: ['const', 'list'],
      additionalProperties: false,
    };
    expect(toGeminiJsonSchema(input)).toEqual({
      type: 'object',
      properties: {
        const: { type: 'string', enum: ['x'] },
        list: { type: 'array', items: { anyOf: [{ type: 'string', enum: ['a'] }, { type: 'null' }] }, minItems: 1, maxItems: 4 },
      },
      required: ['const', 'list'],
      additionalProperties: false,
    });
  });

  it('keeps the strict shape and does not mutate its input', () => {
    const input = { type: 'object', properties: { a: { type: 'string', minLength: 1 } }, required: ['a'], additionalProperties: false };
    const before = JSON.stringify(input);
    const out = toGeminiJsonSchema(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

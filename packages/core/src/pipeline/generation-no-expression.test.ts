import { describe, expect, it } from 'vitest';
import { toModelJsonSchema } from '../provider/model-json-schema';
import { GenerationResponseSchema } from './generation-schema';

describe('no executable-expression field', () => {
  const FORBIDDEN = /^(expression|code|formula|eval)$/i;

  function walk(node: unknown, visit: (key: string, value: unknown) => void): void {
    if (Array.isArray(node)) {
      for (const n of node) walk(n, visit);
    } else if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        visit(k, v);
        walk(v, visit);
      }
    }
  }

  it('has no such key or function type in the JSON schema', () => {
    const schema = toModelJsonSchema(GenerationResponseSchema);
    if (!schema.ok) throw new Error('schema not representable');
    const keys: string[] = [];
    const types: unknown[] = [];
    walk(schema.value, (k, v) => {
      if (k === 'properties' && v !== null && typeof v === 'object') keys.push(...Object.keys(v));
      if (k === 'type') types.push(v);
    });
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.filter((k) => FORBIDDEN.test(k))).toEqual([]);
    expect(types.filter((t) => t === 'function')).toEqual([]);
  });

  it('has no such key in any Zod object shape', () => {
    const names: string[] = [];
    const seen = new Set<unknown>();
    const visit = (schema: unknown): void => {
      if (schema === null || typeof schema !== 'object' || seen.has(schema)) return;
      seen.add(schema);
      const def = (schema as { def?: Record<string, unknown>; _def?: Record<string, unknown> });
      const d = def.def ?? def._def ?? {};
      const shape = typeof d.shape === 'function' ? (d.shape as () => unknown)() : d.shape;
      if (shape && typeof shape === 'object') {
        for (const [k, v] of Object.entries(shape)) {
          names.push(k);
          visit(v);
        }
      }
      for (const key of ['options', 'element', 'innerType']) {
        const child = d[key];
        if (Array.isArray(child)) child.forEach(visit);
        else visit(child);
      }
      if (d.type === 'function') names.push('function');
    };
    visit(GenerationResponseSchema);
    expect(names).toContain('primary');
    expect(names).toContain('evidence');
    expect(names.filter((k) => FORBIDDEN.test(k) || k === 'function')).toEqual([]);
  });
});

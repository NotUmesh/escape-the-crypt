import { describe, expect, it } from 'vitest';
import { z } from '../zod.js';
import { ConceptExtractionResponseSchema } from '../pipeline/concept-extraction-prompt.js';
import { GenerationResponseSchema } from '../pipeline/generation-schema.js';
import { ReviewResponseSchema } from '../pipeline/blind-review-prompt.js';
import { toModelJsonSchema } from './model-json-schema.js';

type Node = Record<string, unknown>;

interface WalkResult {
  readonly violations: string[];
  readonly objectCount: number;
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Walks a JSON Schema structurally and reports every strict-mode violation with its path. */
function checkStrict(root: Node): WalkResult {
  const violations: string[] = [];
  let objectCount = 0;

  const resolveRef = (ref: string): unknown => {
    const match = /^#\/(\$defs|definitions)\/(.+)$/.exec(ref);
    if (!match) return undefined;
    const container = root[match[1] as string];
    return isNode(container) ? container[match[2] as string] : undefined;
  };

  const visit = (node: unknown, path: string): void => {
    if (!isNode(node)) return;

    if (typeof node['$ref'] === 'string' && resolveRef(node['$ref']) === undefined) {
      violations.push(`${path}: unresolved $ref ${node['$ref']}`);
    }

    const type = node['type'];
    const isObjectType = type === 'object' || (Array.isArray(type) && type.includes('object'));
    const properties = node['properties'];
    if (isObjectType || isNode(properties)) {
      objectCount += 1;
      if (node['additionalProperties'] !== false) {
        violations.push(`${path}: additionalProperties is not false`);
      }
      const keys = isNode(properties) ? Object.keys(properties).sort() : [];
      const required = Array.isArray(node['required']) ? [...(node['required'] as string[])].sort() : [];
      if (JSON.stringify(required) !== JSON.stringify(keys)) {
        violations.push(
          `${path}: required [${required.join(', ')}] does not equal properties [${keys.join(', ')}]`,
        );
      }
    }

    if (isNode(properties)) {
      for (const [key, child] of Object.entries(properties)) visit(child, `${path}.properties.${key}`);
    }
    visit(node['items'], `${path}.items`);
    if (Array.isArray(node['items'])) {
      node['items'].forEach((child, i) => visit(child, `${path}.items[${i}]`));
    }
    for (const keyword of ['anyOf', 'oneOf', 'allOf', 'prefixItems']) {
      const branches = node[keyword];
      if (Array.isArray(branches)) {
        branches.forEach((child, i) => visit(child, `${path}.${keyword}[${i}]`));
      }
    }
    for (const keyword of ['$defs', 'definitions']) {
      const defs = node[keyword];
      if (isNode(defs)) {
        for (const [key, child] of Object.entries(defs)) visit(child, `${path}.${keyword}.${key}`);
      }
    }
    if (isNode(node['additionalProperties'])) {
      visit(node['additionalProperties'], `${path}.additionalProperties`);
    }
  };

  visit(root, '$');
  return { violations, objectCount };
}

function convert(schema: z.ZodType): Node {
  const result = toModelJsonSchema(schema);
  if (!result.ok) throw new Error('schema not representable');
  return result.value as Node;
}

describe('model-facing schemas are strict-compatible', () => {
  const schemas: ReadonlyArray<readonly [string, z.ZodType]> = [
    ['ConceptExtractionResponseSchema', ConceptExtractionResponseSchema],
    ['GenerationResponseSchema', GenerationResponseSchema],
    ['ReviewResponseSchema', ReviewResponseSchema],
  ];

  it.each(schemas)('%s has no strict-mode violations', (_name, schema) => {
    const { violations, objectCount } = checkStrict(convert(schema));
    expect(objectCount).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  describe('walker self-test', () => {
    it('flags optional properties and non-strict objects', () => {
      const bad = z.object({ a: z.string(), b: z.string().optional() });
      const { violations } = checkStrict(convert(bad));
      expect(violations.length).toBeGreaterThan(0);
    });

    it('flags a violation nested in an array item', () => {
      const bad = z.strictObject({ list: z.array(z.strictObject({ a: z.string().optional() })) });
      const { violations } = checkStrict(convert(bad));
      expect(violations.some((v) => v.includes('items'))).toBe(true);
    });

    it('accepts a strict schema with nullable fields', () => {
      const good = z.strictObject({ a: z.string(), b: z.string().nullable() });
      expect(checkStrict(convert(good)).violations).toEqual([]);
    });
  });
});

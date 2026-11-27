/**
 * Adapts a model-facing JSON Schema (as `toModelJsonSchema` produces it: strict objects, every
 * property required, `additionalProperties: false`) to the subset Gemini structured output
 * documents. Only rewrites that keep the meaning exactly:
 *
 * - `const: v` becomes `enum: [v]`. Gemini's supported-keyword list has `enum` but not `const`,
 *   and unlisted keywords are ignored, which would drop the lock-type discriminators of the
 *   generation `anyOf` arms.
 * - On `type: "integer"`, `exclusiveMinimum: n` becomes `minimum: floor(n) + 1` and
 *   `exclusiveMaximum: n` becomes `maximum: ceil(n) - 1` (whole numbers, so the same set).
 * - On any other type an exclusive bound has no exact equivalent in the subset, so it is left
 *   out of what Gemini sees. None of today's schemas has one. Our Zod parse of every reply
 *   still enforces it.
 *
 * Everything else is copied unchanged, including `minLength` and `maxLength`, which Gemini
 * documents as accepted but not enforced. Property names under `properties` are never treated as
 * keywords. The input is never mutated.
 */
export type JsonSchemaNode = Readonly<Record<string, unknown>>;

const SCHEMA_MAPS = new Set(['properties', '$defs', 'definitions', 'patternProperties']);
const SCHEMA_LISTS = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems']);
const SCHEMA_SLOTS = new Set(['items', 'additionalProperties', 'not']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function adaptValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(adaptValue);
  return isRecord(value) ? adaptNode(value) : value;
}

function adaptMap(map: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(map)) out[name] = adaptValue(child);
  return out;
}

function adaptNode(node: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'const' || key === 'exclusiveMinimum' || key === 'exclusiveMaximum') continue;
    if (SCHEMA_MAPS.has(key) && isRecord(value)) out[key] = adaptMap(value);
    else if (SCHEMA_LISTS.has(key) || SCHEMA_SLOTS.has(key)) out[key] = adaptValue(value);
    else out[key] = value;
  }
  if ('const' in node && !('enum' in node)) out['enum'] = [node['const']];
  if (node['type'] === 'integer') {
    const low = node['exclusiveMinimum'];
    const high = node['exclusiveMaximum'];
    if (typeof low === 'number') out['minimum'] = tighter(Math.max, out['minimum'], Math.floor(low) + 1);
    if (typeof high === 'number') out['maximum'] = tighter(Math.min, out['maximum'], Math.ceil(high) - 1);
  }
  return out;
}

function tighter(pick: (a: number, b: number) => number, existing: unknown, bound: number): number {
  return typeof existing === 'number' ? pick(existing, bound) : bound;
}

export function toGeminiJsonSchema(schema: JsonSchemaNode): JsonSchemaNode {
  return adaptNode({ ...schema });
}

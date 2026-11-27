import { z } from '../zod.js';
import type { Result } from '../types.js';

export type ModelJsonSchemaError = { readonly kind: 'schema-not-representable' };

export type ModelJsonSchema = Readonly<Record<string, unknown>>;

/**
 * Converts a Zod schema into the plain JSON Schema object used as `ProviderRequest.jsonSchema`.
 *
 * Choices:
 * - `target: 'draft-07'`: the dialect OpenAI strict structured outputs documents; a nullable
 *   primitive becomes `type: ['string', 'null']` (complex types become `anyOf` with null).
 * - `io: 'input'`: the model's JSON is the *input* of `schema.parse`, so this describes what the
 *   parser accepts. For schemas without defaults or transforms it equals the output shape.
 * - `unrepresentable: 'throw'` (default), caught and returned as a typed error.
 * - `$schema` is stripped: the worker wraps the result in `response_format.json_schema.schema`,
 *   which does not need a dialect marker, and a provider-neutral object stays smaller.
 *
 * Model-facing schemas must be strict-compatible: `z.strictObject` everywhere, every property
 * required, `.nullable()` instead of `.optional()`. This function does not enforce that; the
 * strict-walk test (task 19.4) does.
 */
export function toModelJsonSchema(
  schema: z.ZodType,
): Result<ModelJsonSchema, ModelJsonSchemaError> {
  try {
    const converted: Record<string, unknown> = {
      ...z.toJSONSchema(schema, { target: 'draft-07', io: 'input' }),
    };
    delete converted['$schema'];
    return { ok: true, value: converted };
  } catch {
    return { ok: false, error: { kind: 'schema-not-representable' } };
  }
}

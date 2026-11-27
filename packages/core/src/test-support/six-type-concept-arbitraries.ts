import fc from 'fast-check';
import { concept, hh } from '../pipeline/room-assembly-heart-fixtures';
import type { AssemblyConcept } from '../pipeline/room-assembly';

/**
 * The human-heart sample concepts, one per Lock_Type as the primary:
 * c01 rune, c02 séance, c03 bone ordering, c04 bound threads, c05 cursed object, c06 combination dial.
 * Alternates always have a different type from their primary. c07 is a second rune primary
 * (a deliberate type collision with c01).
 */
const POOL: readonly { id: string; primary: string; alternate: string | null }[] = [
  { id: 'hh-c01', primary: 'hh-q01', alternate: 'hh-q02' },
  { id: 'hh-c02', primary: 'hh-q03', alternate: 'hh-q04' },
  { id: 'hh-c03', primary: 'hh-q05', alternate: 'hh-q06' },
  { id: 'hh-c04', primary: 'hh-q07', alternate: 'hh-q08' },
  { id: 'hh-c05', primary: 'hh-q09', alternate: 'hh-q10' },
  { id: 'hh-c06', primary: 'hh-q11', alternate: null },
];

/**
 * Accepted concepts covering all six Lock_Types as primaries, in any extraction order, each with
 * its alternate kept or dropped, optionally followed by a colliding rune concept (`hh-c07`).
 */
export const sixTypeConceptsArb: fc.Arbitrary<AssemblyConcept[]> = fc
  .record({
    order: fc.shuffledSubarray([...POOL], { minLength: POOL.length, maxLength: POOL.length }),
    keepAlternate: fc.array(fc.boolean(), { minLength: POOL.length, maxLength: POOL.length }),
    collide: fc.boolean(),
  })
  .map(({ order, keepAlternate, collide }) => {
    const concepts = order.map((p, i) =>
      concept(
        p.id,
        hh(p.primary),
        keepAlternate[i] === true && p.alternate !== null ? hh(p.alternate) : null,
      ),
    );
    if (collide) concepts.push(concept('hh-c07', hh('hh-q12'), hh('hh-q02', { conceptId: 'hh-c07' })));
    return concepts;
  });

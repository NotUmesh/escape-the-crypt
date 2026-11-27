import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { assertRecordedOnly } from './recorded-only.js';

type Entry = Parameters<typeof assertRecordedOnly>[0][number];

const rec = (digest: string): Entry => ({ digest, origin: 'recorded' });
const syn = (digest: string): Entry => ({ digest, origin: 'synthetic' });

describe('assertRecordedOnly (Req 12.10)', () => {
  it('rejects a mixed run, listing only synthetic digests in input order, de-duplicated', () => {
    const result = assertRecordedOnly([
      rec('r1'),
      syn('s2'),
      syn('s1'),
      rec('r2'),
      syn('s2'),
      syn('s3'),
      syn('s1'),
    ]);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'synthetic-cassette-in-evaluation', digests: ['s2', 's1', 's3'] },
    });
  });

  it('passes an all-recorded run', () => {
    expect(assertRecordedOnly([rec('a'), rec('b'), rec('a')])).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('rejects an all-synthetic run', () => {
    const result = assertRecordedOnly([syn('a'), syn('b')]);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'synthetic-cassette-in-evaluation', digests: ['a', 'b'] },
    });
  });

  it('passes empty input (vacuously recorded)', () => {
    expect(assertRecordedOnly([])).toEqual({ ok: true, value: undefined });
  });

  it('never throws and rejects exactly when a synthetic entry exists', () => {
    const entry = fc.record({
      digest: fc.string(),
      origin: fc.constantFrom('recorded' as const, 'synthetic' as const),
    });
    fc.assert(
      fc.property(fc.array(entry), (entries) => {
        const result = assertRecordedOnly(entries);
        const expected = [
          ...new Set(entries.filter((e) => e.origin === 'synthetic').map((e) => e.digest)),
        ];
        if (expected.length === 0) {
          expect(result.ok).toBe(true);
        } else {
          expect(result).toEqual({
            ok: false,
            error: { kind: 'synthetic-cassette-in-evaluation', digests: expected },
          });
        }
      }),
    );
  });
});

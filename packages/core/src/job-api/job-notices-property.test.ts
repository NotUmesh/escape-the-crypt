import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import golden from '../test-support/contract/job-completed.json';
import { excludedConceptArb, jobNoticesArb, sufficiencyNoticeArb } from '../test-support/notices-arbitraries';
import {
  ExcludedConceptSchema,
  JobBundleSchema,
  JobNoticesSchema,
  JobStatusResponseSchema,
  SufficiencyNoticeSchema,
} from './job-response-schema';

// Read-only: today's completed body. Never edited or regenerated here.
const todaysBody = golden.response as { jobId: string; status: string; bundle: Record<string, unknown> };
const todaysBundle = todaysBody.bundle;

const viaJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

// Feature: generation-and-evaluation, Property 41: Notices round-trip, and a bundle without notices is unchanged
describe('Property 41: notices round-trip, and a bundle without notices is unchanged', () => {
  it('Validates: Requirements 29.2, 18.4, 17.2: every ExcludedConcept and SufficiencyNotice round-trips through JSON', () => {
    fc.assert(
      fc.property(excludedConceptArb, sufficiencyNoticeArb, (excluded, sufficiency) => {
        expect(ExcludedConceptSchema.parse(viaJson(excluded))).toEqual(excluded);
        expect(SufficiencyNoticeSchema.parse(viaJson(sufficiency))).toEqual(sufficiency);
      }),
    );
  });

  it('Validates: Requirements 29.2, 18.4: a notices object round-trips, alone and inside a completed body', () => {
    fc.assert(
      fc.property(jobNoticesArb, (notices) => {
        expect(JobNoticesSchema.parse(viaJson(notices))).toEqual(notices);
        const body = { ...todaysBody, bundle: { ...todaysBundle, notices } };
        const parsed = JobStatusResponseSchema.parse(viaJson(body));
        expect(viaJson(parsed)).toEqual(viaJson(body));
        expect(JobBundleSchema.parse(viaJson(body.bundle))).toHaveProperty('notices', notices);
      }),
    );
  });

  it('Validates: Requirements 17.2: a bundle without notices stays without notices and serialises as today', () => {
    expect(JSON.stringify(todaysBundle)).not.toContain('"notices"');
    const parsed = JobStatusResponseSchema.parse(todaysBody);
    expect(parsed.status).toBe('completed');
    if (parsed.status === 'completed') {
      expect('notices' in parsed.bundle).toBe(false);
    }
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(todaysBody));
  });

  it('Validates: Requirements 29.2: unknown keys inside notices are rejected', () => {
    fc.assert(
      fc.property(
        jobNoticesArb,
        fc.constantFrom('notices', 'excluded', 'sufficiency', 'passage', 'item'),
        fc.string({ minLength: 1, maxLength: 10 }).filter((k) => {
          return k.length > 0;
        }),
        (notices, where, key) => {
          const withExtra = (target: object): object => ({ ...target, [`x_${key}`]: 1 });
          const bad = (n: object): boolean => !JobNoticesSchema.safeParse(viaJson(n)).success;
          if (where === 'notices') {
            expect(bad(withExtra(notices))).toBe(true);
          } else if (where === 'sufficiency') {
            fc.pre(notices.sufficiency !== null);
            expect(bad({ ...notices, sufficiency: withExtra(notices.sufficiency as object) })).toBe(true);
          } else if (where === 'passage') {
            fc.pre(notices.excluded.length > 0);
            const [first, ...rest] = notices.excluded;
            const [p0, p1] = first!.passages;
            expect(bad({ ...notices, excluded: [{ ...first, passages: [withExtra(p0), p1] }, ...rest] })).toBe(true);
          } else {
            fc.pre(notices.excluded.length > 0);
            const [first, ...rest] = notices.excluded;
            expect(bad({ ...notices, excluded: [withExtra(first!), ...rest] })).toBe(true);
          }
        },
      ),
    );
  });
});

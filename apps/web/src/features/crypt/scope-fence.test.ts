import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { HAUNTING_FROZEN_FILES, HAUNTING_NEW_FILES, scopeViolations } from './haunting-scope';

const CRYPT = 'apps/web/src/features/crypt';

/**
 * Files changed by commits whose subject starts "Haunting polish:". A commit for a confirmed
 * Open_Decision uses the subject "Haunting polish (decision N):" so it is not fenced here.
 */
function changedByHauntingCommits(): readonly string[] | null {
  try {
    const out = execFileSync('git', ['log', '--grep=^Haunting polish:', '--name-only', '--format='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [...new Set(out.split('\n').filter((line) => line !== ''))];
  } catch {
    return null;
  }
}

describe('scope fence', () => {
  it('rejects a frozen file', () => {
    expect(scopeViolations([`${CRYPT}/room-panel.tsx`])).toEqual([`${CRYPT}/room-panel.tsx`]);
    expect(scopeViolations(['packages/core/src/mapper/manifest-mapper.ts'])).toHaveLength(1);
    expect(scopeViolations(['apps/web/src/state/room-binding.ts'])).toHaveLength(1);
  });
  it('allows a crypt stylesheet and a new motion file', () => {
    expect(scopeViolations([`${CRYPT}/flame.css`, `${CRYPT}/quill-mark.tsx`])).toEqual([]);
  });
  it('rejects an existing component that is not on the list', () => {
    expect(scopeViolations([`${CRYPT}/evidence-panel.tsx`, `${CRYPT}/ghost-layer.tsx`])).toHaveLength(2);
  });
  it('allows the edits the user approved, and no other component beside them', () => {
    const approved = ['autopsy-view', 'final-door', 'art-stage', 'crypt-flow', 'room-screen'].map((n) => `${CRYPT}/${n}.tsx`);
    expect(scopeViolations(approved)).toEqual([]);
    expect(scopeViolations(['apps/web/e2e/haunting-axe.e2e.ts', 'apps/web/e2e/haunting-flows.ts', 'docs/screenshots/haunting/candle-lit.jpg'])).toEqual([]);
  });
  it('keeps the two lists apart', () => {
    for (const file of HAUNTING_NEW_FILES) expect(HAUNTING_FROZEN_FILES).not.toContain(file);
  });
  it('finds no violation in the commits of this spec', () => {
    const changed = changedByHauntingCommits();
    if (changed === null) return;
    expect(scopeViolations(changed)).toEqual([]);
  });
});

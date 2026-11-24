import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { submissionFor } from '../test-support/question-answers';
import { SETTINGS } from '../test-support/run-settings';
import { apply } from './apply';
import { initial } from './initial';
import type { State } from './state-types';

const manifest = buildManifest({ rooms: 1, conceptsPerRoom: 2, alternates: true });
const room = manifest.rooms[0];
const spec = room?.lockSlots[0];
const alternate = spec?.alternateQuestion;
if (!room || !spec || !alternate) throw new Error('fixture');

function run(state: State, ...events: Parameters<typeof apply>[1][]): ReturnType<typeof apply> {
  let result: ReturnType<typeof apply> = { ok: true, state, notices: [] };
  for (const event of events) {
    if (!result.ok) throw new Error(`setup rejected: ${result.error.kind}`);
    result = apply(result.state, event);
  }
  return result;
}

describe('a Return never shows a challenged question', () => {
  it('spawns no ghost when the primary was challenged and the Alternate is answered wrong', () => {
    const result = run(
      initial(manifest, SETTINGS),
      { kind: 'RunStarted', manifestId: manifest.manifestId },
      { kind: 'RoomPublished', roomId: room.roomId },
      { kind: 'RoomEntered', roomId: room.roomId },
      { kind: 'Challenged', slotId: spec.slotId },
      { kind: 'AnswerSubmitted', slotId: spec.slotId, submission: submissionFor(alternate, false) },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notices.map((n) => n.kind)).not.toContain('ghostSpawned');
    expect(result.state.ghosts).toEqual([]);
    expect(result.state.rooms[0]?.dueReturnSlots).toEqual([]);
    // Fields the Req 22 outcome derivation reads: Review due, not Challenged, because the
    // Alternate was answered.
    expect(result.state.concepts.find((c) => c.conceptId === spec.conceptId)).toMatchObject({
      firstQuestionResult: 'challenged',
      alternateUsed: true,
      alternateChallenged: false,
      alternateResult: 'wrong',
      return1Result: null,
      return2Result: null,
      reviewDueFlag: true,
      isLingeringSpirit: false,
    });
  });
});

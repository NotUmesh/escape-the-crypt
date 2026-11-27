# Run length and difficulty: design

Approved 2026-11-27. Phase 1 (core and worker) is implemented; phase 2 (web UI) follows.

## Rules

- **Length sets the crypt size.** Short 2 rooms, Standard 3, Long 4. Every room has 2 locks from 2
  different concepts, plus the final door. The one mapping is `cryptTargetFor` in
  `packages/core/src/run-length.ts`; web, worker and pipeline all read it.
- **Never pad.** When the notes cannot fill the target, the crypt has the rooms they fill. The web
  emits `CryptShortened` with the actual count. No question a check refused is brought back, and no
  weak pairing fills a room.
- **Difficulty changes play only**, never generation or cost (`packages/core/src/difficulty.ts`):

  | Difficulty | Hints | Rune letter count |
  |---|---|---|
  | Apprentice | 3 | shown |
  | Gravedigger | 2 | shown |
  | Lich | 0 | hidden |

  Ghost rules, challenge and the guarantee that escape is possible are the same for every
  difficulty; the runtime never reads `difficulty`. The letter-count rule is read from the stored
  difficulty, so `RunSettings` and its persisted schema do not change.
- **Settings are stored with the run** (spec 4's `RunRecord.settings`), so resume, Play again and
  Start again keep them. The sample crypt keeps its one room and honours the chosen difficulty.

## Concept cap, spread over the notes

A run with a target generates for at most `3 × rooms` concepts (6, 9, 12): two locks per room plus
one spare. `selectSpreadConcepts` (`pipeline/concept-spread.ts`) cuts the chunk positions into equal
bands and keeps the concept nearest each band's centre, so later parts of long notes get questions.
Kept concepts keep their extraction order and IDs. Without a target nothing is capped.

## Multi-room assembly

`pipeline/crypt-assembly.ts` (`assembleCrypt`) builds every room from a pair of concepts through
the existing `assembleRoom` (unchanged), trying both orders. A pair is a room when it yields exactly
two leak-free locks. A depth-first search keeps the earliest set of rooms that share no concept, no
answer (`duplicate-answer-in-room`) and no rune-answer leak (`answer-leak-in-room`) across the whole
crypt (Requirement 5.4 and 5.4a now say "in that crypt"). Rooms are `room-1` to `room-N`; slot IDs
get the room as a prefix. Leftover accepted primaries go to `unplacedAccepted`. The final door
stays empty (reservation is P6).

`runRoomPipeline` takes `target?: CryptTarget`. Absent, it behaves exactly as before: every concept,
one room, the legacy manifest ID. The worker stores `runLength` on the job and passes
`cryptTargetFor(job.runLength)`.

## Manifest ID from content

With a target, the manifest ID is `crypt-<notes digest 16>-<8 hex of SHA-256 over rooms and
content>`. The same crypt always gets the same ID (saving twice is a no-op); a different crypt from
the same notes gets its own, so it no longer hits `manifest-conflict`. The notes link is
`documentDigest`, unchanged. Covered by `apps/web/src/state/storage/content-manifest-id.test.ts`.

## Setup screen estimate

`lengthAvailability(quotableChunks)` (`run-length.ts`), with `lengthAvailabilityForNotes` chunking
the text the way the worker does. Short is always offered. Standard and Long need at least 6
quotable chunks. The dev set gives a weak signal: notes that filled 3 or 4 rooms had 6 to 9 chunks,
and so did notes that did not. The threshold is the lowest count that never switches off a length a
dev note filled; it only blocks lengths the notes clearly cannot fill.

## Measured on the recorded v2 dev cassettes (free replay)

Run with `--allowed-lock-types rune-cipher,seance-board` (the lock types the cassettes were recorded
with). Notes that fill each target, of 12:

| Length | Rooms | Fill | Rooms per note (dev-01 … dev-12) | Concepts generated |
|---|---|---|---|---|
| none (legacy) | 1 | 12 | 111111111111 | 92 |
| Short | 2 | 10 | 222222122221 | 66 |
| Standard | 3 | 6 | 332333123221 | 85 |
| Long | 4 | 1 | 432333123221 | 89 |

The cap loses nothing: the same rooms are reached with no cap. Duplicate answers placed: 0.
Every call replayed (cost 0). Séance supply is the bottleneck (the model proposes rune as primary
for about 90% of concepts); phase 5's wider lock types should raise Standard and Long. The dev notes
are small (4 to 9 quotable chunks), so real-note fill rates are unmeasured.

## Phase 2 (web UI)

- Setup screen in `features/start/run-choice.tsx`: two native radio groups in fieldsets (Length,
  Difficulty), defaults Short and Apprentice, unavailable lengths disabled with a one-line reason.
- `BuiltCrypt.settings`; start events publish every room, `CryptFinalised(requested)`, then
  `CryptShortened(actual)` when fewer.
- Room screen: next-room control and the shortened notice. `art-room.ts`: rooms reuse the three
  art rooms in rotation. `question-controls.tsx`: no hint control when the allowance is 0.
- Rune letter count: `lock-panel-context.ts` gains `answerLengthFor`, read from the question's
  `hintEffect.length` (the answer text never reaches the panel); `rune-cipher-panel.tsx` shows it
  when the difficulty allows.

# `room-runtime` spec brief (input for Kiro)

**What this is:** the thinking spec 2 needs, gathered in one place so Kiro writes better requirements on the first pass. Kiro authors `requirements.md`, `design.md` and `tasks.md` from it. This brief is planning input (written with another AI tool and reviewed by the author); it is not the spec.

**Sources reconciled:** `.kiro/steering/product.md`, the six-locks design, and the final plan. Where they disagreed or left a gap, section 2 records the decision.

## Decisions confirmed by the author (Nov 24)

- **D0–D8 in section 2: accepted as recommended.**
- **Combination dial decimals:** the dial supports **one decimal place** (a digit wheel plus a typed input). Range questions ask for one value.
- **Autopsy is reached on escape only.** Leaving mid-run saves the run, and the desk shows that book as unfinished.

---

## 1. The shape: a pure reducer over an event log

Design the runtime as **`state = events.reduce(apply, initial(manifest))`** in `packages/core/src/runtime/`.

> **D0: where the runtime lives.** The pure reducer and the answer judges go in `packages/core` (it already has the property-test setup and the on-save hook, it is what may become a Kiro Power, and the worker can reuse the judges). Only the React binding and persistence stay in `apps/web/src/state/`. Update `.kiro/steering/structure.md` in the same session to say so.

- **No timers, no randomness, no I/O inside.** Ghost returns are scheduled by the *count of answered questions*, not by time. Option and bone order come from the manifest, fixed when the room was created.
- **Invalid events are rejected as typed results** (`{ ok: false, error: { kind: 'lock-already-settled' } }`), never thrown, and leave the state unchanged.
- **Answers are judged by code** with pure per-type judge functions in `packages/core/src/locks/<type>.ts` (one file per lock type; split into `<type>-judge.ts` only if the 300-line rule forces it). The model is never involved during play.
- **Why:** reload, exact resume, export and the Autopsy follow almost for free. Persistence (spec 4) only stores the manifest and the event list.

### Inputs (owned by the generation spec, consumed here)
- `CryptManifest`: immutable. Rooms (published one at a time) and each room's locks. Each **concept** has a primary question, optionally one alternate of a **different lock type**, and evidence references. The final-door set and the hint effects are fixed at creation (which option a hint removes, which bone it locks).
- `RunSettings`: length (short / standard / long), difficulty (Apprentice / Gravedigger / Lich), hint allowance.

### Events (suggested names)
| Event | From | Notes |
|---|---|---|
| `RunStarted` | learner | manifest ID, settings |
| `RoomPublished` | job | idempotent; a duplicate is a no-op |
| `CryptFinalised` / `CryptShortened` | job | final room count is known; shortening never changes a published room |
| `RoomEntered` | learner | only if the room is published and the previous one is cleared |
| `LockOpened` | learner | UI focus only; optional in the log |
| `HintUsed` | learner | only when hints remain and the slot is open |
| `AnswerSubmitted` | learner | the judge runs in the reducer; the result is stored in state |
| `Skipped` | learner | |
| `Challenged` | learner | stored locally only; excluded from score |
| `EvidenceContinued` | learner | closes the evidence panel |
| `FinalDoorEntered` | learner | |
| `RunLeft` / `RunResumed` | learner | candle snuff on leaving mid-run |

Draft answers (letters typed, the planchette's position, bone order before Submit) stay in **UI state and are never logged**. State this explicitly so half-typed answers are not persisted.

---

## 2. Decisions (all accepted)

| # | Question | Decision |
|---|---|---|
| D1 | How many submits does one question get? | **One judged submit per question.** The evidence panel reveals the answer, so a second submit tests nothing. A wrong answer settles the lock and spawns a ghost. |
| D2 | What are a ghost's two attempts? | **Return 1** uses the alternate (a fresh test). If wrong, **return 2** reuses one of the concept's questions, **labelled "Review"** in the UI and reported as such. A miss on return 2 makes it a **lingering spirit** (review due). |
| D3 | What does Skip do? | Skip **settles the lock, with no ghost visual and no penalty**. The concept returns later through the same queue as ghosts, using the alternate. With no unused alternate, it goes straight to **review due**. |
| D4 | What does Challenge do? | **Immediate in-place replacement**: the wax seal cracks and the alternate appears in the same lock. With no unused alternate, the lock settles and the concept is **review due**. A challenge on the replacement settles the lock and the concept is review due (no third question). |
| D5 | When does a ghost return? | After **3 other judged answers** (named constant `GHOST_DELAY = 3`). Pending ghosts carry over when a room is cleared. **At the final door, every outstanding ghost and deferred skip is due**, whatever the count. |
| D6 | Does laying a ghost to rest light a candle? | **Yes.** Every correct judged answer lights exactly one candle, including assisted and returned answers. Challenged questions never count. |
| D7 | When can the learner leave a room? | When every lock is **solved or settled**. A lock waiting for its ghost counts as settled for progression, so a hard concept never blocks a room. |
| D8 | What is in the final door? | **Pre-made at generation:** the manifest reserves 2–4 final-door questions drawn from concepts across rooms, plus every outstanding ghost and deferred skip (D5). The door opens when all its slots are solved or settled. **Escape is always possible.** |

---

## 3. Concept outcomes (the Autopsy vocabulary)

Each concept ends in exactly **one** reported outcome. Precedence, top wins:

1. **Challenged**: every question asked for this concept was challenged, so it is excluded from all counts. A challenged question replaced by an answered alternate does *not* make the concept challenged; the alternate's result counts.
2. **Review due**: a lingering spirit, or a skip or challenge with no alternate left.
3. **Retried**: a correct answer on a ghost or skip return (D2, D3).
4. **Assisted**: a correct first answer after using a candle hint.
5. **First-try correct**: a correct first answer with no hint.

Never "mastered", "exam-ready" or "verified" (`evidence-and-honesty.md`). The Autopsy labels go into the copy catalogue in `packages/core/src/copy.ts`, so the banned-words test covers them.

---

## 4. Correctness properties (for property-based and model-based tests)

Use fast-check **model-based** testing with `fc.commands`: the model is a small counter-based summary of the run, and the real system is the reducer. Generators need a random **manifest** (1–5 rooms, 1–6 concepts each, alternates present or missing at random, every lock type) and random **event sequences**, including invalid ones.

| # | Property |
|---|---|
| R1 | **Termination:** for any manifest and any learner policy (all wrong, all skip, all challenge, random), the run reaches `escaped` within at most `Σ concepts × 4 + finalDoorSlots` prompts (primary, at most one challenge replacement, at most two returns per concept). |
| R2 | **No unlock without a correct answer:** the candle count always equals the number of `AnswerSubmitted` events judged correct on non-challenged questions. No other event changes it. |
| R3 | **One ghost per concept:** never more than one pending return per concept, and its return count never exceeds 2. |
| R4 | **Different question on return 1:** the question shown on return 1 differs from the one missed. If it is the same, the slot is labelled "Review". |
| R5 | **Invalid events are no-ops:** any invalid event returns a typed error and leaves the state deep-equal to before. Nothing throws, on any sequence. |
| R6 | **Replay determinism:** `fold(events)` equals `fold(JSON.parse(JSON.stringify(events)))`, and folding a prefix then the rest equals folding the whole (the reload and resume guarantee). |
| R7 | **Published rooms are immutable:** duplicate or late `RoomPublished` events never change a published room's locks, option order or hint effects. |
| R8 | **Hints:** the remaining count never drops below 0, `HintUsed` on a solved or settled slot is rejected, and a correct answer after a hint is always "assisted". |
| R9 | **Challenge never hurts:** a run with a challenge on question Q gives no worse counts for every *other* concept than the same run without it, and Q's concept is never "wrong". |
| R10 | **Exactly one outcome per concept** when escaped, and the five outcome counts sum to the number of concepts. |
| R11 | **Room progression:** `RoomEntered(k+1)` is accepted only when room k is cleared and room k+1 is published. A shortened crypt makes the final door reachable. |
| R12 | **Order fixed by the manifest:** option and bone order in any state equal the manifest's, so reload never reshuffles anything. |

**Named example sequences for `tasks.md`:**
- **All wrong**, short crypt: each concept → ghost → return 1 wrong → return 2 (Review) wrong → lingering spirit. Escape with N lingering spirits; the Autopsy shows N review due.
- **All challenged**, with alternates: every lock gets its replacement; challenge every replacement → all review due; escape; zero candles; zero "wrong".
- **Reload after every event**: for a fixed 40-event run, fold the prefix, serialise, refold, continue; the result equals the uninterrupted run at every step.
- Also: **no alternates at all**, **crypt shortened mid-run**, and **next room not yet published** (the "still digging" waiting state).

---

## 5. Answer judges (pure, one per lock type)

Spec 2 owns the judge functions, because they run inside the reducer; spec 3 owns making the questions. Only rune cipher and séance board are needed for Gate 1.

| Lock | Judge rule | Edge cases for unit tests |
|---|---|---|
| Rune cipher | Trim, collapse spaces, ignore case **unless the answer is flagged case-sensitive** (symbols such as `Na`, `pH`); exact match against the answer or a reviewed alias | `"  Atrioventricular "` passes; `"AV"` alias passes; `"atrio-ventricular"` fails unless it is an alias; `"NA"` fails for case-sensitive `Na` |
| Séance board | Selected option ID equals the key ID | Stale option IDs from another question are rejected as invalid, not judged wrong |
| Bone ordering | The submitted permutation equals the key exactly; a hint-locked first bone cannot move | A submission that is not a permutation (duplicates, missing items) is invalid |
| Bound threads | The set of pairs equals the key set; Submit only when every left item is tied | Partial sets are invalid; a hint-tied thread cannot be untied |
| Cursed object | Selected ID equals the odd one out | — |
| Combination dial | Exact value, or inside the stated range or tolerance; units fixed by the question; **one decimal place supported** | `60` and `100` pass for "60–100"; `59.9` fails; `21.5` passes when the key is 21.5; non-numeric input is invalid, not wrong |

**Invalid vs wrong** is a requirement of its own: an invalid submission (empty, malformed, not a permutation) never spawns a ghost. The UI prevents it, and the reducer rejects it anyway.

---

## 6. Out of scope for spec 2

- Storage (IndexedDB, single tab, save errors, export) → spec 4. Spec 2 only makes the state foldable and serialisable.
- Animations and visuals → spec 5. Spec 2 emits *what happened* (`candleLit`, `ghostSpawned`, `ghostLaidToRest`, `sealCracked`); the UI decides how it looks.
- Generation and the manifest builder → spec 3. For tests, spec 2 needs only a **manifest fixture builder** in `test-support/`.

---

## 7. Suggested phasing for `tasks.md`

1. Types and the manifest fixture builder; reducer skeleton with typed rejections (R5)
2. Rune and séance judges, with unit tests (section 5)
3. Solve, settle, skip and challenge for a **single room**; candles (R2, R8, R9)
4. Ghost queue and returns (R3, R4); the three named sequences
5. Model-based test harness covering R1, R6, R10
6. Multiple rooms, publishing and shortening (R7, R11), then the final door (D8)
7. The other four judges, later, alongside their lock UIs

Steps 1–5 are the first day's work. Step 6 can follow, because Gate 1 needs only one room.

### The hook
The existing hook (`PostFileSave`, matcher on `packages/core/src`) already fires on runtime files. Instead of a second hook, make `run-core-tests.mjs` choose the suite from the saved path: for `runtime/` or `locks/`, run the model-based state tests; otherwise, the full core suite. File hooks fire only on agent edits, not on manual edits in the editor.

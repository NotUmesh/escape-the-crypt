---
inclusion: always
---

# Product: Escape the Crypt

## What it is
A study app that turns a learner's own notes (pasted text or a text PDF) into a short, candle-lit escape room. Every lock is a question generated from their material. Correct answers light candles and bring light back into the crypt. Missed concepts return later as ghosts. Every question shows its source passage and can be challenged without penalty.

Built for Kiroween 2026, Costume Contest category: every spooky element must carry learning meaning, never pure decoration.

## Who it's for
College students and adult learners (18+) revising from short English prose notes and explanatory texts. Not marketed to children. Not for math-heavy, diagram-heavy or scanned material in this version.

## Core loop
The app has two places: the **desk** above (warm, the learner's own study) and the **crypt** below (cold until candles are lit).

1. Title → the camera settles on the desk. The desk holds a stack of books: one per saved crypt on this device
2. Open a new book to bring notes: paste text or upload a text PDF → editable extraction preview
3. A background job generates and checks questions; rooms open one at a time as they finish
4. Blow out the desk candle → descend into the crypt
5. Play: pick a lock object, answer, see the source evidence
6. Correct → a candle lights (the lock is **solved**)
7. Wrong → a ghost for that concept appears; it returns later as a different question (two attempts, then **review due**, shown as a lingering spirit)
8. Challenge or Skip → the lock is **settled** (excluded from score), replaced by the alternate if one is unused
9. The final door mixes concepts from all rooms → escape (always possible)
10. Back at the desk, a quill writes the Autopsy: first-try correct, assisted, retried, challenged, review due
11. Next visit on this device: the book for that crypt shows the concepts still due for review

## Six lock types (supported, never a quota)
Rune cipher (cloze) · Séance board (source-bound choice) · Bone ordering (explicit sequences only) · Bound threads (strict one-to-one matching) · Cursed object (odd one out from an explicit category) · Combination dial (stated numbers or allowlisted formula templates). A document only gets the types its evidence supports.

## Non-goals (this version)
Accounts, leaderboards, teacher mode, multiplayer, OCR, diagram labelling, non-English generation, server-side storage of private uploads, any claim of learning gains, mastery or exam readiness.

## Success looks like
A learner finishes a short run unassisted, trusts the questions because they can see the evidence, and chooses to play again.

# `persistence` spec brief (spec 4; input for Kiro)

**When:** Sun Nov 29 (with haunting design). The final plan's "done when" for that day: **"Reload after any event restores exactly."**
**Builds on:** the room-runtime reducer (state = fold(manifest, events)) and the existing notes store (`escape-the-crypt` IndexedDB v1, `notes` store keyed by `documentDigest`).

---

## 1. What's stored where (all on the device)

| Store (IndexedDB) | Key | Contents | Mutability |
|---|---|---|---|
| `notes` (exists, v1) | `documentDigest` | `{schemaVersion, documentDigest, chunks}` | replace on the same digest |
| `manifests` | `manifestId` (content digest) | the published room manifests for one crypt | **immutable**; rooms are appended as they publish, never edited |
| `runs` | `runId` | run metadata: manifestId, settings, createdAt, status (`active`/`escaped`/`left`) | status only |
| `events` | `[runId, seq]` | one runtime event per row | **append-only** |
| `review` | `conceptKey` | review-due concepts for the next-visit Haunting | updated on escape |
| `settings` | `key` | lantern mode, sound, difficulty default | small |

The database version goes from 1 to 2 with an `onupgradeneeded` migration that **keeps `notes` untouched** (task 11.4 promised no migration for existing notes records).

**No server storage of private runs, ever** (`product.md` non-goals; `security.md`).

---

## 2. Decisions to confirm (P1–P6)

| # | Question | **Recommendation** |
|---|---|---|
| P1 | Write the event before or after showing the result? | **Before.** Append the event, and only after the write succeeds play the candle or ghost animation. If the write fails, keep the in-memory state, show a visible save banner ("Your progress isn't being saved on this device. Export a copy to keep it."), and keep playing. Never lose a run silently |
| P2 | Single-tab ownership | Use the **Web Locks API** (`navigator.locks.request('run:<id>')`). A second tab opening the same run gets a read-only "This crypt is open in another tab" screen with a "Take over here" button. BroadcastChannel is the fallback |
| P3 | Storage eviction | Call `navigator.storage.persist()` after the first finished run (not on first load, which can trigger a prompt). Show storage-used in settings |
| P4 | Export contents | One JSON file: schema version, notes chunks, manifest, events, review state. **Never the original file or file name.** It's labelled clearly as containing "your notes" |
| P5 | Import | Stretch only. If built, validate everything with Zod and re-fold; reject on any mismatch |
| P6 | The next-visit Haunting | Derived on app start from `review` (concepts still due). It uses already-prepared questions (an unused alternate first, else reused and labelled "Review"). No model calls |

---

## 3. Properties

| # | Property |
|---|---|
| S1 | **Round trip:** for any run, write all events, reopen the database, and fold: the state equals the in-memory state (deep equal, including option order, hints used and candle count) |
| S2 | **Append-only:** no operation changes or deletes an existing event row (except deleting a whole crypt, which is user-initiated) |
| S3 | **Crash consistency:** for any prefix of writes (simulate failure after event k), the reopened state equals fold(events[0..k]). Never a state that isn't a prefix |
| S4 | **Manifest immutability:** saving a manifest with an existing ID and different content is rejected |
| S5 | **Export → import (if built):** import(export(run)) folds to the same state |
| S6 | **Failure keeps play going:** with injected failures (undefined `indexedDB`, rejected open, aborted transaction, quota error), the run continues and the save banner appears. This mirrors Property 23 from spec 1 |

Use `fake-indexeddb` (already planned in task 11.6) for S1–S6, plus one Playwright test: play 3 events, reload, check the same screen state. That one is a video shot too.

---

## 4. Pitfalls to name in requirements
- Don't store derived state; store events. (Derived caches are allowed only if rebuilt from events on mismatch.)
- Event payloads contain **IDs and answers only**, never question text (the manifest has it).
- Draft answers aren't persisted (room-runtime brief §1).
- The schema version lives on every record; parsing returns typed errors, never throws (as `parseNotesRecord` does).

## 5. Phasing
1. DB v2 migration plus `manifests`, `runs` and `events` stores; S1, S2, S4
2. Write-before-animate with the failure banner; S3, S6
3. Web Locks single-tab ownership
4. Export; persist() request; settings
5. The Haunting entry point on the desk book (review due)

---

## Addendum (Nov 27): aligned with what's built

Specs 2, 3 and room-play are built. These points override anything above that disagrees.

1. **What a run needs to restore:** the `CryptManifest`, the `Crypt_Content` (question text, options, excerpts, concept titles), the `RunSettings` and the event log. Never store `State`; rebuild it with `events.reduce(apply, initial(manifest, settings))`. The chunks used for citation labels are rebuilt from the notes with the same chunker (room-play does this today), so the notes record must stay available for a saved generated crypt.
2. **Manifests are whole, not appended per room.** The runtime takes the complete manifest at `RunStarted`; streaming rooms is an open point in spec 3. Store the manifest and its content once, keyed by `manifestId`; immutable (S4).
3. **Two kinds of crypt:** the human-heart sample (rebuildable from source, but store it the same way for uniformity) and generated crypts (a bundle from the worker, already validated by core's `parseCryptBundle`). Store both through one path.
4. **The lantern setting stays in `localStorage`** as room-play built it (room-play Req 12.12). Don't move it into IndexedDB in this spec.
5. **Where the code goes:** the store and the persistence layer live in `apps/web/src/state/` next to the existing room binding; the binding gains write-before-animate (P1): the accepted event is appended before its notices are shown. Validation with Zod imported from core (`z` from `@escape-the-crypt/core`, never `zod` directly; lint enforces it). Test file names use hyphens; no file over about 300 lines.
6. **Resume entry point:** on the start screen, an unfinished saved run offers "Continue your crypt" (and "Start again"), alongside the existing buttons.
7. **Scope now:** phases 1 to 3 (DB v2 and the stores with S1, S2, S4; write-before-animate with the save banner, S3, S6; Web Locks single-tab ownership) plus the resume entry point, and the one Playwright test (play 3 events, reload, same screen). Export (phase 4) is small and can follow; the Haunting (phase 5) is out of scope for now. Import stays a stretch.
8. **No server storage, ever.** Nothing in this spec talks to the worker.

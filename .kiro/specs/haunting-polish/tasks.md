# Implementation Plan: Haunting Polish

## Overview

TypeScript and CSS (strict, Node 22, Vitest, fast-check, Playwright, axe). Almost every task is a stylesheet edit or a new file under `apps/web/src/features/crypt/`. Tasks 1 to 10 need no confirmation. Task 11 holds the four Open_Decisions and stays blocked until the user says go.

Rules for every task:

- Run `git pull --rebase` before the first edit of a task and before every commit. On a conflict, stop and report the files; make no further edit.
- Edit only what Requirement 1 allows: `.css` under `features/crypt/`, new `.ts`/`.tsx` files under `features/crypt/`, files under `.kiro/specs/haunting-polish/`, and one line per task in `docs/build-log.md`.
- Never edit `packages/core/src/pipeline`, `checks`, `mapper`, `authoring`, `apps/worker`, `eval`, `apps/web/src/state`, `room-screen.tsx`, `art-room.ts`, `question-controls.tsx`, `rune-cipher-panel.tsx`, `room-panel.tsx`, `lock-panel-context.ts`, `lock-panel-registry.ts`, or the four panels `bone-ordering-panel.tsx`, `bound-threads-panel.tsx`, `combination-dial-panel.tsx`, `cursed-object-panel.tsx`.
- Do not edit any existing `.ts` or `.tsx` file under `features/crypt/`, nor anything under `features/desk`, `features/dig`, `features/descent`, `features/start`, `app.tsx` or `main.tsx`, unless task 11 names it and the user has confirmed.
- If an existing test fails because of a task's CSS change, do not edit that test. Stop and report it (Requirement 16.12). A new test file may replace its coverage only after the user agrees.
- During a task, run only the test files the task adds or changes, plus the existing files that import the changed module (`vitest run <file>` in `apps/web`; one Playwright file on one project). Start no dev server or watcher. Full suites run only at Checkpoint tasks: Vitest with `--maxWorkers=50%`, Playwright with `--workers=2`.
- Use no word from the Banned_Phrases in code, comments, test names or docs. Add no learner-facing sentence; reuse text from `packages/core/src/copy.ts`.
- Every property test runs at least 100 iterations and carries the comment `Feature: haunting-polish, Property N: <title>`.

## Tasks

- [x] 1. Preflight and scope fence
  - [x] 1.1 Pull, read and report (read-only)
    - Run `git pull --rebase`. On a conflict, stop and report.
    - Report whether the Frozen_Files changed since this spec was written (`git log -3 --stat` over those paths).
    - Read `ghost-layer.tsx`, `art-motion.test.tsx`, `lantern-motion.test.tsx`, `crypt-css.test.ts` and `final-door.css`. Report every assertion about ghost opacity `0.85`, about `.atmosphere` `z-index`, and any test that would fail if `.atmosphere` moves to `z-index: 4`.
    - Run the baseline: `vitest run src/features/crypt/art-motion.test.tsx src/features/crypt/lantern-motion.test.tsx src/features/crypt/crypt-css.test.ts src/features/crypt/ghost-list.test.tsx` in `apps/web`. Record the result in the build log.
    - Report to the user anything that no longer matches the design (Risks section).
    - _Requirements: 1.2, 1.4, 16.12_
  - [x] 1.2 Add `scope-fence.test.ts`
    - One constant list of allowed path patterns and one of Frozen_Files, both taken from Requirement 1 and the glossary.
    - Read `git diff --name-only $(git merge-base HEAD origin/main)` (or the previous commit when no remote exists) and fail on any changed path outside the allowed list or inside the Frozen_Files.
    - Add a self-test with a fake path list: a Frozen_File fails, an allowed CSS passes, `room-screen.tsx` fails, a new `quill-mark.tsx` passes.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6_

- [x] 2. Overlay layering and contrast
  - [x] 2.1 Move the overlay under the ghosts and back the ghost label
    - `atmosphere-layer.css`: `.atmosphere { z-index: 4; }`. Put the mist drift under `@media (prefers-reduced-motion: no-preference)` and keep the `reduce` hold. Add the maximum opacities as a comment.
    - `ghost-layer.css`: `.ghost-art { opacity: 1; }`, `.ghost-art::after` gets `background: var(--stone-950)` and `padding: 0 0.375rem`. Keep `pointer-events: none` and the stacking at `z-index: 5`.
    - Run `crypt-css.test.ts`, `lantern-motion.test.tsx`, `art-motion.test.tsx`, `ghost-list.test.tsx`. If an existing test fails, follow the rule above.
    - _Requirements: 2.2, 2.3, 2.4, 2.6, 2.7, 2.9_
  - [x] 2.2 Add `overlay-stacking.test.ts`
    - Parse `atmosphere-layer.css`, `ghost-layer.css` and `art-stage.css`. Assert: the overlay `z-index` is lower than the ghost layer and the ghost layer lower than `.art-stage__controls`; the container and each part have `pointer-events: none`; no overlay part uses an image `url()`; the overlay moves only `opacity` and `background-position`.
    - Assert the overlay's `aria-hidden` and absence in Lantern_Mode by rendering `AtmosphereLayer` and `ArtStage` (reuse the setup of `lantern-motion.test.tsx`).
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.8, 2.11_
  - [x] 2.3 Add `overlay-contrast.test.ts`
    - Reuse the token parsing and ratio functions of `desk-contrast.test.ts` (copy the 20 lines; do not import from the desk feature).
    - Assert, from `tokens.css`: `--bone-50` on `--stone-950` (ghost label) and `--bone-50` on `--stone-800` (challenged note) are at least 4.5:1.
    - Negative control: read the maximum darkness and vignette opacities from `atmosphere-layer.css`, composite `--bone-50` under both over `--stone-950`, and assert the ratio is below 4.5, with a message that says why the text paints above the overlay.
    - _Requirements: 2.4, 2.5, 2.10_

- [x] 3. Candle, ghost rises and ghost laid to rest (CSS)
  - [x] 3.1 Candle bloom in `flame.css`
    - Extend `flame-flare` with a drop-shadow bloom that rises and settles inside the existing 500 ms. One luminance change, no repeat. Keep the `reduce` block that sets `animation: none` and keep the static drop-shadow.
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.7_
  - [x] 3.2 Ghost rise and rest in `ghost-layer.css`
    - `ghost-rise`: opacity 0 to 1 and a 16 px upward move, 800 ms ease-out, the label with the ghost. `ghost-fade`: opacity 1 to 0 with a 6 px sink, 700 ms ease-in, `forwards`. Keep the drift loop off under `reduce`, and keep `.ghost-art--leaving` instant-hidden under `reduce`.
    - No scale-up, no flash, no shake.
    - _Requirements: 4.1, 4.4, 4.6, 5.1, 5.4, 5.6_
  - [x] 3.3 Add `crypt-motion-css.test.ts`
    - Reuse `parseRules` from `crypt-css.test.ts`. Implement the five checks of the design's "Static CSS audit" over every Crypt_Style, with the ambient allowlist (`flame-flicker`, `ghost-drift`, `atmosphere-drift`).
    - Include detection tests with small CSS strings so a missing `reduce` rule, a duration above 1000 ms and an infinite moment each fail.
    - **Property 7: Every motion has a still equivalent**
    - **Validates: Requirements 10.1, 10.2, 10.4, 10.5, 10.9, 10.10**
    - _Requirements: 10.1, 10.2, 10.4, 10.5, 10.9, 10.10_
  - [x] 3.4 Add `haunting-stage-motion.test.tsx`
    - Render `ArtStage` the way `art-motion.test.tsx` does, with `matchMedia` mocked for reduced motion on and off. Assert: with no notice, the lit flame, light pass and ghost have no animation class (Static_Equivalent); with a `candleLit`, `ghostSpawned` or `ghostLaidToRest` notice they carry `flame--ignite`, `ghost-art--rise` or `ghost-art--leaving`; under reduced motion `data-parallax="off"` and the same classes are present, because CSS (task 3.3 and the Playwright tests) switches them off.
    - Assert the text equivalent: each state shows its name through `ghostName`, `lockName` or the live region text from `announcementsFor`, with the ghost return number in the DOM.
    - _Requirements: 3.3, 3.4, 4.2, 4.3, 4.7, 5.3, 10.8, 16.2_

- [x] 4. Moment_Selector (new file, unmounted)
  - [x] 4.1 Add `motion-moments.ts` and `motion-moments.test.ts`
    - Export `MotionMoment`, `selectMotionMoments(previous, next, notices)` and `announcementKeyFor(moment)` as in the design. Pure, read-only inputs, no reducer or Event import.
    - Unit tests with fixed notice lists: one test per moment kind, a notice the State does not agree with (dropped), an empty list, `previous === null`, `sealCracked`, `roomCleared` and `escaped` (no moment), two `ghostLaidToRest` in one dispatch (both returned, in order).
    - _Requirements: 5.6, 6.1, 6.2, 6.3, 6.5, 6.6, 6.12_
  - [x] 4.2 Write the selector properties (`motion-moments-properties.test.ts`)
    - Build runs by folding events through `initial` and `apply` on the shared manifest fixture builder in `packages/core/src/test-support/`, the way `runtime-ghosts-properties.test.ts` does. Add coverage counters so the test fails when no run reaches a ghost, a laid-to-rest or a lit candle.
    - [x] 4.2.1 Property 1: Moments pair with text
      - **Property 1: Moments pair with text**
      - **Validates: Requirements 6.7, 3.3, 4.3, 5.2**
    - [x] 4.2.2 Property 2: Order and unrelated notices
      - **Property 2: Order and unrelated notices**
      - **Validates: Requirements 6.8, 6.2**
    - [x] 4.2.3 Property 3: Rest follows rise
      - **Property 3: Rest follows rise**
      - **Validates: Requirements 6.9, 5.1**
    - [x] 4.2.4 Property 4: Quiet restore and quiet rejection
      - **Property 4: Quiet restore and quiet rejection**
      - **Validates: Requirements 6.5, 6.6, 3.4, 4.7**
    - [x] 4.2.5 Property 5: Selection agrees with State
      - **Property 5: Selection agrees with State**
      - **Validates: Requirements 6.3**
    - [x] 4.2.6 Property 6: No write
      - **Property 6: No write**
      - **Validates: Requirements 6.10, 6.11, 3.8**
  - [x] 4.3 Add `motion-moments-boundary.test.ts`
    - Read the source of every new non-test file in this spec and fail when it imports or names `apply`, `initial`, `dispatch`, an Event creator, `localStorage` or `fetch`.
    - Render each new Motion_Component with a State and notices, deep-compare State and Event_Log before and after, including after the animation end event.
    - _Requirements: 3.8, 6.10, 6.11_

- [x] 5. Autopsy parchment
  - [x] 5.1 Append the Autopsy_Parchment section to `final-door.css`
    - Pull first. Add the labelled section from the design: parchment page, ink text, title font on headings, 44 px buttons with `--ink-900` and `--parchment-100`, `--focus-ring-on-light`, `currentColor` icons, the fade under `no-preference` and the `:focus-within` stop. No `--candle-400` or `--ember-600` on the parchment. The file stays under 300 lines.
    - Run `crypt-css.test.ts`, `autopsy-view.test.tsx`, `final-door.test.tsx`, `final-door-section.test.tsx`.
    - _Requirements: 7.1, 7.3, 7.4, 7.6, 7.7, 7.8, 7.9, 7.10_
  - [x] 5.2 Add `autopsy-parchment.test.tsx`
    - Token contrast: `--ink-900` on `--parchment-100` (text), `--parchment-100` on `--ink-900` (buttons), `--ink-900` focus ring on `--parchment-100` (3:1 non-text).
    - Static CSS: the fade sits only under `no-preference`; `.autopsy-view:focus-within` sets `animation: none`; every `.autopsy-view button` has a 44 px floor; no `--candle-400` or `--ember-600` in an `.autopsy-view` rule.
    - Render `AutopsyView` as `autopsy-view.test.tsx` does: the heading, the five counts, every entry and the Play again button are in the DOM in the same order as before; no `[data-testid="atmosphere"]` with Lantern_Mode on or off.
    - _Requirements: 7.2, 7.3, 7.5, 7.8, 7.11, 9.2, 16.2, 16.3_

- [x] 6. Quill_Mark (new file, unmounted)
  - [x] 6.1 Add `quill-mark.tsx` and `quill-mark.css`
    - Inline SVG, tokens only, `aria-hidden="true"`, no focusable child, `pointer-events: none`, `pathLength="1"` stroke. Animations only under `no-preference`: stroke 900 ms, quill move 900 ms, both finite and `forwards`. It draws no text and reads no learner content.
    - Read `usePrefersReducedMotion` only to set `data-reduced-motion`; the CSS media query does the switching.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6, 8.7, 10.7_
  - [x] 6.2 Add `quill-mark.test.tsx`
    - Assert `aria-hidden`, no `tabindex` or focusable element, no text node, the finished stroke in the DOM at first render, the static CSS rules (`no-preference` only, at most 1000 ms, finite), and that the component follows a change of the reduced-motion preference while mounted.
    - Assert the file is imported by no existing module (it stays unmounted until Open_Decision 2).
    - _Requirements: 8.2, 8.5, 8.6, 8.7, 8.8, 10.7_

- [x] 7. Lantern, reduced-motion audit and copy
  - [x] 7.1 Add `lantern-screens.test.tsx`
    - For the room Stage, the final door Stage, the escape view and the Autopsy, with Lantern_Mode on and off: the overlay is absent when on; when off, every Text_Panel and Stage_Text sits above the overlay (by the CSS order test and by DOM order); switching the mode updates the Stage in the same render; `localStorage` holds only the `escape-the-crypt:lantern` key.
    - A Lantern_Mode run of the sample crypt through the existing flow helpers reaches the Autopsy with every Static_Equivalent and live-region text unchanged.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.7_
  - [x] 7.2 Add the report-only audit `outside-crypt-motion-audit.test.ts`
    - Parse every CSS file under `features/desk`, `features/dig`, `features/descent` and `features/start` with the audit of task 3.3 and read, without importing them, whether each screen's source calls `useLantern`. The test edits nothing and passes.
    - Print each finding as `file: selector: reason`. Copy the findings into the build log under "Haunting polish: Open_Decision 4 findings". Known today: `descent.css` fade without a `reduce` rule; the descent clip in Lantern_Mode when reduced motion is off; the desk, dig and descent screens have no mist or grain of their own.
    - _Requirements: 9.6, 10.6, 15.1_
  - [x] 7.3 Add `haunting-copy.test.ts`
    - Scan every file this spec adds (read the list from `scope-fence.test.ts`) for the Banned_Phrases, for "learning gains", "mastery", "exam-ready" and "100% accurate".
    - Assert the new files add no string that is shown to a learner (no JSX text node in `quill-mark.tsx`).
    - _Requirements: 11.1, 11.3, 11.4, 11.6_

- [x] 8. Checkpoint A: Vitest, typecheck, lint
  - Run `pnpm --filter @escape-the-crypt/web typecheck`, `pnpm lint`, and `vitest run --maxWorkers=50%` in `apps/web`. Do not run Playwright here.
  - Record the real results in the build log, including any failure. Fix failures that this spec caused; report any other failure and stop.
  - _Requirements: 16.12, 17.2_

- [ ] 9. Playwright tests
  - [x] 9.1 Add `e2e/haunting-moments.e2e.ts`
    - Run on `chromium`, `firefox` and `pixel` (the config's three projects). One `describe` per moment, each with `test.use({ reducedMotion: 'no-preference' })` and `test.use({ reducedMotion: 'reduce' })`, using the existing helpers in `crypt-helpers.ts`.
    - `candle-lit`: answer the first lock correctly. Motion on: computed `animationName` of `[data-flame="progress"][data-ignite="true"] .flame__body` is not `none`. Motion off: `none`, the flame is visible. Both: the live region holds the candle text.
    - `ghost-rises`: answer a lock wrong. Motion on: `[data-ghost][data-state="rising"]` has `animationName` `ghost-rise`. Motion off: `none`, the ghost and its return number are visible at once. Both: the ghost text in the live region.
    - `ghost-laid-to-rest`: wrong in the room, correct on the returned question at the final door. Motion on: `[data-state="leaving"]` has `ghost-fade`, then the ghost is gone. Motion off: gone at once. Both: the laid-to-rest text in the live region.
    - `autopsy-opens`: play to the escape and open the Autopsy. Motion on: `.autopsy-view` has `animationName` `autopsy-open`. Motion off: `none`, and every count and entry is visible.
    - Read names right after the triggering action and wait on `animationend` (1500 ms cap) for the end, not a fixed sleep. Tap instead of click on `pixel`.
    - Run one project at a time while writing: `playwright test e2e/haunting-moments.e2e.ts --project=chromium --workers=1`.
    - _Requirements: 3.1, 3.5, 4.1, 4.6, 5.1, 5.4, 7.7, 7.10, 10.3, 10.8, 16.5, 16.6, 16.7_
  - [ ] 9.2 Add `e2e/haunting-axe.e2e.ts`
    - axe scans: the room with the overlay present and Lantern_Mode off, the room in Lantern_Mode, the final door, and the Autopsy after the fade and with reduced motion on. Each reports no violations. Note in the test that axe marks text over images as incomplete, and point to `overlay-contrast.test.ts`.
    - _Requirements: 2.5, 7.12, 16.8_
  - [ ] 9.3 Add `e2e/haunting-input.e2e.ts`
    - `document.elementFromPoint` at the centre of each hotspot, panel button and seal returns that control, never an overlay part. A click and a key press reach the control with the overlay on.
    - Tab order of the room and the Autopsy equals DOM order, and focus is visible on every stop (`:focus-visible` outline from `--focus-ring` or `--focus-ring-on-light`).
    - No request to another origin, no AI provider call.
    - _Requirements: 2.2, 2.3, 10.9, 16.9, 16.10, 16.11_

- [ ] 10. Checkpoint B: full suites and build log
  - Run `vitest run --maxWorkers=50%` in `apps/web` and `packages/core` only if a shared helper changed (none is expected). Run `playwright test --workers=2` in `apps/web` with the port free.
  - Take one screenshot per moment with reduced motion on and off from the Playwright run and note each in `docs/build-log.md`. Record real counts and every failure.
  - Write the unmet Open_Decisions into the build log as "unmet, waits for confirmation".
  - _Requirements: 16.13, 17.2, 17.3, 17.4_

- [ ] 11. HOLD: Open_Decisions (all blocked until the user confirms each)
  - Nothing in this task runs without the user's go-ahead for that item. Add the confirmed path to the allowed list in `scope-fence.test.ts` in the same sub-task.
  - [ ] 11.1 Open_Decision 1: Lantern above the title and the desk (waits for confirmation)
    - Ask which option: render the title through `DeskHub` inside `CryptFlow`, or one `LanternProvider` in `main.tsx` with a nesting guard in `lantern-context.tsx`. Then edit only the named files.
    - Add a test that the title toggle and the crypt toggle write the same Lantern_Setting and read one value.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  - [ ] 11.2 Open_Decision 2: mount the Quill_Mark and toggles (waits for confirmation)
    - `autopsy-view.tsx`: import and mount `QuillMark` beside the heading and a `LanternToggle` with `ROOM_PLAY_LABELS.lanternToggle`. `final-door.tsx`: a `LanternToggle` in the escape view. Optionally move the Autopsy_Parchment section from `final-door.css` to `autopsy-view.css` with one import.
    - Re-run the Autopsy axe, tab-order and reduced-motion tests with the quill and toggle present, and extend `quill-mark.test.tsx` to assert the mount.
    - _Requirements: 8.8, 13.1, 13.2, 13.3, 13.4, 13.5_
  - [ ] 11.3 Open_Decision 3: mount the Moment_Selector in the Stage (waits for confirmation)
    - `art-stage.tsx`: call `selectMotionMoments` next to `artEffectsFrom` and write `data-moment` on the Stage root. Needs the previous State; if `art-stage.tsx` has only `notices`, report the one extra prop and stop.
    - Add a test that `data-moment` matches the selector for each moment and is empty for a restored State, and that it agrees with `artEffectsFrom`.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_
  - [ ] 11.4 Open_Decision 4: gaps outside the crypt feature (waits for confirmation)
    - Present the findings of task 7.2 and ask which to fix. For each confirmed gap, make the named edit and add its test in the same sub-task (for example `descent-gate.tsx` reading `useLantern`, and a `reduce` rule in `descent.css`). Ask separately whether mist and grain are wanted on the desk-side screens.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

- [ ] 12. Final report
  - Update `docs/build-log.md` with the final results, the unmet Open_Decisions and every real failure or limit found. Report to the user with the file list and the open questions.
  - _Requirements: 16.13, 11.4_

## Notes

- Test sub-tasks are not marked optional: Requirement 16 makes them mandatory.
- Each property test cites its design Property number and the requirements it validates. Property 7 is a static CSS check (task 3.3), not a fast-check test.
- Task 11 is a hard stop. Its four items are independent: the user may confirm one, several or none.
- Tasks 2.1, 3.1, 3.2 and 5.1 are the only tasks that edit existing files, and they edit stylesheets only.
- No task adds a learner-facing sentence, a dependency, a sound, a dev server or a watcher, and none calls an AI provider.
- If a task finds that an existing test depends on a value this spec changes (ghost opacity, overlay `z-index`), it stops and reports instead of editing that test.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1", "5.1", "6.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "3.2", "4.2.1", "4.2.2", "4.2.3", "4.2.4", "4.2.5", "4.2.6", "5.2", "6.2"] },
    { "id": 4, "tasks": ["3.3", "3.4", "4.3", "7.1", "7.3"] },
    { "id": 5, "tasks": ["7.2"] },
    { "id": 6, "tasks": ["8"] },
    { "id": 7, "tasks": ["9.1", "9.2", "9.3"] },
    { "id": 8, "tasks": ["10"] },
    { "id": 9, "tasks": ["11.1", "11.2", "11.3", "11.4"] },
    { "id": 10, "tasks": ["12"] }
  ]
}
```

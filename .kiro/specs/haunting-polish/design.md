# Design Document

## Overview

Haunting polish finishes the crypt's look and motion without touching game rules. Almost all of it is CSS on class hooks that already exist, plus two small new files: a pure Moment_Selector and a decorative Quill_Mark. Everything that would need an edit to an existing `.ts` or `.tsx` file is held back as an Open_Decision (Requirements 12 to 15).

Design rules, taken from the requirements and `design-system.md`:

- Text is always above the Atmosphere_Overlay or on a solid backing. The overlay never lowers a text contrast.
- A motion moment accompanies text that already exists. It reads State and notices and never writes either.
- Every animation is defined for `prefers-reduced-motion: no-preference`, or switched off for `reduce`. The Static_Equivalent is what the DOM holds before any animation starts.
- Each moment lasts at most 1000 ms, takes no pointer events and delays no dispatch.

## Architecture

### What exists and what changes

| Area | Today | This spec |
| --- | --- | --- |
| Overlay | `.atmosphere` and `.ghost-layer` are both `z-index: 5`; the overlay comes later in the DOM, so it paints over the ghost return number. | Overlay to `z-index: 4`. Ghost layer stays 5. Ghost label gets a solid backing. CSS only. |
| Candle | `flame--ignite` flare, `art-layer--fade-in` light pass, reduced-motion overrides. | Add a glow bloom on the ignite flare. CSS only. |
| Ghost rises | `ghost-art--rise`, 800 ms. | Make the rise gentler and the label fade with the ghost. CSS only. |
| Ghost laid to rest | `ghost-art--leaving`, 700 ms fade. | Add a small sink while fading. CSS only. |
| Autopsy | No stylesheet. | Parchment styles and a 600 ms fade, appended to `final-door.css` (see "Where the Autopsy CSS lives"). |
| Quill | None. | New `quill-mark.tsx` and `quill-mark.css`, unmounted until Open_Decision 2. |
| Moment selection | `artEffectsFrom(notices)` in `art-effects.ts`. | New pure `motion-moments.ts`, unmounted until Open_Decision 3. `art-effects.ts` stays as it is. |
| Lantern | Room and door Stage follow it; Autopsy and escape view have no toggle; title is outside the provider. | Tests for what holds. Open_Decisions 1, 2 and 4 for the rest. |

### Scope fence

Allowed: existing and new `.css` under `features/crypt/`; new `.ts` and `.tsx` files under `features/crypt/` (the Motion_Components and tests); `.kiro/specs/haunting-polish/`; one line per task in `docs/build-log.md`.

Not allowed: every Frozen_File of the glossary, every existing `.ts`/`.tsx` under `features/crypt/`, and everything under `features/desk`, `features/dig`, `features/descent`, `features/start`, `app.tsx` and `main.tsx`, until the user confirms an Open_Decision that names the file.

`scope-fence.test.ts` (new) runs `git diff --name-only <merge-base>` and fails on a path outside the allowed list. It reads a single constant list, so confirming an Open_Decision means adding the confirmed path to that list in the same task.

### Stacking order inside the Stage

```
back
  art layers (background, locks, light passes, door)      z auto
  flames (.art-stage__flames)                              z auto
  foreground art                                           z auto
  Atmosphere_Overlay (.atmosphere)                         z 4   darkness, mist, vignette, grain
  GhostLayer (.ghost-layer): ghosts, labels, spirit flames z 5   labels sit on a solid backing
  controls layer (.art-stage__controls)                    z 10  hotspots, seals, notes
front
```

Flames stay under the overlay on purpose: the darkness thins as candles light, so a lit candle brightens the room. Ghosts and their labels move above the overlay so that no Stage_Text is dimmed. Only `atmosphere-layer.css` (one number) and `ghost-layer.css` change for this.

Why the order matters, as a number: composite `--bone-50` text under darkness at lit fraction 0 (opacity 0.4 of `--stone-950`) and the vignette at the Stage edge (opacity 0.6 of `--stone-950`). The text keeps about 24% of its own colour, which gives a ratio near 2:1 on `--stone-950`. The same text above the overlay on a `--stone-950` backing is well above 4.5:1. The contrast test records both cases.

axe cannot read contrast through images, so it reports those nodes as "incomplete". The token-based contrast test is therefore the contrast check, and axe checks names, roles and focus.

## Components and Interfaces

### CSS changes by file

All values use tokens. `crypt-css.test.ts` already fails on colour literals, on `@import` and on other font families, so new CSS must pass it.

#### `atmosphere-layer.css`

- `.atmosphere { z-index: 4; }`.
- The mist keeps its slow drift (90 s, alternate). It is wrapped so the animation exists only under `no-preference`, and `reduce` holds the resting position.
- Grain and vignette are static, so they need no motion rule.
- A comment lists the maximum opacities (darkness 0.4, vignette 0.6, grain 0.04, mist 0.08). `overlay-contrast.test.ts` reads them from this file.

#### `ghost-layer.css`

- `.ghost-art { opacity: 1; }`, with the 0.55 fill opacity of `.ghost-art__shape` carrying the translucent look, so the label is not dimmed at rest.
- `.ghost-art::after` gets `background: var(--stone-950)`, `padding: 0 0.375rem` and `color: var(--bone-50)`.
- `ghost-rise`: from `opacity: 0` and a 16 px offset to rest, 800 ms ease-out, the label fading with the ghost.
- `ghost-fade` (laid to rest): opacity 1 to 0 with a 6 px sink, 700 ms ease-in, `forwards`.
- `ghost-drift` stays an ambient loop (4 s, alternate, 4 px) and stays off under `reduce`.
- Existing `.ghost-art--rise` and `.ghost-art--leaving` stay the only hooks. The Playwright tests read them.

#### `flame.css`

- The ignite flare (500 ms) gets a drop-shadow bloom that grows and settles in the same keyframes, then hands over to the flicker. It changes the flame's luminance once.
- `reduce` already sets `animation: none` for `.flame__body` and `.flame--ignite .flame__body`. The static flame keeps its drop-shadow, so a lit candle still differs from an unlit lock without motion.

#### `art-stage.css`

- No change to the light-pass fade (600 ms) or the door fade. A static test confirms both are covered by the `reduce` block.

#### `final-door.css`: Autopsy_Parchment

The Autopsy rules go in a labelled section at the end of `final-door.css` (about 110 lines; the file stays under 300).

```css
/* Autopsy: parchment page, ink text. Tokens only. */
.autopsy-view { background: var(--parchment-100); color: var(--ink-900); font-family: var(--font-body); ... }
.autopsy-view h2, .autopsy-view h3 { font-family: var(--font-title); }
.autopsy-view button { min-width: 44px; min-height: 44px; background: var(--ink-900); color: var(--parchment-100); ... }
.autopsy-view button:focus-visible { outline: var(--focus-ring-on-light); outline-offset: var(--focus-offset); }
.autopsy-icon { color: inherit; }
@media (prefers-reduced-motion: no-preference) {
  .autopsy-view { animation: autopsy-open 600ms ease-out backwards; }
  .autopsy-view:focus-within { animation: none; }
}
@keyframes autopsy-open { from { opacity: 0; } to { opacity: 1; } }
```

The fade is under `no-preference` only, so a browser that cannot match the query, or one with reduced motion, shows the page at once. `:focus-within` ends the fade the moment focus enters, which satisfies Requirement 7.9.

Where the Autopsy CSS lives: a new `autopsy-view.css` would need one `import` line in `autopsy-view.tsx`, and `crypt-css.test.ts` forbids `@import` in any Crypt_Style. An existing stylesheet that the bundle already loads is the only route inside the fence. `final-door.css` is the nearest fit because the Autopsy ends the final door flow and embeds the Final_Door_Section. If the user confirms Open_Decision 2, the section can move to `autopsy-view.css` in the same task that adds the import.

Parchment contrast pairs, checked by token: `--ink-900` on `--parchment-100` (text, icons, focus ring), `--parchment-100` on `--ink-900` (button text), `--focus-ring-on-light` (`--ink-900`) on `--parchment-100` (non-text 3:1). No `--candle-400` or `--ember-600` on the parchment.

#### `quill-mark.css` (new)

- `.quill-mark` is `position: absolute` in the Autopsy heading margin, `pointer-events: none`, no focusable child.
- `.quill-mark__stroke` uses `pathLength="1"`, `stroke-dasharray: 1` and `stroke-dashoffset: 0` at rest (the finished stroke).
- Under `no-preference`: `quill-write` animates the offset from 1 to 0 over 900 ms, and `quill-nib` moves the quill by a short `transform` over the same time. Both are finite and `forwards`.
- Under `reduce` nothing is declared, so the finished stroke and the resting quill draw.

### The Moment_Selector (`motion-moments.ts`, new)

```ts
export type MotionMoment =
  | { readonly kind: 'candle-lit'; readonly target: { readonly type: 'slot'; readonly slotId: string } | { readonly type: 'spirit' } }
  | { readonly kind: 'ghost-rises'; readonly conceptId: string }
  | { readonly kind: 'ghost-laid-to-rest'; readonly conceptId: string };

export function selectMotionMoments(
  previous: State | null,
  next: State,
  notices: readonly Outcome_Notice[],
): readonly MotionMoment[];
```

Algorithm, in notice order, one pass:

1. No notices, or `previous === null`: return an empty list. A restored run, a reload and a rejected dispatch (same State, no notices) all end here.
2. `candleLit` for a slot: keep it when the slot is `candleLit` in `next` (looked up in every room's `lockSlots`). For a Spirit_Candle: keep it when the spirit candle count of `next` is greater than that of `previous`.
3. `ghostSpawned`: keep it when `next.ghosts` holds a pending ghost for the concept.
4. `ghostLaidToRest`: keep it when `next.ghosts` holds no pending ghost for the concept.
5. Every other notice kind gives nothing.

The function takes read-only inputs, reads no clock, randomness or DOM, and imports only types and read-only selectors from `@escape-the-crypt/core`. It imports no reducer, no `apply`, no Event creator. `motion-moments-boundary.test.ts` greps the source of every new file for those names.

`announcementKeyFor(moment)` returns the `ROOM_ANNOUNCEMENT_COPY.notice` key a moment accompanies (`candleLit`, `ghostSpawned` or `ghostLaidToRest`). It exists so the pairing property can be written without a second copy of the mapping.

The `autopsy-opens` moment is not in the selector. The Autopsy opens by a learner action, with no dispatch and no notice, so it plays on mount: CSS for the parchment, and the Quill_Mark once mounted.

#### Relationship to `artEffectsFrom`

`artEffectsFrom(notices)` stays the source of the animation classes while Open_Decision 3 is open. The selector is written and tested beside it. If the user confirms, `art-stage.tsx` calls the selector next to `artEffectsFrom` and writes `data-moment` on the Stage root, so tests can read which moment played without parsing classes. A test then asserts the two agree (the set of lit slots, spawned concepts and laid-to-rest concepts), so the old and new derivations cannot drift.

### Reduced motion and Lantern

- Reduced_Motion_Signal: CSS reads the media query. React code reads `usePrefersReducedMotion`. There is one signal.
- Lantern_Mode only controls whether the Atmosphere_Overlay is mounted. It does not switch motion off, because under reduced motion it starts on and the learner can turn it off to get the overlay back while motion stays reduced. This is the existing behaviour and the tests assert it.
- Static_Equivalents, per moment:

| Moment | Motion | Static_Equivalent | Text it accompanies |
| --- | --- | --- | --- |
| `candle-lit` | flare, bloom, 600 ms light pass | steady gold flame and the light pass at once | `ROOM_ANNOUNCEMENT_COPY.notice.candleLit` |
| `ghost-rises` | fade and drift up, 800 ms | ghost and its return number at its anchor | `...notice.ghostSpawned` |
| `ghost-laid-to-rest` | fade and sink, 700 ms | no ghost of that concept | `...notice.ghostLaidToRest` |
| `autopsy-opens` | parchment fade 600 ms, quill stroke 900 ms | whole page and finished stroke | the Autopsy heading and its text |

- Flicker and drift loops are ambient, not moments. Under `reduce` they are off.
- No animation sets `visibility: hidden` or `display: none` at its start, so a missed animation never hides content.

### Static CSS audit (`crypt-motion-css.test.ts`, new)

Reuses `parseRules` from `crypt-css.test.ts` (it is exported). For every Crypt_Style it checks:

1. Every `animation`, `animation-name` or `transition` with a non-zero duration has a rule inside `@media (prefers-reduced-motion: reduce)` for the same selector that sets `animation: none` or `transition: none`, or the declaration sits inside `@media (prefers-reduced-motion: no-preference)`.
2. Every `@keyframes` that starts at `opacity: 0` is used by a selector whose resting style is visible, so the Static_Equivalent shows without the animation.
3. Every animation attached to a Motion_Moment class has a finite iteration count and a duration of at most 1000 ms. Ambient loops (`flame-flicker`, `ghost-drift`, `atmosphere-drift`) are listed by name in an allowlist.
4. No animation targets a property outside `opacity`, `transform`, `filter`, `stroke-dashoffset`, `clip-path` and `background-position`.
5. No `animation-iteration-count` above 1 on a moment, which also bounds flashes to one luminance change per moment.

The same parser, pointed at `features/desk`, `features/dig` and `features/descent`, runs as a report-only test. It writes the findings to the test output and passes. Each finding feeds Open_Decision 4.

## Data Models

The spec adds no stored data and no schema. Its one new type is the `MotionMoment` union under "The Moment_Selector". It lives in memory for one render, is never written to IndexedDB or `localStorage`, and holds no learner text: only slot IDs, concept IDs and the moment kind. The Lantern_Setting stays the only `localStorage` value, under its existing key.

## Testing Strategy

### Test design

| Test | File (new) | Kind |
| --- | --- | --- |
| Scope fence | `scope-fence.test.ts` | unit, git diff |
| Stacking order and overlay opacities | `overlay-stacking.test.ts` | static CSS |
| Contrast, as drawn and negative control | `overlay-contrast.test.ts` | unit, token math from `desk-contrast.test.ts` |
| Moment_Selector | `motion-moments.test.ts` | unit |
| Selector properties | `motion-moments-properties.test.ts` | fast-check, 100 runs each |
| Boundary and no-write | `motion-moments-boundary.test.ts` | static source and render |
| CSS motion audit | `crypt-motion-css.test.ts` | static CSS |
| Autopsy parchment | `autopsy-parchment.test.tsx` | component + token contrast |
| Quill_Mark | `quill-mark.test.tsx` | component |
| Lantern per screen | `lantern-screens.test.tsx` | component |
| Copy scan | `haunting-copy.test.ts` | static |
| Moments, three projects | `e2e/haunting-moments.e2e.ts` | Playwright |
| Axe with overlay | `e2e/haunting-axe.e2e.ts` | Playwright + axe |
| Overlay does not intercept input | `e2e/haunting-input.e2e.ts` | Playwright |

#### Playwright design

`haunting-moments.e2e.ts` runs on the `chromium`, `firefox` and `pixel` projects. Each moment gets one `describe` with two tests, using `test.use({ reducedMotion: 'reduce' | 'no-preference' })`. The existing helpers (`enterCrypt`, `answerSlot`, `correctAnswerFor`, `waitForArtStage`) drive the sample crypt, as `crypt-motion.e2e.ts` does.

| Moment | Setup | Motion on | Motion off (reduce) |
| --- | --- | --- | --- |
| `candle-lit` | answer the first lock correctly | `[data-flame="progress"][data-ignite="true"] .flame__body` has computed `animationName` that is not `none`; the live region holds the candle text | `animationName` is `none`; the flame is visible; the live region holds the same text |
| `ghost-rises` | answer a lock wrong | `[data-ghost][data-state="rising"]` has `animationName` `ghost-rise`; its return number is visible; live region text | `animationName` `none`; ghost visible at once with its number; same text |
| `ghost-laid-to-rest` | wrong in the room, correct on the returned question at the final door | `[data-state="leaving"]` has `ghost-fade`, then the ghost is gone | the ghost is gone at once; same text |
| `autopsy-opens` | play to the escape and open the Autopsy | `.autopsy-view` computed `animationName` `autopsy-open` | `none`; every count and entry visible at once |

Animation names are read with `getComputedStyle(...).animationName`, which Chromium, Firefox and Pixel's Chromium report the same way. Where a test needs to wait for the end, it waits for `animationend` through `page.evaluate`, with a 1500 ms cap, instead of a fixed sleep.

`haunting-axe.e2e.ts` scans the room (overlay present, Lantern_Mode off), the room in Lantern_Mode, the final door and the Autopsy after the fade. `haunting-input.e2e.ts` checks `document.elementFromPoint` at the centre of each hotspot, panel button and seal returns that control and not an overlay part, and tabs through the room and the Autopsy comparing the order with the DOM order.

The pixel project uses touch emulation, so the click checks use `tap`.

#### Cost

During a task: `vitest run <file>` for the new and the importing files, one Playwright file on one project. Checkpoints: `vitest run --maxWorkers=50%` for `apps/web` (and `packages/core` only if a shared helper changed, which this spec does not do), then `playwright test --workers=2`. No dev server is started; the Playwright config builds and previews by itself.

## Correctness Properties

### Property 1: Moments pair with text
*For any* Accepted_Dispatch in a generated run, every Motion_Moment selected has its announcement text in `announcementsFor(previous, next, notices)`.
**Validates: Requirements 6.7, 3.3, 4.3, 5.2**

### Property 2: Order and unrelated notices
*For any* list of notices, the selector keeps notice order, and inserting or removing notices of kinds `sealCracked`, `roomCleared` or `escaped` gives the same list.
**Validates: Requirements 6.8, 6.2**

### Property 3: Rest follows rise
*For any* generated run, each `ghost-laid-to-rest` for a concept has an earlier `ghost-rises` for that concept.
**Validates: Requirements 6.9, 5.1**

### Property 4: Quiet restore and quiet rejection
*For any* State and notices, `selectMotionMoments(null, state, notices)` is empty, and a rejected dispatch (same State, no notices) gives an empty list.
**Validates: Requirements 6.5, 6.6, 3.4, 4.7**

### Property 5: Selection agrees with State
*For any* Accepted_Dispatch, a `candle-lit` target is lit in the next State, a `ghost-rises` concept has a pending ghost, and a `ghost-laid-to-rest` concept has none.
**Validates: Requirements 6.3**

### Property 6: No write
*For any* generated run, calling the selector at every step leaves State and Event_Log deep-equal to a run that never called it.
**Validates: Requirements 6.10, 6.11, 3.8**

### Property 7: Every motion has a still equivalent
*For any* animation in a Crypt_Style, a `reduce` rule switches it off or it sits under `no-preference`, it has a finite count and a duration of at most 1000 ms unless it is a named ambient loop.
**Validates: Requirements 10.1, 10.2, 10.4, 10.9**

Runs are generated by folding `eventArb`-style events through `initial` and `apply` on the shared manifest fixture builder in `packages/core/src/test-support/`, the way `runtime-ghosts-properties.test.ts` does. The new files import those helpers and add nothing to `packages/core`. Each property test runs at least 100 iterations and carries the comment `Feature: haunting-polish, Property N: <title>`. Property 7 is a static check over parsed CSS, not a fast-check test.

## Error Handling

- A missing or throwing `matchMedia`: `usePrefersReducedMotion` returns false, and the CSS media query still decides. No motion component throws.
- A notice for a slot or concept the next State does not hold: the selector drops it. The Stage still draws from State.
- A failed art image: unchanged. `art-failure-log.ts` still logs the file name and error type only, and the overlay, flames and ghosts still draw.
- A browser without `plus-lighter`: unchanged fallback to `screen`.
- A stylesheet that fails to load: the DOM already holds the Static_Equivalent and every text, so the screen stays readable and playable.
- A throwing `localStorage`: unchanged. Lantern_Mode stays for the session and no error shows.

## Open Decisions and what waits

| ID | Gap | Smallest edit | Needs the user to say |
| --- | --- | --- | --- |
| OD1 (Req 12) | Title and desk are outside `LanternProvider`. | Route the title through `DeskHub` inside `CryptFlow`, or one `LanternProvider` in `main.tsx` plus a nesting guard in `lantern-context.tsx`. | which option, and that front-of-house wiring has landed |
| OD2 (Req 13) | No quill and no toggle on the Autopsy; no toggle on the escape view. | `autopsy-view.tsx`: import and mount `QuillMark` and `LanternToggle`. `final-door.tsx`: mount `LanternToggle` in the escape view. | go-ahead for those two files |
| OD3 (Req 14) | The selector has no consumer. | `art-stage.tsx`: call the selector, write `data-moment`. | go-ahead for `art-stage.tsx` |
| OD4 (Req 15) | Gaps outside the crypt feature, found by the report-only audit. | Per finding, for example `descent-gate.tsx` reading `useLantern`, `descent.css` reduced-motion rule. | the list, after the audit, and per-gap go-ahead |

Until each is confirmed, its tasks stay unchecked. The CSS parts of this spec do not depend on any of them.

## Risks

- **Opacity 1 for the ghost at rest.** Existing ghost tests may assert 0.85. The first task of that phase reads them; any assertion about the old value changes in the same task and the build log records it.
- **Overlay z-index 4.** Any test that asserts `z-index: 5` on `.atmosphere` changes with it. `lantern-motion.test.tsx` is the likely one; it is edited only by a new test file (Requirement 16.12), so if it fails, the task stops and reports instead of editing it.
- **`final-door.css` as host.** If another machine edits that file, the append conflicts. The task pulls first and reports a conflict without resolving it.
- **`animationName` in Firefox.** Firefox reports `none` for an animation that has already finished with `fill-mode: none`. The tests read the name right after the triggering action and wait on `animationend` for the rest.
- **Audit scope.** The report-only audit reads CSS from `desk`, `dig` and `descent`. It edits nothing, so it cannot collide with the front-of-house machine.

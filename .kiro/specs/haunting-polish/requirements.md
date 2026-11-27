# Requirements Document

## Introduction

Haunting polish is spec 5 of Escape the Crypt. It finishes the look and motion of the crypt: the atmosphere overlay (mist, grain, vignette), three motion moments that carry learning meaning (a candle lights, a ghost rises, a ghost is laid to rest), the Autopsy as parchment with a writing effect, Lantern_Mode on every screen, and reduced motion everywhere. Every spooky element must carry learning meaning, so each motion moment accompanies a result the learner already reads as text and never replaces it.

This spec is a polish pass over code that already exists. What the code already does, found by reading it:

- `AtmosphereLayer` (`atmosphere-layer.tsx/.css`) already draws darkness, vignette, grain and mist at `z-index: 5`, with `pointer-events: none` and `aria-hidden`. `ArtStage` does not mount it in Lantern_Mode.
- `GhostLayer` is also `z-index: 5` and comes before `AtmosphereLayer` in the DOM, so the overlay paints over the ghost return-number label (`.ghost-art::after`, bone text drawn on art). That is text under the overlay, and Requirement 2 closes it.
- `Flame`, `GhostLayer` and `art-stage.css` already carry the candle flare (`flame--ignite`, `art-layer--fade-in`), the ghost rise (`ghost-art--rise`) and the ghost fade (`ghost-art--leaving`). `artEffectsFrom(notices)` already derives them from Outcome_Notices. The reduced-motion overrides exist in each stylesheet.
- `AutopsyView` has no stylesheet at all. Its class names (`autopsy-view`, `autopsy-counts`, `autopsy-entry`, `autopsy-icon`) are free hooks for CSS. It has no Lantern toggle and no motion.
- `LanternProvider` lives inside `CryptFlow`. The title at `/` in `app.tsx` is outside it. The desk screens (`features/desk`, `features/dig`, `features/descent`) already read `useLantern`, but `app.tsx` does not mount them yet.
- `FinalDoor` shows the Lantern toggle only while the learner is at the door. The escape view and the Autopsy have none.
- `descent.css` has an animation with no reduced-motion rule. `DescentGate` draws nothing at all under reduced motion, so the rule is not needed there today.

Hard limits on the files this spec may change are in Requirement 1. Goals that cannot be met inside those limits are written as Open_Decision requirements (Requirements 12 to 15). Implementation of those parts waits for the user's confirmation.

## Glossary

- **Haunting_Polish**: The feature specified here.
- **Crypt_Styles**: CSS files under `apps/web/src/features/crypt/`, existing or new.
- **Motion_Components**: New `.ts` and `.tsx` files created under `apps/web/src/features/crypt/` by this spec. An existing `.ts` or `.tsx` file is not a Motion_Component.
- **Frozen_Files**: Everything the user excluded: `packages/core/src/pipeline/**`, `packages/core/src/checks/**`, `packages/core/src/mapper/**`, `packages/core/src/authoring/**`, `apps/worker/**`, `eval/**`, `apps/web/src/state/**`, and in `apps/web/src/features/crypt/`: `room-screen.tsx`, `art-room.ts`, `question-controls.tsx`, `rune-cipher-panel.tsx`, `room-panel.tsx`, `lock-panel-context.ts`, `lock-panel-registry.ts`, `bone-ordering-panel.tsx`, `bound-threads-panel.tsx`, `combination-dial-panel.tsx` and `cursed-object-panel.tsx`.
- **Open_Decision**: A requirement that needs an edit outside Crypt_Styles and Motion_Components. It states the smallest edit, and its implementation tasks stay blocked until the user confirms.
- **Stage**: The `ArtStage` element (`.art-stage`), which holds the art layers, flames, ghosts, the Atmosphere_Overlay and the controls layer. `DoorStage` draws the same Stage for the final door and the escape view.
- **Atmosphere_Overlay**: The `.atmosphere` element and its four parts: darkness, mist, vignette and grain.
- **Stage_Text**: Any text drawn inside the Stage that is not a native control: the ghost return number, and the "Challenged: excluded from score" note.
- **Text_Panel**: A Question_Panel, Evidence_Panel, Autopsy section, Final_Door_Section, button or other element whose text the learner must read.
- **Contrast_Rule**: Text contrast of at least 4.5:1 for body text and 3:1 for large text, and 3:1 for non-text indicators, against the actual background (`design-system.md`, WCAG 2.2 AA). `desk-contrast.test.ts` is the existing example of how this repository checks it.
- **Motion_Moment**: One of `candle-lit`, `ghost-rises`, `ghost-laid-to-rest` or `autopsy-opens`.
- **Moment_Selector**: A pure function in a Motion_Component file that maps an accepted dispatch to the ordered list of Motion_Moments it caused.
- **Accepted_Dispatch**: A dispatch the Runtime applied. It gives a new State and zero or more Outcome_Notices. A rejected dispatch gives the same State and no notices.
- **Outcome_Notice**: A runtime notice of kind `candleLit`, `ghostSpawned`, `ghostLaidToRest`, `sealCracked`, `roomCleared` or `escaped`.
- **Announcement_Text**: The message that `announcementsFor` puts in the polite live region for an Outcome_Notice, taken from `ROOM_ANNOUNCEMENT_COPY` in `packages/core/src/copy.ts`.
- **Reduced_Motion_Signal**: The browser preference `prefers-reduced-motion: reduce`, read in CSS by media query and in React by `usePrefersReducedMotion`. No other in-app motion setting exists.
- **Lantern_Mode**: The accessibility setting that removes the Atmosphere_Overlay and shows everything fully lit. It is on by default under the Reduced_Motion_Signal. It does not turn motion off by itself, so a learner can keep a reduced-motion browser and still choose the overlay.
- **Static_Equivalent**: The state a Motion_Moment ends in: the lit flame, the ghost with its return number, the absent ghost, the fully shown Autopsy. Under the Reduced_Motion_Signal the Static_Equivalent is drawn at once.
- **Autopsy_Parchment**: The Autopsy view styled as `--parchment-100` paper with `--ink-900` text, using the class hooks of `AutopsyView`.
- **Quill_Mark**: A new decorative Motion_Component that draws a quill and an ink stroke while the Autopsy opens.
- **Moment_Duration_Cap**: 1000 ms, the longest a Motion_Moment may run (`design-system.md`: a transition never blocks input for more than 1 s).
- **Banned_Phrases**: The strings in `BANNED_COPY_PHRASES` in `packages/core/src/copy.ts`, plus "learning gains", "mastery", "exam-ready" and "100% accurate".
- **Checkpoint**: A task that runs the full Vitest suite with `--maxWorkers=50%` or the full Playwright suite with `--workers=2`.

## Requirements

### Requirement 1: Scope fence and coordination

**User Story:** As the owner of the parallel work, I want this spec to touch only styles and new motion files, so that no other machine's edits collide with it.

#### Acceptance Criteria

1. THE Haunting_Polish SHALL change only Crypt_Styles, Motion_Components, test files and files under `.kiro/specs/haunting-polish/`, plus one new line per spec task in `docs/build-log.md`.
2. THE Haunting_Polish SHALL leave every Frozen_File unchanged.
3. THE Haunting_Polish SHALL leave `apps/web/src/features/desk/`, `apps/web/src/features/dig/`, `apps/web/src/features/descent/`, `apps/web/src/features/start/`, `apps/web/src/app.tsx` and `apps/web/src/main.tsx` unchanged.
4. THE Haunting_Polish SHALL leave every existing `.ts` and `.tsx` file under `apps/web/src/features/crypt/` unchanged, except where the user has confirmed an Open_Decision that names that file.
5. WHEN a goal of this spec needs an edit outside criteria 1 to 4, THE Haunting_Polish SHALL record that goal as an Open_Decision in Requirements 12 to 15 and SHALL NOT make the edit.
6. THE Haunting_Polish SHALL include a test that reads the git diff of the branch and fails when a changed path is a Frozen_File or lies outside the paths allowed by criterion 1.
7. WHILE an Open_Decision is unconfirmed, THE Haunting_Polish SHALL keep every task that implements it unchecked and marked "waits for confirmation".
8. THE Haunting_Polish SHALL add no runtime dependency and no animation library to `apps/web/package.json`.

### Requirement 2: Atmosphere overlay never lowers text contrast

**User Story:** As a learner, I want the mist, grain and vignette to add mood without making anything harder to read, so that I can always read my questions and the ghost labels.

#### Acceptance Criteria

1. THE Atmosphere_Overlay SHALL draw its mist, grain and vignette in code from tokens, with no image file and no colour literal outside `tokens.css`.
2. THE Atmosphere_Overlay SHALL have `pointer-events: none` on the container and on every part, and SHALL carry `aria-hidden="true"`.
3. THE Atmosphere_Overlay SHALL paint below the Stage controls layer, so that no Hotspot_Button, seal, panel or note is covered by it.
4. THE Haunting_Polish SHALL paint every Stage_Text above the Atmosphere_Overlay, or on a solid `--stone-950` or `--stone-800` backing that lies above the Atmosphere_Overlay, so that the overlay does not change the colour of any Stage_Text or its backing.
5. THE Haunting_Polish SHALL meet the Contrast_Rule for the ghost return number and for the "Challenged: excluded from score" note as drawn, each on its own solid backing that paints above the Atmosphere_Overlay.
6. THE Atmosphere_Overlay SHALL use only opacity, `background-position` and CSS variables to change over time, and SHALL cause no React re-render by itself.
7. THE Atmosphere_Overlay SHALL cause no flashing, no pulse brighter than the resting overlay, and no shake.
8. WHILE Lantern_Mode is on, THE Stage SHALL mount no Atmosphere_Overlay and SHALL show every layer fully lit.
9. WHILE the Reduced_Motion_Signal is on, THE Atmosphere_Overlay SHALL hold the mist still at its resting position, and WHILE Lantern_Mode is off the resting mist, grain and vignette SHALL still draw.
10. THE Haunting_Polish SHALL ship a unit test that computes the Contrast_Rule for every Stage_Text colour pair from `tokens.css` as drawn, and a negative-control case that composites the same text under the maximum overlay opacities read from the stylesheet (darkness at lit fraction 0 plus vignette at the Stage edge) and asserts that the result falls below 4.5:1, so that the test proves why the text must paint above the overlay.
11. THE Haunting_Polish SHALL ship a unit test that asserts, from the stylesheets, that the stacking order is art, then flames and ghosts, then the Atmosphere_Overlay, then Stage_Text, then the controls layer.

### Requirement 3: Candle moment

**User Story:** As a learner, I want a correct answer to bring a candle into the light, so that I can see my progress as well as read it.

#### Acceptance Criteria

1. WHEN the Runtime exposes a `candleLit` Outcome_Notice for a Lock_Slot, THE Stage SHALL light that lock's flame with a flare and a gold glow that finishes within the Moment_Duration_Cap.
2. WHEN the Runtime exposes a `candleLit` Outcome_Notice for a Spirit_Candle, THE Stage SHALL light that flame with the same flare as criterion 1.
3. THE candle Motion_Moment SHALL accompany the Announcement_Text for the `candleLit` notice, and SHALL NOT be the only place the lit state appears.
4. THE Stage SHALL draw a candle that State already holds as lit as its Static_Equivalent at once, with no flare and no fade, so that a drawing depends on State alone.
5. WHILE the Reduced_Motion_Signal is on, THE Stage SHALL draw the lit flame and its light pass at once with no flare, no flicker and no fade, and the lit flame SHALL still be visibly different from an unlit lock.
6. THE candle Motion_Moment SHALL use gold (`--candle-400`) only for lit candles and SHALL NOT draw a teal flame.
7. THE candle Motion_Moment SHALL change the luminance of the lit area at most once, with no more than three luminance changes in any one second.
8. THE candle Motion_Moment SHALL NOT change State, dispatch an Event or change which control has focus.

### Requirement 4: Ghost rises

**User Story:** As a learner who missed an idea, I want to see that idea's ghost appear, so that I know it will come back and where to find it.

#### Acceptance Criteria

1. WHEN the Runtime exposes a `ghostSpawned` Outcome_Notice, THE Stage SHALL show the ghost of that concept rising to its Ghost_Anchor in no more than the Moment_Duration_Cap.
2. THE rising ghost SHALL carry its return number as text, so that the ghost is not told by colour or shape alone.
3. THE ghost Motion_Moment SHALL accompany the Announcement_Text for the `ghostSpawned` notice, and the Stage SHALL announce nothing extra.
4. THE ghost Motion_Moment SHALL be gentle: a fade and a small upward drift only, with no sudden scale-up, no flash, no sound and no shake, in line with `tone.md`.
5. THE ghost SHALL keep `pointer-events: none` and SHALL NOT cover a Hotspot_Button, a Question_Panel or an Evidence_Panel.
6. WHILE the Reduced_Motion_Signal is on, THE Stage SHALL draw the ghost at its anchor at once, with its return number and without drift.
7. WHEN State already holds a pending ghost and no `ghostSpawned` notice arrives, THE Stage SHALL draw the ghost at once as its Static_Equivalent.

### Requirement 5: Ghost is laid to rest

**User Story:** As a learner who answers a returning question correctly, I want to see the ghost laid to rest, so that I know that idea is settled for now.

#### Acceptance Criteria

1. WHEN the Runtime exposes a `ghostLaidToRest` Outcome_Notice, THE Stage SHALL fade that ghost out in no more than the Moment_Duration_Cap and then remove it from the drawing.
2. THE ghost-laid-to-rest Motion_Moment SHALL accompany the Announcement_Text for the `ghostLaidToRest` notice.
3. WHEN the ghost has left, THE Stage SHALL leave no ghost of that concept and return number in the drawing, so that the Static_Equivalent matches State.
4. WHILE the Reduced_Motion_Signal is on, THE Stage SHALL remove the ghost at once.
5. THE ghost-laid-to-rest Motion_Moment SHALL keep the order of the other ghosts and their anchors unchanged.
6. IF two `ghostLaidToRest` notices arrive in one Accepted_Dispatch, THEN THE Stage SHALL fade both ghosts together.

### Requirement 6: Motion moments are read from the Runtime and never write to it

**User Story:** As a builder, I want one pure selector to decide which Motion_Moments play, so that I can test the rule without a browser and know motion cannot change the game.

#### Acceptance Criteria

1. THE Moment_Selector SHALL be a pure function: the same previous State, next State and Outcome_Notices always give the same ordered list of Motion_Moments, with no timer, no randomness, no I/O and no reading of the DOM.
2. THE Moment_Selector SHALL map `candleLit` to `candle-lit`, `ghostSpawned` to `ghost-rises` and `ghostLaidToRest` to `ghost-laid-to-rest`, and SHALL map every other Outcome_Notice to no Motion_Moment.
3. THE Moment_Selector SHALL select a Motion_Moment only when the next State agrees with the Outcome_Notice: a `candle-lit` needs the named lock or Spirit_Candle lit in the next State, a `ghost-rises` needs a pending ghost of that concept in the next State, and a `ghost-laid-to-rest` needs no pending ghost of that concept in the next State.
4. THE `autopsy-opens` Motion_Moment SHALL NOT come from the Moment_Selector, because the Autopsy opens by a learner action that is not a dispatch, and SHALL play when the Autopsy mounts, with the Autopsy heading and its text as its text equivalent.
5. IF a dispatch is rejected, THEN THE Moment_Selector SHALL return an empty list.
6. WHEN State is drawn with no Accepted_Dispatch, such as after a reload or a restore, THE Moment_Selector SHALL return an empty list, so that a restored run draws Static_Equivalents only.
7. FOR ALL Accepted_Dispatches, every Motion_Moment in the selector's result SHALL have a matching Announcement_Text in `announcementsFor(previous, next, notices)`, so that no Motion_Moment plays without its text (property).
8. FOR ALL lists of Outcome_Notices, the selector's result SHALL keep the order of the notices and SHALL be the same when the notices of unrelated kinds are inserted or removed (metamorphic property).
9. FOR ALL runs generated by the Runtime model, applying the Moment_Selector to every Accepted_Dispatch SHALL give each `ghost-laid-to-rest` only after a `ghost-rises` for the same concept in the same run (property).
10. THE Moment_Selector and every Motion_Component SHALL import no Runtime reducer, dispatch function or Event creator, and SHALL receive State and notices as read-only values.
11. THE Haunting_Polish SHALL ship a test that renders each Motion_Component with a State and notices and asserts that the State and the Event_Log are deep-equal before and after rendering and after the animation ends.
12. THE Haunting_Polish SHALL ship a unit test for each Motion_Moment with a fixed notice list.

### Requirement 7: Autopsy as parchment

**User Story:** As a learner who has escaped, I want the Autopsy to read like a page written in the desk's warm light, so that I can read my results comfortably.

#### Acceptance Criteria

1. THE Autopsy_Parchment SHALL style the existing `autopsy-view`, `autopsy-counts`, `autopsy-concepts` and `autopsy-entry` hooks with `--parchment-100` as the background and `--ink-900` as the text colour, from tokens, in a Crypt_Style.
2. THE Autopsy_Parchment SHALL meet the Contrast_Rule for every text and icon on the parchment, including the excerpt block, the outcome labels, the counts and the buttons.
3. THE Autopsy_Parchment SHALL draw the outcome icons in `currentColor` so that they follow the ink colour, and SHALL use `--candle-400` and `--ember-600` on the parchment for nothing.
4. THE Autopsy_Parchment SHALL give every button and toggle on the parchment a visible focus ring from `--focus-ring-on-light`.
5. THE Autopsy_Parchment SHALL keep every native element and every text of `AutopsyView` in place, so that reading order, labels and accessible names are unchanged.
6. THE Autopsy_Parchment SHALL give every interactive element a target of at least 44 by 44 px.
7. WHEN the Autopsy opens, THE Autopsy_Parchment SHALL fade the page in with a CSS animation that finishes within the Moment_Duration_Cap.
8. THE Autopsy_Parchment SHALL define its fade only inside `@media (prefers-reduced-motion: no-preference)`, so that the page is fully visible when the animation does not run.
9. WHEN focus enters the Autopsy while the fade runs, THE Autopsy_Parchment SHALL end the fade and show the page at full opacity at once.
10. WHILE the Reduced_Motion_Signal is on, THE Autopsy_Parchment SHALL show the whole page at once with no animation, and the page SHALL carry the same text and the same five outcome counts.
11. WHILE Lantern_Mode is on or off, THE Autopsy_Parchment SHALL draw no Atmosphere_Overlay, and SHALL keep the page fully lit.
12. THE Autopsy_Parchment SHALL pass an axe scan after the fade has ended and with the Reduced_Motion_Signal on.

### Requirement 8: Quill writing the Autopsy

**User Story:** As a learner, I want to watch a quill write my Autopsy, so that the desk feels like a place that answers back.

#### Acceptance Criteria

1. THE Quill_Mark SHALL be a new Motion_Component under `apps/web/src/features/crypt/` with its own Crypt_Style, drawn as inline SVG from tokens, with no image file.
2. THE Quill_Mark SHALL carry `aria-hidden="true"`, `pointer-events: none` and no focusable child.
3. THE Quill_Mark SHALL draw its ink stroke by animating `stroke-dashoffset` or `clip-path` within the Moment_Duration_Cap.
4. THE Quill_Mark SHALL sit in a margin or header area where it covers no text, no icon and no control of the Autopsy.
5. THE Quill_Mark SHALL leave the text of the Autopsy in the DOM from the first render, so that the quill reveals nothing that a screen reader or a keyboard cannot already reach.
6. WHILE the Reduced_Motion_Signal is on, THE Quill_Mark SHALL draw the finished stroke and the resting quill at once with no animation.
7. THE Quill_Mark SHALL read no learner content and SHALL draw no text.
8. WHERE the Open_Decision of Requirement 13 is unconfirmed, THE Haunting_Polish SHALL ship the Quill_Mark and its tests unmounted, and the parchment fade of Requirement 7 SHALL stand as the Autopsy's motion on its own.

### Requirement 9: Lantern_Mode on every screen inside the crypt feature

**User Story:** As a learner who needs a calm screen, I want Lantern_Mode to hold on every crypt screen, so that I never meet an overlay I turned off.

#### Acceptance Criteria

1. WHILE Lantern_Mode is on, THE room Stage, THE final door Stage and THE escape view Stage SHALL mount no Atmosphere_Overlay.
2. WHILE Lantern_Mode is on, THE Autopsy SHALL show no Atmosphere_Overlay (see Requirement 7, criterion 11).
3. WHEN the learner changes Lantern_Mode, THE room Stage and THE final door Stage SHALL follow the change in the same render, with the one `LanternProvider` value.
4. THE Haunting_Polish SHALL keep the Lantern_Setting as the only value in `localStorage`, under the existing key, and SHALL add no new key.
5. THE Haunting_Polish SHALL ship a component test per crypt screen (room, final door, escape view, Autopsy) with Lantern_Mode on and off, asserting the overlay is absent when on, and every Text_Panel is fully lit and above the overlay when off.
6. THE Haunting_Polish SHALL ship a test over the existing desk, dig and descent screens, read-only, that they honour `useLantern` as their tests already claim, and SHALL report any gap in the build log as an Open_Decision (Requirement 15) and not fix it.
7. WHERE the game is played in Lantern_Mode, THE crypt screens SHALL stay fully playable, with every Motion_Moment's Static_Equivalent and Announcement_Text unchanged.

### Requirement 10: Reduced motion on every motion in the crypt feature

**User Story:** As a learner who is sensitive to motion, I want every movement to have a still equivalent with the same meaning, so that nothing I need appears only through motion.

#### Acceptance Criteria

1. WHILE the Reduced_Motion_Signal is on, THE Haunting_Polish SHALL run no CSS animation, no CSS transition with a non-zero duration and no scripted animation in any Crypt_Style or Motion_Component.
2. THE Haunting_Polish SHALL define every new animation and transition only inside `@media (prefers-reduced-motion: no-preference)`, or SHALL switch it off inside `@media (prefers-reduced-motion: reduce)` in the same stylesheet.
3. WHILE the Reduced_Motion_Signal is on, THE Stage SHALL turn parallax off and SHALL draw every Motion_Moment's Static_Equivalent at once.
4. THE Haunting_Polish SHALL ship a static test that parses every Crypt_Style, finds every `animation`, `animation-name` and `transition` declaration, and fails when one has no reduced-motion rule that switches it off.
5. THE Haunting_Polish SHALL ship a static test that parses every `@keyframes` rule and fails when a keyframe set changes `opacity` to 0 and the element has no Static_Equivalent that is visible without the animation.
6. THE Haunting_Polish SHALL ship a read-only audit test over the CSS of `features/desk`, `features/dig` and `features/descent` that lists every animation without a reduced-motion rule, and SHALL report each as an Open_Decision (Requirement 15) and not fix it.
7. WHEN a Motion_Component reads the Reduced_Motion_Signal in React, THE Motion_Component SHALL use `usePrefersReducedMotion` and SHALL follow a change of the preference while mounted.
8. THE Haunting_Polish SHALL ensure no content appears only through motion: for every Motion_Moment, the Static_Equivalent and the Announcement_Text SHALL carry the same fact.
9. THE Haunting_Polish SHALL keep every Motion_Moment non-blocking: each ends within the Moment_Duration_Cap, takes no pointer events and does not delay any dispatch or focus move.
10. THE Haunting_Polish SHALL cause no flashing of more than three times in one second, no jump scare and no screen shake.

### Requirement 11: Honest copy, tone and evidence

**User Story:** As a reader of the product, I want the copy to stay plain and honest, so that the haunting never overstates anything.

#### Acceptance Criteria

1. THE Haunting_Polish SHALL add no learner-facing sentence, and SHALL reuse the text already in `packages/core/src/copy.ts` for every announcement, label and heading.
2. WHERE a new accessible name or visible string becomes necessary, THE Haunting_Polish SHALL record it as an Open_Decision, because `packages/core/src/copy.ts` is outside the files this spec may change.
3. THE Haunting_Polish SHALL contain no Banned_Phrases in any code comment, CSS comment, test name, task or document it adds.
4. THE Haunting_Polish SHALL make no claim of learning gains, mastery or exam readiness, and SHALL describe the Autopsy only as a summary of this run.
5. THE Haunting_Polish SHALL leave every Evidence_Panel, Citation_Label and "Source excerpt matched" label unchanged.
6. THE Haunting_Polish SHALL ship a test that scans every file it adds for Banned_Phrases.

### Requirement 12: Open_Decision 1: Lantern_Mode and the reduced-motion flag above the title screen

**User Story:** As a learner, I want the title screen and the desk to follow my Lantern setting, so that the setting holds from the first screen.

#### Acceptance Criteria

1. THE Open_Decision SHALL state the gap: the title at `/` in `apps/web/src/app.tsx` renders outside `LanternProvider`, so it has no Lantern toggle, and the desk hub and bring-notes screens are not yet mounted by `app.tsx`.
2. THE Open_Decision SHALL state the smallest edit: render the title through `DeskHub` inside `CryptFlow` (the front-of-house wiring already planned in `docs/briefs/front-of-house-design.md`), or wrap the app root in one `LanternProvider` in `apps/web/src/main.tsx` and make `LanternProvider` in `lantern-context.tsx` reuse an outer provider when one exists, so that two providers do not hold two values.
3. THE Open_Decision SHALL name the files that the edit would touch: `apps/web/src/app.tsx` or `apps/web/src/main.tsx`, and `apps/web/src/features/crypt/lantern-context.tsx`.
4. WHILE the Open_Decision is unconfirmed, THE Haunting_Polish SHALL NOT edit any of those files, and SHALL record the requirement as unmet in the build log.
5. WHEN the user confirms, THE Haunting_Polish SHALL add a test that the Lantern toggle on the title and on the desk hub writes the same Lantern_Setting as the crypt toggle and that both read one value.

### Requirement 13: Open_Decision 2: mounting the Quill_Mark and a toggle on the Autopsy and the escape view

**User Story:** As a learner, I want the quill and a Lantern toggle on the Autopsy and the escape view, so that the last screens match the rest.

#### Acceptance Criteria

1. THE Open_Decision SHALL state the gap: `AutopsyView` mounts no Motion_Component and no Lantern toggle, and the escape view of `FinalDoor` has no Lantern toggle.
2. THE Open_Decision SHALL state the smallest edit: in `autopsy-view.tsx`, one import and one `<QuillMark />` element beside the heading, plus one `<LanternToggle label={ROOM_PLAY_LABELS.lanternToggle} />`; in `final-door.tsx`, one `<LanternToggle ... />` in the escape view.
3. THE Open_Decision SHALL name the files: `apps/web/src/features/crypt/autopsy-view.tsx` and `apps/web/src/features/crypt/final-door.tsx`. Neither is a Frozen_File, but both are existing `.tsx` files that Requirement 1 reserves.
4. WHILE the Open_Decision is unconfirmed, THE Haunting_Polish SHALL NOT edit those files.
5. WHEN the user confirms, THE Haunting_Polish SHALL mount the Quill_Mark and the toggles and SHALL re-run the Autopsy axe, keyboard-order and reduced-motion tests with them present.

### Requirement 14: Open_Decision 3: mounting the Moment_Selector in the Stage

**User Story:** As a builder, I want the Moment_Selector to drive the Stage, so that motion and text come from one rule.

#### Acceptance Criteria

1. THE Open_Decision SHALL state the gap: `ArtStage` derives its effects from `artEffectsFrom(notices)` in `art-effects.ts`, and `RoomScreen` and `CryptFlow` hold the previous State. A Moment_Selector in a new file has no consumer unless an existing file calls it.
2. THE Open_Decision SHALL state the smallest edit: in `art-stage.tsx`, call the Moment_Selector next to `artEffectsFrom` and set `data-moment` on the Stage root; no change to `room-screen.tsx`, which already passes `notices`.
3. THE Open_Decision SHALL name the file: `apps/web/src/features/crypt/art-stage.tsx`.
4. WHILE the Open_Decision is unconfirmed, THE Haunting_Polish SHALL deliver the CSS of Requirements 3 to 5 on the existing class hooks (`flame--ignite`, `art-layer--fade-in`, `ghost-art--rise`, `ghost-art--leaving`), and SHALL ship the Moment_Selector and its tests unmounted.
5. WHEN the user confirms, THE Haunting_Polish SHALL add a test that `data-moment` on the Stage matches the Moment_Selector for each Motion_Moment and is empty for a restored State.

### Requirement 15: Open_Decision 4: Lantern_Mode and reduced motion outside the crypt feature

**User Story:** As a learner, I want the desk, the dig and the descent to follow Lantern_Mode and reduced motion the same way the crypt does, so that no screen surprises me.

#### Acceptance Criteria

1. THE Open_Decision SHALL list each gap that the read-only audit of Requirements 9 and 10 finds, and SHALL start with these known ones: the descent clip plays in Lantern_Mode when the Reduced_Motion_Signal is off; `descent.css` has a fade with no reduced-motion rule; the desk, dig and descent screens have no mist or grain of their own.
2. THE Open_Decision SHALL state, for each gap, the file and the smallest edit, for example: in `features/descent/descent-gate.tsx`, read `useLantern` and skip the clip when it is on; in `features/descent/descent.css`, add one `@media (prefers-reduced-motion: reduce)` rule that sets `animation: none`.
3. THE Open_Decision SHALL ask whether mist and grain are wanted on the desk-side screens at all, because they have vignette and mist of their own today.
4. WHILE the Open_Decision is unconfirmed, THE Haunting_Polish SHALL NOT edit any file in `features/desk`, `features/dig`, `features/descent` or `features/start`.
5. WHEN the user confirms a gap, THE Haunting_Polish SHALL fix it and SHALL add a test for it in the same task.

### Requirement 16: Tests

**User Story:** As a builder, I want tests that prove the contrast, motion and reduced-motion rules, so that the polish cannot break them later.

#### Acceptance Criteria

1. THE Haunting_Polish SHALL ship unit tests and property-based tests (fast-check) for the Moment_Selector under Requirement 6.
2. THE Haunting_Polish SHALL ship component tests that render the Stage, the Autopsy and each Motion_Component with the Reduced_Motion_Signal on and off, and assert the Static_Equivalent when on and the animation class when off.
3. THE Haunting_Polish SHALL ship a contrast test under Requirements 2 and 7 that uses the same token-reading method as `desk-contrast.test.ts` and composites the overlay opacities.
4. THE Haunting_Polish SHALL ship the static CSS tests of Requirement 10, criteria 4 and 5, and the stacking test of Requirement 2, criterion 11.
5. THE Haunting_Polish SHALL ship Playwright tests, run on the `chromium`, `firefox` and `pixel` projects, for each of the Motion_Moments `candle-lit`, `ghost-rises`, `ghost-laid-to-rest` and `autopsy-opens`, each with reduced motion on and with it off.
6. WHEN reduced motion is off, THE Playwright test for a Motion_Moment SHALL assert that the moment's animation runs (computed `animation-name` is not `none`) and that the Announcement_Text appears in the live region.
7. WHEN reduced motion is on, THE Playwright test for a Motion_Moment SHALL assert that no animation runs, that the Static_Equivalent is visible at once and that the Announcement_Text still appears.
8. THE Haunting_Polish SHALL ship an axe scan on the room with the overlay present and Lantern_Mode off, on the room in Lantern_Mode, on the final door, and on the Autopsy, and each SHALL report no violations.
9. THE Haunting_Polish SHALL ship a Playwright test that the Atmosphere_Overlay does not intercept a click or a key on any Hotspot_Button, panel button or seal.
10. THE Haunting_Polish SHALL ship a Playwright test that tab order on the Autopsy and the room is unchanged by the polish, and that focus is visible on every stop.
11. THE Haunting_Polish SHALL make no network request to another origin and call no AI provider in any test, and SHALL read answers for the Playwright tests from the sample manifest as the existing helpers do.
12. THE Haunting_Polish SHALL leave the existing tests of `art-motion.test.tsx`, `lantern-motion.test.tsx`, `crypt-motion.e2e.ts` and `crypt-axe.e2e.ts` passing, and SHALL extend them only by new test files.
13. THE Haunting_Polish SHALL attach a screenshot or a short note per Motion_Moment to the build log, taken with reduced motion on and off, and the build log SHALL record real results, including any failure.

### Requirement 17: Test cost

**User Story:** As the owner of a shared machine, I want tests that run cheaply while I work, so that the build does not stall the computer.

#### Acceptance Criteria

1. WHILE a task is in progress, THE Haunting_Polish SHALL run only the test files that the task adds or changes, and the existing test files that import the changed module.
2. WHEN a Checkpoint task runs, THE Haunting_Polish SHALL run the full Vitest suite with `--maxWorkers=50%`.
3. WHEN a Checkpoint task runs Playwright, THE Haunting_Polish SHALL run it with `--workers=2`.
4. THE Haunting_Polish SHALL schedule the full Playwright run only at a Checkpoint, and SHALL record the results in the build log.
5. THE Haunting_Polish SHALL start no dev server, watcher or other long-running process from a task, and SHALL leave the preview server that Playwright starts to the Playwright config.

## Out of Scope

- The title animation, the camera move onto the desk, the candle-snuff descent clip, the room-to-room clip and the final door clip. Their video files and their sequences are not changed.
- Sound.
- The cursor glow listed among the atmosphere layers in `design-system.md`.
- Any change to game rules, scoring, the Runtime, generation, persistence or the lock panels.
- New copy in `packages/core/src/copy.ts` (see Requirement 11, criterion 2).
- Any claim of learning gains, mastery or exam readiness.

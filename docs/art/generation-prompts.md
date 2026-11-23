# Escape the Crypt generation prompts

**Tool:** ChatGPT image generation (OpenAI), used by the author. No image here was made by Kiro.
**Period:** November 2026.
**Status:** concept references only. Production art will be regenerated as separate layers (see `.kiro/steering/design-system.md`), and those prompts will be added below as they are made.
**Note:** the fix prompts at the end (C6a, C2a, C5b, B16, B09b, B20, C6b, C2b) were regenerated in place, so the files with those names are the fixed versions; the originals were overwritten.
**Reference chain:** `crypt-entrance.png` was the first reference. From pack v2 on, A1 (cold crypt) and A2 (warm desk) were attached as style anchors for every later image, and A8 revised set the lock objects.

## Index: file → prompt

| Folder | Files | Prompt source |
|---|---|---|
| root | crypt-entrance, scholars-study, crypt-question, crypt-exit | Early images, sections below (crypt-exit was made with the crypt-open prompt) |
| A-look | A1–A7, A8-lock-objects-revised | `A-look/generation-prompts.md` |
| B-screens | B01, B02, B03, B07, B08, B10, B14, B15, B17, B18 | Pack v2, section B |
| B-screens | B09-crypt-room-revised, B09-final-burial-chamber | `B-screens/B09-generation-prompt.md` |
| B-screens | B09b, B09c, B16, B20 | Pack v2 section B, then the fix prompts at the end |
| C-locks | C1a/b, C3a/b, C4a/b, C5a | Pack v2, section C |
| C-locks | C2a, C2b, C5b, C6a, C6b | Pack v2 section C, then the fix prompts at the end |
| D-hero | D1–D11 | Pack v2, section D |
| E-motion | E1–E9 | Pack v2, section E |

---

The crypt entrance served as the visual reference for the other three early images.

## Crypt entrance

Use case: stylized-concept. Create a single widescreen 16:9 game environment painting for Escape the Crypt, a friendly spooky study game. BELOW, the cold crypt at the beginning of a run. A quiet, modest stone chamber, with one closed pointed Gothic oak door at the back center, dark iron hinges, broad two-step landing. On the two sides of the landing, exactly four short ivory wax candles, two each, on worn low brass holders. All four candles have tiny ghostly teal flames without warm light. One gentle, translucent pale-teal wisp ghost hovers low near the left wall, with soft round eyes and no mouth. A mostly symmetrical, eye-level view with ample uncluttered negative space, soft teal mist and a little reflected light across worn flagstones. Painterly but clean dark Gothic fantasy digital painting, subtle stone, wood, brass and wax, calm cinematic soft volumetric lighting, clear forms, blue-black and near-black #0E0D0C, dark surface #2A2623 and cold accent #9FD4D0. No gore, no bones, no scary faces, no lettering, no graphics, no logos, no watermark. Art fills a true 16:9 landscape frame.

## scholars-study

Use case: stylized-concept. Create a new single 16:9 environment concept painting for Escape the Crypt, a friendly spooky study game. Reference image is a style and materials guide only. Depict ABOVE, the safe, cosy scholar's study. A broad near-black walnut desk viewed obliquely from desk height, with a stack of completely blank parchment #E9DFC8, a quill and dark ink pot, two plain closed books, and a short ivory wax candle in the same low worn brass loop-handled holder as the reference. A shelving alcove fades into black behind the desk. Clear simple composition, generous breathing room, gold candlelight #F2A33A spilling across the desk and leaving soft dark shadows. Only warm light is candle gold. Dark gothic fantasy digital painting, clean painterly detail, soft cinematic volumetric light, understated near-black #0E0D0C and surface #2A2623, fine wood, parchment, brass and wax texture. Safe, inviting and quiet. No text, no writing or marks on paper, no logos, no watermark. True 16:9.

## crypt-open

Use case: lighting-weather. Create the completion-state version of the supplied Escape the Crypt environment painting in true 16:9. Register precisely to the reference camera and composition. Keep the same crypt, pointed stone doorway, flanking arches and four candles, the same wick positions and worn brass holders, flagstone seams, two-step landing, and a little translucent teal round-eyed mouthless ghost on the left. The identical single oak door swings open on its left-side hinges and reveals golden light beyond the threshold. All exactly four candle flames now glow warm gold #F2A33A, with golden light pooling from the doorway down both steps and giving the nearby stone edges a soft warm reflection. Preserve teal #9FD4D0 and blue-black shadows at the edges. Restrained cinematic volumetric light, original painterly but clean stone and wax texture, quiet friendly-spooky success. No text, no logo, no watermark, no gore.

## crypt-question

Use case: ui-mockup. Single full-screen 16:9 high-fidelity desktop game mockup for Escape the Crypt. Use the supplied art as the actual background and visual reference, with the same pointed crypt door, visible flanking candle pairs, and a gentle translucent teal round-eyed ghost with no mouth. The leftmost candle has turned gold #F2A33A, the other three remain cool teal #9FD4D0. Keep those four flames visible around the centered overlay by positioning the overlay slightly high. Place an elegantly restrained, evenly lit pale parchment #E9DFC8 panel on a thin dark metal frame, generously spaced and clearly dominant. Big dark ink #2B2118 typesetting. Use a small progress readout with a gold candle icon and the exact label “1 of 4 candles lit”. Central question in large highly readable type reads exactly “Which planet is closest to the Sun?” Below, four broad tactile parchment or muted brass answer plaques in a clean two-by-two grid labeled exactly “Venus”, “Mercury”, “Earth”, “Mars”. Each plaque has its own small outlined circular selection icon beside its label. Comfortable margins, ample button padding, high contrast, neutral waiting-for-answer state. Near-black #0E0D0C and surfaces #2A2623 with subtle paint, stone, brass and parchment, quiet soft light. UI fully in frame. Render only the six specified text strings, no other words, logos, watermarks, browser chrome or red.# Escape the Crypt: image prompt pack v2 (the remaining images)

**What changed from v1**
- **Scenes only, no UI.** Every image is now a scene plate with **no text, labels, buttons or panels**. All interface is built in code. Where the UI will sit, the prompt asks for dark, empty space.
- **Darker and more ominous**, not scarier: cold teal and blue-black ambient light, gold only in small pools around lit candles, deep shadows.
- **Composition like the revised B09:** asymmetric, deep, objects at different distances, dark foreground framing, slightly low camera. No lineups.
- **Lock objects always come from the revised A8.**

**Upload these as references in every chat:** A1 (cold crypt), A2 (warm desk), A4 (candles), A5 (ghost), A8-revised (lock objects), B09-revised (room composition).

**Order:** ⭐ items first (the minimum set), then the rest. Save each image as `CODE-short-name.png` in the matching folder, and keep logging prompts in `generation-prompts.md`.

---

## 0. Brief v2 (paste this first in a new chat)

```
You are generating background scene art for a web game called "Escape the Crypt", a study app where learners escape a crypt by answering questions about their own notes. The interface (text, buttons, panels) is built separately in code, so every image you make is a SCENE ONLY.

Every image must match the attached references exactly in style, lighting and objects.

WORLD: ABOVE is a warm, candlelit scholar's desk in a dark study (safe, cosy). BELOW is a cold crypt (ominous, mysterious, never gory or frightening). The story: the crypt starts cold and dark; each correct answer lights a candle whose ghostly teal flame turns warm gold; the final door opens onto golden light.

LIGHT: Below, ambient light is cold teal and blue-black, and most of the scene is in deep shadow. Warm gold appears ONLY in small soft pools around lit candles, falling off quickly. Above, the desk is lit warmly by candlelight, with deep shadows at the edges.

COMPOSITION: asymmetric and deep, objects at different distances, some partly in shadow or overlapping, slightly low camera, large near-black foreground silhouettes framing the edges. Never line objects up in a row.

STYLE: painterly gothic fantasy, cinematic, less glossy, more shadow than detail, subtle stone, wax, parchment, brass and wood textures. Ghosts are gentle translucent teal spirits with soft round eyes and no mouth: eerie but kind.

COLOURS: near-black #0E0D0C, dark #2A2623, teal #9FD4D0, gold #F2A33A, parchment #E9DFC8.

ALWAYS: no text, no letters, no numbers (except engraved dial numbers when asked), no labels, no UI, no logos, no watermark. 16:9 unless stated otherwise.
```

**Short style tag** (add if the tool drifts):
```
Same style, lighting and objects as the references: dark ominous painterly gothic, cold teal ambient light, gold only around lit candles, deep shadows, asymmetric deep composition, no text, no UI, 16:9.
```

---

## B. Scene plates for every screen

```
⭐ B09-final — Crypt room 1 (burial chamber), final: keep the composition and darkness of the attached B09-revised, but ambient light is cold teal and blue-black throughout, warm gold ONLY in small pools around the three lit candles; bring the combination safe forward into the middle ground so all six lock objects (from A8) are clearly visible and similar in prominence; pull the séance table fully into frame. Exit: chained carved wooden door with the candle-in-keyhole sigil above it.

⭐ B09b — Crypt room 2 (library of bones): same style and camera height as B09, a different chamber: walls lined with niches holding stacked old books and scattered bones, a broken bookshelf in the foreground left, the six lock objects arranged in a NEW asymmetric layout at different depths, a different chained exit door with the same sigil, cold teal ambient light, three gold candle pools, faint ghosts in far shadows.

B09c — Crypt room 3 (sunken chapel): same style, a ruined gothic chapel crypt with pews half-collapsed, a cracked stained-glass window giving faint teal light, the six lock objects in another new asymmetric layout, a large chained exit door with the sigil, cold ambient light, a few gold candle pools.

⭐ B01 — Title scene: wide view of a dark study with a scholar's desk in the middle distance lit by one warm gold candle, bookshelves fading into shadow, a narrow stone stairway at the right edge glowing faint teal as it descends into darkness. Large dark empty space in the upper third for the title. Warm, mysterious, inviting.

⭐ B02 — Desk hub: closer view of the warm desk from slightly above. An open book with blank pages in the centre, a floating feather quill, an inkwell, one gold candle, a stack of 5 leather books with blank spines on the left (one book faintly glowing teal), dark empty space on the right third for interface.

⭐ B03 — Bring your notes: top-down view of the open book on the warm desk, blank parchment pages filling most of the frame (text will be added in code), the quill hovering above the right page, candle at the top right corner, edges in deep shadow.

⭐ B07 — Candle snuffed: the warm desk with its single candle just extinguished, a thin curl of pale smoke, the whole scene falling into darkness, a faint teal glow rising from the stairway at the edge. Mostly black.

⭐ B08 — The dig: a lantern on a chain lowering into a vast dark teal cavern, distant glowing arched doorways far below, stone ledges and roots in the foreground left. Keep the right 40% of the frame dark and empty for the progress panel.

⭐ B10 — Lock backdrop: the crypt room from B09-final, heavily darkened and softly out of focus, as the background behind an open lock. Almost no detail, just shapes, a few gold candle pools and teal mist.

B14 — Ghost returns: the crypt room in darkness, one gentle teal ghost (from A5) floating toward the camera from the left shadows, its glow lighting the mist around it.

⭐ B15 — Final door: the base of a massive carved crypt door with iron bands, three carved lock symbols on it, the candle-in-keyhole sigil above, the chamber now warm, with many gold candles burning along the walls, two faint ghosts waiting beside the door.

⭐ B16 — Escape: the final door wide open, brilliant warm golden light pouring in, worn stone steps leading up into the light, dust in the beams, the cold room behind fading.

⭐ B17 — Autopsy desk: the warm desk at dawn light mixed with candlelight, the open book with blank pages (the report is added in code), the quill floating mid-stroke above the page, a small heap of gold motes drifting off the page. Dark empty margins left and right.

B18 — The Haunting: the warm desk at night, the book stack in focus, one book's spine glowing soft teal, a faint gentle ghost resting on top of that book. Dark empty space on the right for interface.

B20 — Mobile crypt (portrait 9:16): the B09-final room recomposed vertically: exit door and sigil at the top, objects stacked at different depths down the frame, foreground framing at the bottom corners, cold and dark.
```

---

## C. Lock close-ups (scene only)

Add to every C prompt: *"Close-up of this one lock object from A8, placed in the LEFT 60% of the frame. The RIGHT 40% is dark, soft, empty shadow (an interface panel goes there). Cold teal ambient light, one gold candle nearby, deep shadows. No text, no UI."*

```
⭐ C1a — Rune tablet, closed: the carved stone tablet with its row of empty rune slots, moss in the carved border, an iron sconce with a teal-flamed candle beside it.
C1b — Rune tablet, opened: glowing gold runes burned into the slots, light cracking around the tablet, the tablet sliding aside to reveal a niche with a warm gold candle.

⭐ C2a — Séance table, waiting: top-down three-quarter view of the velvet-covered table and ornate séance board, the heart-shaped planchette at the centre, two candles at the far edge (one teal, one gold). Leave the lower half of the board plain and smooth (answer options are drawn in code).
C2b — Séance table, answered: the planchette's lens glowing gold, faint gold light rippling across the board's carvings, both candles flaring warm.

⭐ C3a — Ossuary shelf, waiting: the stone shelf with four empty numbered carved sockets (I, II, III, IV) and four smooth bones resting loosely in front of them.
C3b — Ossuary shelf, opened: the bones seated in the sockets with small gold glints, the shelf sliding down to reveal a warm candle, dust motes falling.

⭐ C4a — Pin frame, waiting: the upright wooden frame with two columns of brass pins and no threads, faint teal glow on the pins.
C4b — Pin frame, opened: glowing gold threads connecting the pins between the columns, the frame swinging open like a cabinet door, warm light behind it.

⭐ C5a — Altar, waiting: the stone altar with its four objects (urn, goblet, reliquary, skull candle holder), each on a small blank base, a candle at each end.
C5b — Altar, opened: one object crumbling into ash and embers, the other three glowing warm, a compartment opening in the altar's face.

⭐ C6a — Safe, locked: the iron safe door with its large engraved brass combination dial (numbers 0–9 engraved around it), bolts visible at the edge.
C6b — Safe, opened: bolts retracted, the heavy door swinging open, warm golden light spilling out onto a lit candle inside.
```

---

## D. Hero moments (cinematic stills)

```
⭐ D1 — Candle lighting: extreme close-up of a wall candle in darkness as its tiny teal flame bursts into a warm gold flame, sparks drifting up, warm light suddenly touching the cold stone around it.
⭐ D2 — Ghost rising: a gentle teal spirit (from A5) rising out of thin mist above the rune tablet in a dark crypt, soft round eyes, calm and curious.
D3 — Evidence reveal: an aged parchment unrolling on dark stone in candlelight, one line of faint handwriting glowing gold (unreadable, decorative).
D4 — Challenge: a dark red wax seal stamped with the candle-in-keyhole sigil cracking apart on parchment, flakes floating up into darkness.
⭐ D5 — Final door opening: the massive crypt door swinging open, golden light flooding into the dark chamber, dust in the beams, steps leading up.
⭐ D6 — Candle snuffed: a single desk candle just extinguished, a curl of smoke, darkness closing in, faint teal light rising from below.
⭐ D7 — Quill writing: top-down view of the open book on the dark desk, the quill floating and writing by itself, fresh ink lines glowing gold (unreadable, decorative script).
D8 — Lingering spirit: a faint, peaceful teal spirit resting above the altar in deep darkness, glowing softly.
D9 — Ghost laid to rest: a teal spirit dissolving upward into warm gold motes of light in a dark crypt.
D10 — Descent: a narrow spiral stone stairway seen from the top step, warm study light behind, cold teal darkness below.
⭐ D11 — Sigil: the candle-in-keyhole sigil carved in stone above a door, faint teal light in the carving, centred, in close-up (logo reference).
```

---

## E. Motion storyboards

Add to each: *"A horizontal storyboard strip of 4 equal panels, left to right, the same camera and lighting in each, thin dark gutters, no text."*

```
⭐ E1 — Title: (1) black with one tiny candle flame; (2) the flame grows and reveals the dark study and desk; (3) faint gold ink lines appear in the empty upper space; (4) the camera has pushed in toward the desk.
⭐ E2 — Camera to the desk: (1) wide dark study; (2) closer; (3) the desk with the book stack; (4) top-down onto the open blank book.
⭐ E3 — Snuff into the crypt: (1) the desk candle burning gold; (2) the flame bending out; (3) a smoke curl in darkness; (4) teal light rising as the view drops into the crypt.
⭐ E4 — Candle lighting: (1) a wall candle with a tiny teal flame; (2) it flickers; (3) it bursts gold with sparks; (4) a steady gold flame with a warm light pool on the stone.
⭐ E5 — Ghost rising: (1) the closed rune tablet in darkness; (2) teal mist escaping; (3) a gentle ghost forming; (4) the ghost drifting toward the dark left corner.
E6 — Lock opening (safe): (1) the locked safe; (2) the dial turning; (3) bolts retracting; (4) the door swinging open, gold light spilling out.
⭐ E7 — Final door: (1) the closed door in a gold-lit room; (2) a crack of light down the middle; (3) half open, light flooding in; (4) fully open, steps into brilliant light.
E8 — Quill writes the Autopsy: (1) the blank open book; (2) the quill writing the first gold line; (3) half the page filled with decorative script; (4) the page complete, the quill resting.
E9 — Ghost laid to rest: (1) a teal ghost floating; (2) it brightens; (3) it dissolves into gold motes; (4) only drifting sparkles remain.
```

---


C6a — Replace only clock dial with engraved brass combination dial, ten evenly spaced Arabic digits clockwise 0 at top then 1 2 3 4 5 6 7 8 9 exactly once. Knurled central knob, small pointer above, edge bolts. No Roman numerals or clock. Match reference exactly except specified changes. No UI or other text. Object in LEFT 60%, RIGHT 40% empty dark shadow. Cold teal ambient. 16:9.
C2a — Remove all Roman numerals, replace numbered arc with continuous carved vine and tiny stars. Keep lower half smooth plain and all else exact. Match reference exactly except specified changes. No UI or other text. Object in LEFT 60%, RIGHT 40% empty dark shadow. Cold teal ambient. 16:9.
C5b — Only goblet crumbles into grey ash and rising glowing embers. Urn, reliquary and skull candleholder glow soft gold. Front compartment slides open spilling golden light. Exact altar, no bones shelf or sockets. Match reference exactly except specified changes. No UI or other text. Object in LEFT 60%, RIGHT 40% empty dark shadow. Cold teal ambient. 16:9.
B16 — Same camera room and massive carved wooden double door. Both leaves wide open showing same three lock symbols and sigil overhead. No chains. Brilliant golden light pours down worn steps across floor and locks, dust in beams, both ghosts dissolve into gold motes. Match reference exactly except specified changes. No UI or other text. 16:9.
B09b — Move combination safe left fully inside frame in middle ground, readable dial shape, all six objects visible with clear margins. Preserve exact composition lighting and room. Match reference exactly except specified changes. No UI or other text. 16:9.
B20 — Portrait 9:16. Enlarge safe and move forward, move right pin frame fully inside frame. Six individually clear easy-to-tap objects at different depths, all fully visible with margins. Preserve room lighting and style. Match reference exactly except specified changes. No UI or other text. 
C6b — Same safe, retract bolts and swing heavy door toward viewer showing same Arabic 0–9 dial on outer face. Inside small gothic niche and warm gold candle spilling light on ledge. No Roman numerals. Match reference exactly except specified changes. No UI or other text. Object in LEFT 60%, RIGHT 40% empty dark shadow. Cold teal ambient. 16:9.
C2b — Same crypt stone arches teal mist and velvet board. Move heart planchette to lower half, glass lens glows gold, soft gold ripples across carvings. Both far candles burn gold. No study furnishings, armchair, window or bookshelves. Match reference exactly except specified changes. No UI or other text. Object in LEFT 60%, RIGHT 40% empty dark shadow. Cold teal ambient. 16:9.

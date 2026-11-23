---
inclusion: fileMatch
fileMatchPattern: ["apps/web/src/**/*.tsx", "apps/web/src/**/*.css", "apps/web/public/art/**"]
---

# Design system: the desk and the crypt (final)

## The core metaphor
Light is progress. The crypt starts cold teal and dark; every correct answer lights a candle, and gold appears only where a candle is lit. Mistakes summon ghosts; they never make anything harder to see or use. Mood: darker and ominous, never scary.

## Two places
- **Desk (above):** warm, candle-lit study. Home screen, the book stack of saved crypts (device-local), bringing notes, the Autopsy.
- **Crypt (below):** cold stone rooms with lock objects. Warms room by room as candles light.

## Always-lit rule (non-negotiable)
Question panels, answer options, the evidence panel, navigation and every focused element are always fully lit and readable. Atmosphere layers (darkness, vignette, grain, mist, cursor glow) have `pointer-events: none`, never cover a question panel, and update via CSS variables or refs, never full React re-renders.

## Palette (CSS variables in `apps/web/src/styles/tokens.css`)
- `--stone-950` #0e0d0c background · `--stone-800` #2a2623 surfaces · `--stone-300` #b8afa6 secondary text
- `--bone-50` #f4efe6 primary text
- `--spectre-300` #9fd4d0 cold light, ghosts and interactive accent
- `--candle-400` #f2a33a lit candles and success only · `--ember-600` #b4471f emphasis
- `--parchment-100` #e9dfc8 evidence and Autopsy paper · `--ink-900` #2b2118 text on parchment
- Text contrast at least 4.5:1 (body) and 3:1 (large text) against its actual background, including over art.

## Typography
- Questions and body: Crimson Pro (fallback EB Garamond), minimum 18px desktop, 16px mobile, line-height 1.5.
- Titles only: Cinzel / Cinzel Decorative. Never for questions or options.

## Art: what is code, what is art
- **Built in code:** every piece of UI (panels, buttons, inputs, text), candle flames and glow, ghosts, grain, vignette, mist, the sigil, focus rings.
- **AI-generated layers** (disclosed in `ASSETS.md`, prompts logged in `docs/art/`): room backgrounds, the desk, lock objects, the exit door. Each is a separate transparent layer so code can light, parallax and animate it.
- No lettering, numbers or UI baked into art. Art is decoration; nothing needed to answer lives only in an image.
- 2.5D parallax from layers, at most a few pixels of movement.

## Lock objects (one per lock type)
- Rune tablet → Rune cipher
- Séance board → Séance board
- Ossuary shelf (I–IV) → Bone ordering
- Pin frame → Bound threads
- Altar → Cursed object
- Safe with a 0–9 dial → Combination dial
- Exit: a chained carved wooden door bearing the sigil.
Coffin, mirror and urn are decor or ghost sources only, never locks. Lock objects glow faintly to show they are interactive; no hidden-object hunting. Each lock type has a distinct interaction (typing, choosing, ordering, tying threads, picking an object, turning a dial), not restyled buttons.

## Sigil
A candle inside a keyhole. Used for the logo, the exit door and the favicon.

## Motion (the named moments)
Title animation · camera move onto the desk · candle snuff → descent into the crypt · candle lighting · ghost rising · lock opening (≤600ms) · final door opening · ghost laid to rest · quill writing the Autopsy.
- No flashing, no jump scares, no screen shake.
- `prefers-reduced-motion`: replace motion with fades or instant state changes, remove flicker and parallax.
- Every transition can be skipped and never blocks input for more than 1s.

## Sound
Optional, off by default, CC0 only, never required to understand anything.

## Components
Use native `button`, `input`, `textarea` and `form` elements styled to theme. Don't rebuild them from `div`s.

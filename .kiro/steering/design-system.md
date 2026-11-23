---
inclusion: fileMatch
fileMatchPattern: ["apps/web/src/**/*.tsx", "apps/web/src/**/*.css"]
---

# Design system: the crypt

## The core metaphor
Light is progress. Correct answers light candles and the room grows warmer and brighter. Mistakes summon ghosts; they never make anything harder to see or use.

## Always-lit rule (non-negotiable)
Question panels, answer options, the evidence panel, navigation and every focused element are always fully lit and readable. The atmosphere overlay (cursor glow, darkness, vignette) has `pointer-events: none`, never covers a question panel, and updates via CSS variables or refs, never full React re-renders.

## Palette (CSS variables in `apps/web/src/styles/tokens.css`)
- `--stone-950` #0e0d0c background · `--stone-800` #2a2623 surfaces · `--stone-300` #b8afa6 secondary text
- `--bone-50` #f4efe6 primary text · `--candle-400` #f2a33a warm light / success · `--ember-600` #b4471f emphasis
- `--spectre-300` #9fd4d0 ghosts and interactive accent (the one accent colour)
- Text contrast at least 4.5:1 (body) and 3:1 (large text) against its background.

## Typography
- Questions and body: a readable serif, minimum 18px on desktop, 16px on mobile, line-height 1.5.
- Titles only: one display face. Never use the display face for questions or options.

## Objects and locks
- Each lock is an illustrated SVG object (coffin, mirror, urn, door, cabinet, dial) that glows faintly to show it's interactive. No hidden-object hunting.
- Each lock type has a distinct interaction (typing, choosing, ordering, tying threads, picking an object, turning a dial), not restyled buttons.

## Motion
- Short and purposeful: lock opening (≤600ms), candle lighting, ghost rising.
- No flashing, no jump scares, no screen shake.
- Respect `prefers-reduced-motion`: replace motion with fades or instant state changes, and remove flicker entirely.

## Sound
Optional, off by default, never required to understand anything.

## Components
Use native `button`, `input` and `form` elements styled to theme. Don't rebuild them from `div`s.

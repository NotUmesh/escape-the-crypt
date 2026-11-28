---
inclusion: fileMatch
fileMatchPattern: ["apps/web/src/**/*.tsx", "apps/web/src/**/*.css"]
---

# Accessibility

Target WCAG 2.2 AA. Accessibility is part of "done", not a later pass.

## Contrast and motion
Keep text and controls readable at all times. Follow `prefers-reduced-motion` automatically and offer a way to skip clips.

## No drag required (WCAG 2.5.7)
- Bone ordering: visible "move up" / "move down" buttons on every item. Drag is an optional extra.
- Bound threads: tap a left item, then a right item, to connect; tap a connection to undo. Drag is optional.

## Keyboard
- Every action is reachable with Tab / Shift+Tab, Enter / Space and arrow keys where natural.
- Focus order follows the visual order; focus is always visible (a 2px `--spectre-300` outline plus offset).
- Opening a lock moves focus into it; closing returns focus to the object that opened it.

## Screen readers
- Every lock object has an accessible name ("Coffin lock: rune cipher, unsolved").
- State changes (solved, settled, ghost summoned, candle lit) are announced via a polite live region.
- Evidence panels are real text, not images.

## Touch
Targets at least 44×44px. No interaction depends on hover.

## Colour
Never communicate state with colour alone; pair it with an icon and text label.

## Testing
axe runs in hooks and CI, but it supplements manual checks: keyboard-only play, touch on a mid-range Android phone, 200% zoom, and one screen reader before each milestone.

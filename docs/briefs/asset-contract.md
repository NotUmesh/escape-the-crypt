# Art asset contract (v1.6, Nov 28)

> Copied into the repo on Nov 28 from the project's design docs, so the code chat and the art chat read the same contract. Additions for the desk-as-menu props, `desk/scene.json`, `title`, `to-desk` and `stairs-loop` are in the code handoff (section 6) and `docs/briefs/handoff-art-chat.md` (section 4).

**v1.6:** lock and door layers are rendered crisp again (no fog, no soft edges; alpha from the object's own coverage), with a small per-lock teal haze matched to the full render so they still sit in the room. **Each lock's contact shadow is now inside its own lock layer** (Cycles shadow catcher), and `background.webp` is rendered with every lock fully hidden, so no shadow appears where a lock isn't drawn. File names and code behaviour are unchanged. Done for `burial-chamber` desktop; the other rooms follow.

**v1.5:** lock and door layers were cut out of full renders of the room (fog, room light and soft edges included). Superseded by v1.6: this made the layers soft.

**v1.4:** light passes light only the room around the locks; each solved lock layer includes its own candle's light.

**v1.3:** light passes no longer contain a flame; the phone fallback rule (section 3); positions come from `scene.json` as always.

**v1.2 additions:** `-solved` and `-solved-hover` lock layers; `light-door`; the full mobile set and the `mobile` block in `scene.json`; the desk scene and books; motion poster stills.

Clip names: the desk part of the descent is `descent-desk` and the crypt part is `descent`.

This is the agreement between the art track (Blender scenes and renders by the author) and the app code. Code builds against placeholder files with exactly these names and sizes; the real renders replace them with **no code changes**.

Source scenes live outside the repo in `design-refs/3d/*.blend`. Only exported files go in the repo, under `apps/web/public/art/`. Every shipped file is listed in `ASSETS.md`.

---

## 1. What is art and what is code

| Art (rendered, in `public/art/`) | Code |
|---|---|
| Room backgrounds, without lock objects | All UI: panels, buttons, text, evidence panel, focus rings |
| Each lock object as its own transparent layer, with its contact shadow | Candle **flames** and their flicker, glow and halo |
| A warm "lit" light pass per lock (additive layer) | Crossfading a lock's light pass in when it is solved |
| Foreground depth layer | Parallax movement (a few pixels, off with reduced motion) |
| Lock close-ups, closed and open | Ghosts (rise, hover, fade, laid to rest) |
| Exit door, closed and open | Darkness and any code effects |
| Desk scene, props, desk candle body | Smoke, the quill writing, labels on props |
| Camera-move video clips with poster stills | Playing, skipping and replacing clips; reduced-motion fallbacks |

Rules: no text, numbers that carry meaning, or UI baked into art. Nothing needed to answer a question exists only in an image.

---

## 2. Formats and budgets

| Kind | Format | Sizes | Budget |
|---|---|---|---|
| Stills and layers | WebP (quality 80, alpha where needed) | Desktop `@1x` 1920×1080 and `@2x` 2560×1440 · Mobile 1080×1920 | ≤ 350 KB per desktop `@1x` background; ≤ 150 KB per lock layer |
| Light passes | WebP, black background (composited with `mix-blend-mode: plus-lighter`, fallback `screen`) | Same as the background they belong to | ≤ 80 KB each |
| Video clips | WebM (VP9) + MP4 (H.264) fallback, 30 fps, no audio track | 1920×1080 desktop, 1080×1920 mobile | ≤ 3 MB per clip, ≤ 6 s (loops up to 10 s if still ≤ 3 MB) |
| Poster stills | WebP | Same as the clip | ≤ 250 KB |

**First screen on a phone loads ≤ 2.5 MB of art.** Rooms load when they are next; clips load metadata only until needed.

---

## 3. Folder layout and file names

All names are kebab-case. `<room>` is a room ID, `<lock>` a lock type ID.

```
apps/web/public/art/
  rooms/<room>/
    scene.json
    desktop/
      background.webp           # the room with NO lock objects, every progress candle unlit (no flame)
      background@2x.webp
      foreground.webp           # nearest depth layer, alpha
      lock-<lock>.webp          # one per lock type, alpha, includes its contact shadow
      light-<lock>.webp         # warm light pass for that lock's candle, black background
      lock-<lock>-hover.webp    # same lock under a brighter cool-white light; crossfaded in on hover/focus
      lock-<lock>-solved.webp   # the lock after solving
      lock-<lock>-solved-hover.webp
      door-closed.webp
      door-open.webp
      light-door.webp
    mobile/
      (same names, 1080×1920 portrait framing)
      # Use the mobile set ONLY when scene.json has a "mobile" block. Until then, phones show the
      # desktop layers with object-fit: cover, centred on the union of the lock hotspots.
  locks/<lock>/
    closed.webp                 # close-up shown in the lock overlay; candle unlit
    open.webp                   # same shot after solving; candle lit
  desk/
    desktop/ background.webp, background@2x.webp, foreground.webp, candle.webp
    mobile/  (same names)
    books/book-1.webp … book-4.webp
  motion/
    title.*, to-desk.*, descent-desk.*, descent.*, room-to-room.*, final-door.*, escape.*, stairs-loop.*
    (each may also have a -mobile variant)
```

**Room IDs:** `burial-chamber`, `library-of-bones`, `sunken-chapel`, `crypt-hall` (optional fourth room).

**Lock IDs:** `rune-cipher`, `seance-board`, `bone-ordering`, `bound-threads`, `cursed-object`, `combination-dial`.

---

## 4. `scene.json`

Positions are fractions of the frame (0 to 1, from the top-left). Desktop and mobile each have their own block.

```json
{
  "room": "burial-chamber",
  "version": 1,
  "desktop": {
    "layers": ["background", "lock-*", "light-*", "door", "foreground"],
    "parallax": { "background": 0.2, "locks": 0.5, "foreground": 1.0 },
    "locks": {
      "rune-cipher": {
        "hotspot": [[0.09,0.38],[0.23,0.38],[0.24,0.78],[0.08,0.78]],
        "candle": { "x": 0.20, "y": 0.59, "scale": 1.0 },
        "panelSide": "right"
      }
    },
    "ambientCandles": [ { "x": 0.25, "y": 0.27, "scale": 1.2 } ],
    "ghostAnchors": [ { "x": 0.08, "y": 0.35 } ],
    "door": { "hotspot": [[0.43,0.18],[0.55,0.18],[0.55,0.55],[0.43,0.55]] }
  },
  "mobile": { "...": "same shape" }
}
```

- `hotspot`: the clickable outline of each lock; the real control is an HTML button over it, at least 44×44 px.
- `candle`: where code draws that lock's flame (the wax candle body is in the lock layer; the flame is code).
- `ambientCandles`: always-lit decorative candles; code draws their flames.
- `panelSide`: which side a question panel opens on, so it never covers its lock.
- `depth`: each lock's distance from the camera; when hotspots overlap, the smaller depth is on top.
- `size`: the frame the coordinates were measured on. All layers are full-frame and stack at 0,0.
- **(v1.6) Contact shadows live in the lock layers.** Hiding a lock's layer hides its shadow too.

---

## 5. How candles work

1. An unsolved lock's candle is **unlit**: no flame and no light. Wall sconces in `ambientCandles` are the only always-lit flames.
2. `light-<lock>.webp` holds only the extra warm light that lock's candle adds when lit, lighting only the room around the locks; it contains no flame.
3. When a lock is solved, code draws a gold flame at its `candle` point and fades its light pass in over about 600 ms (instant with reduced motion).
4. Several solved locks add their light passes together, so the room warms up lock by lock.
5. On solve, code also crossfades `lock-<lock>` to `lock-<lock>-solved`; hover then uses `-solved-hover`. When the room is cleared, `door-closed` crossfades to `door-open` and `light-door` fades in.
6. *Available:* dim cool light. *Hovered or focused:* crossfade to the `-hover` layer (brighter cool-white, about 200 ms) plus an optional thin outline glow. *Solved:* warm light. Warm means solved only.
7. A lock answered wrong or skipped stays unlit. A ghost answered correctly later gets a small spirit candle at a `ghostAnchor`. A challenged lock never lights.

---

## 6. Rules from the runtime

Each room shows each lock type **at most once**. Unused types are not drawn. The final door holds 2–4 reserved questions plus outstanding ghosts and skips as **seals on the door**, not lock stations; code draws one seal per slot.

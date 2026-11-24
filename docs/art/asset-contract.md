# Art asset contract (v1.1, Nov 24)

This is the agreement between the art track (Blender scenes and renders by the author, set up with Claude through the Blender MCP) and the app code (written by Kiro). Kiro builds against placeholder files with exactly these names and sizes; the real renders replace them later with **no code changes**.

Source scenes live outside the repo in `design-refs/3d/*.blend`. Only exported files go in the repo, under `apps/web/public/art/`. Every shipped file is listed in `ASSETS.md`.

---

## 1. What is art and what is code

| Art (rendered, in `public/art/`) | Code (Kiro) |
|---|---|
| Room backgrounds, without lock objects | All UI: panels, buttons, text, evidence panel, focus rings |
| Each lock object as its own transparent layer, with its contact shadow | Candle **flames** and their flicker, glow and halo |
| A warm "lit" light pass per lock (additive layer) | Crossfading a lock's light pass in when it is solved |
| Foreground depth layer for parallax | Parallax movement (a few pixels, off with reduced motion) |
| Lock close-ups, closed and open | Ghosts (rise, hover, fade, laid to rest) |
| Exit door, closed and open | Mist drift, grain, vignette, darkness |
| Desk scene, book spines, desk candle body | Smoke after a candle snuff, the quill writing, the book stack layout |
| Camera-move video clips (title, desk, descent, final door, escape) with poster stills | Playing, skipping and replacing clips; reduced-motion fallbacks |
| The safe dial as a 3D model (optional) | Turning the dial in real time |

Rules: no text, numbers that carry meaning, or UI baked into art (the safe dial's printed digits are decoration; the value is always shown in an HTML control). Nothing needed to answer a question exists only in an image.

---

## 2. Formats and budgets

| Kind | Format | Sizes | Budget |
|---|---|---|---|
| Stills and layers | WebP (quality 80, alpha where needed) | Desktop `@1x` 1920×1080 and `@2x` 2560×1440 · Mobile 1080×1920 | ≤ 350 KB per desktop `@1x` background; ≤ 150 KB per lock layer |
| Light passes | WebP, black background (composited with `mix-blend-mode: plus-lighter`, fallback `screen`) | Same as the background they belong to | ≤ 80 KB each |
| Video clips | WebM (VP9) + MP4 (H.264) fallback, 30 fps, no audio track | 1920×1080 desktop, 1080×1920 mobile | ≤ 3 MB per clip, ≤ 6 s |
| Poster stills | WebP | Same as the clip | ≤ 250 KB |
| 3D (optional) | glTF binary `.glb`, Draco-compressed | — | ≤ 1.5 MB |

**First screen on a phone loads ≤ 2.5 MB of art.** Rooms load when they are next; clips load metadata only until needed.

---

## 3. Folder layout and file names

All names are kebab-case. `<room>` is a room ID, `<lock>` a lock type ID.

```
apps/web/public/art/
  rooms/<room>/
    scene.json                  # anchors, hotspots, layer order (section 4)
    desktop/
      background.webp           # the room with NO lock objects, every progress candle unlit (no flame)
      background@2x.webp
      foreground.webp           # nearest depth layer (pillar, chains, rubble), alpha
      lock-<lock>.webp          # one per lock type, alpha, includes its contact shadow
      light-<lock>.webp         # warm light pass for that lock's candle, black background
      lock-<lock>-hover.webp    # same lock under a brighter cool-white light; crossfaded in on hover/focus
      door-closed.webp          # exit door layer, alpha
      door-open.webp
    mobile/
      (same names, 1080×1920 portrait framing)
  locks/<lock>/
    closed.webp                 # close-up shown behind the question panel; candle unlit
    open.webp                   # same shot after solving; candle lit and its warm light on the lock
  desk/
    desktop/ background.webp, background@2x.webp, foreground.webp, candle.webp
    mobile/  (same names)
    books/book-1.webp … book-4.webp   # spine variants, alpha; code stacks them
  motion/
    title.webm, title.mp4, title-poster.webp
    to-desk.webm …              # title → desk camera move
    descent.webm …              # desk candle snuffed → down into the first room
    room-to-room.webm …         # optional transition between rooms
    final-door.webm …           # the chained door opening onto light
    escape.webm …
    (each also has a -mobile variant: descent-mobile.webm, …)
  3d/
    safe-dial.glb               # optional
```

**Room IDs:** `burial-chamber` (B09 final), `library-of-bones` (B09b), `sunken-chapel` (B09c), `crypt-hall` (B09 revised). Only `burial-chamber` is needed for Gate 1.

**Lock IDs:** `rune-cipher`, `seance-board`, `bone-ordering`, `bound-threads`, `cursed-object`, `combination-dial` (the same IDs the runtime uses).

---

## 4. `scene.json`

Positions are fractions of the frame (0 to 1, from the top-left), so they work at every size. Desktop and mobile each have their own block.

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

- `hotspot`: the clickable outline of each lock. The real control is an HTML button over it (keyboard and screen reader), sized at least 44×44 px.
- `candle`: where code draws that lock's flame (the wax candle body is in the lock layer; the **flame is code**).
- `ambientCandles`: always-lit decorative candles (wall sconces); code draws their flames too.
- `panelSide`: which side the question panel opens on, so it never covers its lock.
- The renders and `scene.json` are produced together from the Blender camera, so they always match.
- `depth`: each lock's distance from the camera in metres. Hotspots can overlap (the pin frame stands partly behind the altar); when they do, the lock with the smaller depth is on top.
- `size`: the frame the coordinates were measured on. All layers are full-frame (same size as the background) and stack at 0,0.
- **Contact shadows are baked into `background.webp`** (lock objects are invisible to the camera there but still cast shadows), so lock layers are just the objects. Locks never move, so this is exact.

---

## 5. How candles work (the core metaphor)

1. **One candle rule.** An unsolved lock's candle is **unlit**: wax and a dark wick, **no flame and no light**. `background.webp` and every lock layer are rendered that way, with only the cold ambient light and each lock's dim cool face light. Nothing is baked in that code would need to switch off. (Wall sconces in `ambientCandles` are the only always-lit flames.)
2. For each lock, `light-<lock>.webp` holds **only the extra warm light** that lock's candle adds when lit (rendered as lit minus unlit, on black).
3. When a lock is solved, code **ignites** that candle: it draws a gold flame at the lock's `candle` point (a short flare, then a steady flicker) and fades its light pass in over about 600 ms. With reduced motion both switch on instantly. There is no teal or "unlit" flame; before solving, code draws nothing at `candle`.
4. Several solved locks simply add their light passes together, so the room warms up lock 5. **Three states, three different signals.** *Available:* every lock is lit by its own dim cool light from high in front, all at the same angle, so its working face is readable but the room stays dark. *Hovered or keyboard-focused:* code crossfades `lock-<lock>.webp` to `lock-<lock>-hover.webp` (the same lock under a brighter **cool-white** light) over about 200 ms, and back on leave (instant with reduced motion); code may also add a thin outline glow on the hotspot. *Solved:* the lock's candle ignites gold and its light pass adds a **warm** pool. Warm means solved only; hover never uses warm light.s solved.
6. A lock answered wrong or skipped stays unlit. If its concept later returns as a ghost and is answered correctly, the light belongs to the room where that happens: code draws a small **spirit candle** at one of the room's `ghostAnchors` (flame and glow in code, no light pass). A challenged lock never lights.

---

**Note (v1.1):** `design-system.md` still describes unsolved candles as a "teal flame". That wording is superseded by point 1: unsolved means no flame at all.

## 6. One rule this needs from the runtime and generation specs

Each room shows each lock type **at most once** (a room has at most six locks, one per type). The art has one station per lock type per room; unused types are not drawn (their layers are hidden). Spec 3's room composer must respect this. If a document supports fewer types, rooms simply have fewer locks.

**The final door is different:** it holds 2–4 reserved questions plus every outstanding ghost and deferred skip, so lock types can repeat there. Its art (the B15 door) shows **seals on the door** as slots, not lock stations; code draws one seal per slot and each breaks when its slot is solved or settled (not the same as `sealCracked`, which is the challenge animation on a lock).

**What the art needs from the runtime (spec 2):** per room, each lock's type and status (`open`, `solved`, `settled`, `challenged`) and whether its candle is lit; the list of pending ghosts; whether the room is cleared (door open); and the events `candleLit`, `ghostSpawned`, `ghostLaidToRest`, `sealCracked`, `roomCleared`, `escaped`. Lock IDs must match section 3.

---

## 7. Placeholders (for Kiro, now)

Kiro creates placeholder files with exactly these names and sizes (flat dark teal backgrounds, simple labelled shapes for locks, a soft orange blob for light passes, a 2-second black clip for motion) plus a `scene.json` for `burial-chamber` with rough coordinates. A test checks that every file `scene.json` refers to exists. Real renders replace placeholders file for file.

---

## 8. Delivery order (art track)

1. `burial-chamber`: desktop background, six lock layers, six light passes, foreground, door, `scene.json`
2. `burial-chamber` mobile framing
3. Lock close-ups (closed and open) for rune cipher and séance board (Gate 1), then the rest
4. Desk scene and book spines
5. Motion clips (rendered by the author): descent first, then final door, title and to-desk, escape
6. The other three rooms
7. Optional: `safe-dial.glb`

# Handoff: art chat (Blender), from Nov 28

> Copied into the repo on Nov 28 so the code chat can read the art plan and its constraints. Section 7.4 below matters to the code chat: the lock overlay always puts the parchment panel on the **right**.

The art chat produces the rendered art for **Escape the Crypt** with the author, through the Blender MCP on computer 1. The contract is `docs/briefs/asset-contract.md` (v1.6) plus the additions in section 4.

---

## 1. What the author wants

**Consistent, clean, playable and readable. No realism needed.** Slightly low-texture or a bit makeshift is fine; inconsistency, blur on things the player must find or read, or anything that can't drop straight into the app is not.

1. **One look everywhere.** Reuse the existing Blender scenes, materials, lighting rig and camera conventions. When in doubt, simpler and matching beats detailed and different.
2. **Dark, with one warm light.** Cold blue-black and teal ambient; warm gold only from candles. Interactive objects get a dim, even cool key light so their silhouette is always clear.
3. **Sharp where it matters.** No depth-of-field blur and no fog on interactive objects. Clean alpha edges on every layer.
4. **Strong silhouettes**, recognisable at phone size.
5. **No text in the art, ever.** Code draws all words.
6. **Drop-in ready.** Exact names, sizes, formats and budgets.

---

## 2. What already exists

In `apps/web/public/art/`: rooms `burial-chamber` (desktop and mobile; desktop re-rendered crisp with v1.6 shadows), `library-of-bones` (desktop), `sunken-chapel` (desktop), each with `scene.json` and all lock, light, hover, solved and door layers; `locks/<type>/closed|open.webp` (and `@2x`) for all six types; `desk/` (background, candle, foreground, book spines, desktop and mobile); motion clips `descent-desk`, `descent`, `final-door`, `escape`; posters only for `title`, `to-desk`, `room-to-room`.

---

## 3. Deliverables, ranked

- **R1.** Sharper rooms with the contact shadows inside the lock layers (asset contract v1.6), all three rooms, desktop. (`burial-chamber` done.)
- **R2.** Lock close-ups for the overlay: `locks/<type>/closed.webp` and `open.webp` at 1920×1080 plus `@2x`. Object large in the **left 60%**, right 40% dark and empty for the parchment panel.
- **R3.** Desk as the menu: background without props, plus `prop-<id>.webp` and `prop-<id>-hover.webp` for `notes-book`, `crypt-stack`, `sample-chest`, `import-letter`, `crypt-stairs`; `desk/scene.json` (section 4). Desktop, then mobile.
- **R4.** `motion/title.*` (seamless 6–10 s loop, no lightning baked in) and `motion/to-desk.*` (1.5–2.5 s push-in ending exactly on the desk-menu frame).
- **R5.** `motion/stairs-loop.*` (seamless 6–10 s loop for the generation wait; right third darker for a progress card).
- **R6.** Mobile room sets for `library-of-bones` and `sunken-chapel`, and `burial-chamber/mobile` redone.
- **R7.** Optional: `motion/room-to-room.*`; a fourth room `crypt-hall`.

---

## 4. Contract additions

```
art/desk/desktop/background.webp        1920×1080, no interactive props, candle body unlit
art/desk/desktop/background@2x.webp     2560×1440
art/desk/desktop/foreground.webp        optional, alpha
art/desk/desktop/prop-<id>.webp         full-frame, alpha
art/desk/desktop/prop-<id>-hover.webp   same prop under the cool-white hover light
art/desk/mobile/(same names, 1080×1920)
art/desk/scene.json
```

```json
{
  "version": 2,
  "desktop": {
    "size": [1920, 1080],
    "props": {
      "notes-book":    { "hotspot": [[0.30,0.45],[0.70,0.45],[0.72,0.80],[0.28,0.80]], "label": { "x": 0.50, "y": 0.84 } },
      "crypt-stack":   { "hotspot": [["..."]], "label": { "x": 0, "y": 0 } },
      "sample-chest":  { "hotspot": [["..."]], "label": { "x": 0, "y": 0 } },
      "import-letter": { "hotspot": [["..."]], "label": { "x": 0, "y": 0 } },
      "crypt-stairs":  { "hotspot": [["..."]], "label": { "x": 0, "y": 0 } }
    },
    "candle": { "x": 0.74, "y": 0.42, "scale": 1.0 }
  },
  "mobile": { "...": "same shape" }
}
```
- `hotspot`: the prop's clickable outline (the real control is an HTML button over it, at least 44×44px).
- `label`: where code draws the prop's parchment tag.
- `candle`: where code draws the desk candle's flame.

Formats: WebP q80 with alpha; desktop 1920×1080 and @2x 2560×1440; mobile 1080×1920; clips WebM VP9 + MP4 H.264, 30 fps, no audio, ≤ 3 MB; posters ≤ 250 KB.

---

## 5. Delivery

Files go straight into `apps/web/public/art/` on computer 1 with the exact names. Before calling a set done: sizes checked, alpha clean, budgets met, `scene.json` parses and every file it names exists, a hotspot overlay checked by eye, no text. `ASSETS.md` updated. The author commits with exact paths only (never `git add -A`, never `.blend` files).

---

## 7.4 (for the code chat) Panel side

The current close-up overlay takes a `side` from `scene.json` `panelSide` (`lock-closeup.tsx`, `panel-side.ts`). R2 assumes the panel is always on the **right** (object left 60%, panel right 40%, per `docs/briefs/six-locks-mockup-brief.md` section 2). **Decision: the code chat fixes the lock overlay's parchment panel to the right for every lock**, so the art chat renders every close-up with the object on the left. `panelSide` stays in `scene.json` (the room screen may still use it) but the overlay ignores it.

One close-up per lock type is reused in every room, as named in the contract.

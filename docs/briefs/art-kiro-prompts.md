# Paste-ready Kiro prompts for the art (drafted overnight, Nov 25)

These are prompts for Kiro. Kiro writes all of the app code; nothing here is code.

---

## Prompt 1: update `ASSETS.md`

> Update `ASSETS.md` to cover the Blender-rendered art that is now in `apps/web/public/art/`. Keep the existing sections and wording style. Make these changes:
>
> 1. Add a section **"3D-rendered artwork (Blender)"** above "AI-generated artwork". Put a table in it with these columns: Asset · Type · Source · Licence / terms · Notes. Add these rows:
>    - **Burial chamber room layers.** `rooms/burial-chamber/desktop/*` and `rooms/burial-chamber/mobile/*`: background, lock layers, `-hover` / `-solved` / `-solved-hover` variants, light passes, door open/closed, foreground, `scene.json`. Rendered by the author in Blender 5.2 (Cycles) from a scene built by the author with Claude's help through the Blender MCP. All scene modelling, lighting and render setup is original. The source `.blend` is kept outside the repo, in the adjacent design-refs workspace.
>    - **Lock close-ups.** `locks/<lock>/closed[@2x].webp` and `open[@2x].webp`, all six locks. Same source as above.
> 2. Add a section **"Textures (CC0)"**. Columns: Texture · Source · Licence · Used on. Fill it with the Poly Haven texture sets used in the scene. The list is at the end of this file under "Poly Haven textures in the scene"; copy the names exactly. Source is `https://polyhaven.com`; licence is CC0 1.0.
> 3. In "AI-generated artwork", the row "Background and object layers (crypt rooms, desk, lock objects, exit door)" is now wrong, because the shipped room art is rendered in Blender. Change it to say the ChatGPT images were used **only as references and as decals or textures applied inside the Blender scene**, not shipped as layers. Keep the disclosure. Add one row for **ChatGPT reference images** (`3d/refs/`, 64 images, reference only, not shipped) and one for **ChatGPT texture decals** (`3d/textures/`: `tex-seance-board.png`, `tex-safe-dial.png`, `tex-door.png`, `tex-rune-tablet.png`, `tex-sigil.png`, applied as decals in the Blender scene, so they appear inside the rendered images).
> 4. Do not add any other files. Do not change code. Run the existing markdown lint if there is one.

### Poly Haven textures in the scene

All are Poly Haven 2K sets (diffuse, normal, roughness and displacement maps), CC0 1.0:

| Texture | Used on |
|---|---|
| `castle_wall_slates` | crypt walls |
| `medieval_blocks_06` | stone masonry, plinths and lock stonework |
| `pavement_01` | floor flagstones |
| `rock_01` | rough pillar stone |
| `metal_plate_02` | the safe |
| `weathered_planks` | the exit door and wooden parts |

---

## Prompt 2: room-screen art integration (give this once the room-screen spec starts)

> When you write the requirements and design for the room screen, build the scene from the layered art in `apps/web/public/art/rooms/<room>/`, following `docs/art/asset-contract.md` (v1.1). In short:
>
> **Stack** (every layer is full-frame, the same size as the background, positioned at 0,0, in this order):
> 1. `background.webp` (`background@2x.webp` for high-DPI screens). On a portrait viewport narrower than 0.75 aspect, use the `mobile/` set and the `mobile` block of `scene.json`.
> 2. For each lock the room uses, one lock layer: `lock-<lock>.webp` while the lock is open, `lock-<lock>-solved.webp` once it is solved or settled. On hover or keyboard focus, crossfade to the matching `-hover` file (`lock-<lock>-hover.webp` or `lock-<lock>-solved-hover.webp`) over about 200 ms. Lock types the room doesn't use are not drawn.
> 3. Light passes `light-<lock>.webp`, composited with `mix-blend-mode: plus-lighter` (fall back to `screen`). Each starts at opacity 0 and fades to 1 over about 600 ms when that lock's candle lights. Solved passes add up.
> 4. `door-closed.webp`, swapped for `door-open.webp` with `light-door.webp` (additive) when the room is cleared.
> 5. `foreground.webp`, which carries the strongest parallax.
>
> **Candles:** an unsolved candle has no flame, and code draws nothing at its `candle` point. On `candleLit`, draw a gold flame at the lock's `candle` point (fractions of the frame): a short flare, then a gentle flicker. At the same moment, fade in the light pass and crossfade the lock layer to `-solved`. `ambientCandles` are the always-lit wall sconces, and code draws small gold flames on them from the start. There is no teal flame anywhere.
>
> **Hotspots:** each lock's `hotspot` polygon gets a real `<button>` positioned over it, labelled with the lock's name and status, at least 44×44 px. Where hotspots overlap, the lock with the smaller `depth` is on top. The question panel opens on the lock's `panelSide`.
>
> **Motion:** parallax uses the `parallax` factors and moves only a few pixels with the pointer or device tilt. Reduced motion turns off parallax and flicker, and makes every crossfade instant.
>
> **Close-ups:** behind the question panel, show `locks/<lock>/closed.webp`, switching to `open.webp` when solved.
>
> **Tests:**
> - every file `scene.json` refers to exists
> - every lock in a room has all four of its layers (lock, hover, solved, solved-hover) plus its light pass
> - a Playwright check that hover and focus swap the layer, and that solving a lock adds its light pass and flame
>
> Keep the placeholders working when a file is missing (log once, don't crash).

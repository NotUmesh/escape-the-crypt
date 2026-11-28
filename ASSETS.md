# Assets and licences

The code, specs, tests, hooks and steering in this repository were built primarily with Kiro (spec-driven sessions, task execution and agent chats). Some small fixes, configuration and documentation were written by hand or with other AI assistants, and planning briefs, evaluation drafts and art prompts were prepared with other AI tools; the git history shows each change. The table below lists every asset that was not made in this repository.

## AI-generated artwork (disclosed)

| Asset | Type | Source | Licence / terms | Notes |
|---|---|---|---|---|
| Concept references (A–E sets, early crypt images) | images | ChatGPT image generation (OpenAI), prompted by the author | Output owned by the author under OpenAI's terms of use | Reference only, not shipped. Prompt log: `docs/art/generation-prompts.md` |
| Background and object layers (crypt rooms, desk, lock objects, exit door) | images | ChatGPT image generation (OpenAI), prompted by the author | As above | Shipped in `apps/web/public/art/`. Each file is listed in the prompt log with the prompt that made it |
| Blender decals, trim strips, and material swatches | 13 PNG textures | ChatGPT image generation (OpenAI) | As above | Generated for Blender in the adjacent design-refs workspace, under `3d/refs/`. `decal-seance-board.png`, `decal-rune-tablet-front.png`, `decal-safe-dial.png`, `decal-sigil.png`, `decal-sigil-mask.png`, `decal-door-planks.png`, `decal-tracery-panel.png`, `strip-brass-filigree.png`, `strip-stone-moulding.png`, `strip-velvet-trim.png`, `swatch-velvet-plum.png`, `swatch-leather-dark.png`, `swatch-wax.png` |
| Room sets, desktop: burial chamber, library of bones, sunken chapel (`rooms/<room>/desktop/*.webp`, `rooms/<room>/scene.json`) | 36 WebP layers + JSON per room | Rendered in Blender (Cycles) by the author, set up with Claude through the Blender MCP | Author's own work | Re-rendered Nov 28 (R1): crisp lock layers without fog, each lock's contact shadow inside its own layer, background rendered with locks hidden. Uses the textures above |

All interface elements (panels, buttons, text, candles' glow, grain, vignette, ghost wisps, the sigil outline) are drawn in code, not generated.

## Fonts

| Asset | Type | Source | Licence | Notes |
|---|---|---|---|---|
| Cinzel / Cinzel Decorative | font | Google Fonts | SIL Open Font License 1.1 | Titles only |
| Crimson Pro (fallback EB Garamond) | font | Google Fonts | SIL Open Font License 1.1 | Questions and body text |

Self-hosted woff2 files (latin subset, from the `@fontsource` packages 5.3.0, downloaded once and committed) are in `apps/web/public/fonts/`. The app never loads fonts from another origin.

| Files | Licence file |
|---|---|
| `cinzel-latin-400-normal.woff2`, `cinzel-latin-700-normal.woff2` | `OFL-cinzel.txt` |
| `cinzel-decorative-latin-400-normal.woff2`, `cinzel-decorative-latin-700-normal.woff2` | `OFL-cinzel-decorative.txt` |
| `crimson-pro-latin-400-normal.woff2`, `crimson-pro-latin-400-italic.woff2`, `crimson-pro-latin-600-normal.woff2` | `OFL-crimson-pro.txt` |

EB Garamond is named only as a CSS fallback and is not shipped.

## Sound

| Asset | Type | Source | Licence | Notes |
|---|---|---|---|---|
| (none yet) | sound | | CC0 only | Sound is optional and off by default |

## Sample content

All sample study notes and artwork in `/samples` are original work by the author.

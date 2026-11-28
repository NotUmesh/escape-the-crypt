# Six locks: design mockup brief

> **Copied into the repo on Nov 28 from the project's design docs.** Decisions made since it was written take precedence: the high-contrast look is always on and there is no Lantern toggle (so ignore the "Lantern mode" extra frame in section 4); the lock reactions are crossfades between the existing `closed` and `open` close-up art plus the candle and ghost effects, not bespoke per-lock animations; the Submit button is the code-drawn oxblood wax seal from the costume system (see the code handoff, section 5), not a flat `candle-400` button. Everything else here, especially the layout in section 2, is the reference for Step 3.

A visual brief for mocking up the six lock screens, in Figma, by hand, or with a design tool. It describes **what each screen looks like**, not how the game logic works.

Flagship example content: **the human heart**.

---

## 1. Shared foundations

### Canvas sizes

- **Desktop:** 1440 × 900
- **Mobile:** 390 × 844

Design desktop first, then the mobile version of each lock.

### Palette

| Token | Hex | Use |
|---|---|---|
| `stone-950` | #0E0D0C | Background, deepest shadow |
| `stone-800` | #2A2623 | Panels behind parchment, room surfaces |
| `stone-300` | #B8AFA6 | Secondary text, inactive icons |
| `bone-50` | #F4EFE6 | Primary text on dark |
| `parchment` | #E9DFC8 | Question and evidence panel surface |
| `ink` | #2B2118 | Text on parchment |
| `candle-400` | #F2A33A | Warm light, success, solved rims, candle flames |
| `ember-600` | #B4471F | Emphasis, the wax seal |
| `spectre-300` | #9FD4D0 | Ghosts, interactive glow, focus outline (the one cool accent) |

**Mood:** 80% dark stone, 15% warm candlelight, 5% cool ghost teal. Warm means progress; teal means interactive or ghostly.

### Typography (free on Google Fonts)

- **Titles and lock names:** *Cinzel*, 28–40px, letter-spacing +2%
- **Questions, options, evidence:** *Crimson Pro*, 20px on desktop, 18px on mobile, line-height 1.5, minimum 16px
- **Small UI labels** (buttons, states): *Crimson Pro* semibold, 16px

### Materials and textures

Subtle, never behind body text:
- stone with soft grain
- aged parchment with faint fibres and darkened edges
- dripping wax
- tarnished brass
- dark oiled wood
- bone (warm off-white with soft cracks)

### Light

- Every lock scene has one warm key light (a candle) from upper left or right, and a soft vignette.
- The parchment panel is **always evenly lit** (the always-lit rule).

---

## 2. Lock screen layout (the same for all six)

The lock opens as an overlay over a blurred, darkened crypt room.

**Desktop, 1440 × 900**

```
┌──────────────────────────────────────────────────────────────┐
│ ← Back to the room          RUNE CIPHER           🕯 3 hints │  top bar, 64px
├───────────────────────────────┬──────────────────────────────┤
│                               │  ┌────────────────────────┐  │
│                               │  │  PARCHMENT PANEL       │  │
│      LOCK OBJECT              │  │  Question (Crimson Pro)│  │
│      (illustration +          │  │                        │  │
│       interactive parts)      │  │  Answer controls       │  │
│      ~ 60% width              │  │  (if they live here)   │  │
│                               │  │                        │  │
│                               │  └────────────────────────┘  │
│                               │   ~ 40% width, 520px max     │
├───────────────────────────────┴──────────────────────────────┤
│  [Use a candle hint]   [Skip]   [Challenge this question]    │
│                                               [ SUBMIT ]     │  action bar, 88px
└──────────────────────────────────────────────────────────────┘
```

**Mobile, 390 × 844:** stacked. Top bar (56px), then the object (about 40% of the height), then the parchment panel (scrollable), then a sticky action bar at the bottom with **Submit** full width above three smaller text buttons.

### Action bar buttons

| Button | Style |
|---|---|
| **Submit** | The primary action (wax seal in the costume system), ink or bone text, 48px tall; disabled state is reduced opacity plus `aria-disabled` |
| **Use a candle hint** | Plaque button with a small candle icon and the remaining count |
| **Skip** | Plaque button |
| **Challenge this question** | Plaque button with a small wax-seal icon |

The **focus state** on any control is a 2px `spectre-300` outline with a 3px offset. All targets are at least 44 × 44px.

### The parchment panel

- `parchment` background, `ink` text, 24px padding, soft drop shadow
- A tiny lock-type label at the top in small caps, `stone-800`
- The question begins "According to your notes…"

### The evidence panel (after Submit, same position)

Replaces the parchment content with a quick page-turn:

1. **Result line:** "The candle catches." (correct) / "Not this time." (wrong) / "Question withdrawn." (challenged). Use the existing copy in `packages/core/src/copy-room-play.ts` where it already exists.
2. **Passage:** "From your notes · PDF page 4", with the quoted words highlighted (`candle-400` at 35% behind the text)
3. **One- or two-sentence explanation**
4. **Trust chips:** small pill labels such as "Source excerpt matched" and "Blind model review passed"
5. **Continue** button (primary)

### Screens to check for every lock (5 states each)

1. **Default:** freshly opened, nothing answered
2. **In progress:** an answer partly entered or selected
3. **Correct:** the object crossfades to its open art, plus the evidence panel
4. **Wrong:** a ghost rising, plus the evidence panel
5. **Hint used:** the hint's visible effect, and the hint counter decreased

Also check **one Challenge state** (on any lock): the wax seal cracking on the parchment.

---

## 3. The six locks

### Lock 1: Rune cipher

**Scene:** a stone wall in close-up. A rectangular **stone tablet**, about 520 × 360px on desktop, is set into it, with carved borders and moss in the corners. A candle in an iron sconce sits upper right.

**The object**
- A row of shallow, empty **carved rune slots** across the middle of the tablet, matching the answer length only when the difficulty shows the letter count.
- Below it, a clean, legible **text field** set into a smooth inset band of the stone: `bone-50` text on `stone-800`, Crimson Pro 22px, 56px tall, labelled "Your answer".

**Parchment:**
> *"According to your notes, the valves between the atria and ventricles are called the ______ valves."*

**States**
- **Default:** empty field, slots dark.
- **In progress:** "atrioven…" typed, slots still dark (there's no live letter feedback).
- **Correct:** open art; the word shown on the parchment.
- **Wrong:** a small ghost rises.
- **Hint:** the first slot shows a faint "A", with a small label "Hint: 16 letters, starts with A".

**Mobile:** the tablet becomes a horizontal band at the top; the field is full width below it.

---

### Lock 2: Séance board

**Scene:** looking down at a round **wooden table** covered in a dark velvet cloth. A **séance board** (dark walnut, brass inlay, a sun and moon at the top corners) sits at the centre, with two candles at the far edge.

**The object**
- A heart-shaped **planchette** (pale wood with a round glass lens) at the centre of the board.
- **The 3–4 options are large, readable rows**, arranged as a clear vertical list, not around the rim. Each row is about 64px tall, in Crimson Pro 20px, with a letter marker (A, B, C, D) engraved in brass.

**Parchment:**
> *"According to your notes, which chamber pumps oxygen-rich blood to the body?"*

**States**
- **Default:** all options equal.
- **In progress:** one option selected, with a soft `spectre-300` outline on the row.
- **Correct:** open art.
- **Wrong:** a ghost rises.
- **Hint:** one wrong option faded to 25% opacity, with a small "Hint: one wrong answer removed".

**Mobile:** the options as a full-width list.

---

### Lock 3: Bone ordering

**Scene:** an **ossuary niche** carved into stone, with a long wooden shelf. Skulls are stacked softly in the dim background (stylised, friendly, never gory).

**The object**
- **Numbered sockets** (I, II, III, …) for the steps.
- **Bones**, each a horizontal bar about 300 × 64px, warm off-white, with its step text **printed clearly on a small parchment tag tied to the bone** (Crimson Pro 18px, `ink`).
- Each bone has **▲ and ▼ buttons** on its right end: 44px, `stone-800` with `bone-50` arrows.

**Parchment:**
> *"According to your notes, put the path of blood through the right side of the heart in order."*

**States**
- **Default:** the shuffled order.
- **In progress:** one bone selected (lifted slightly, teal outline).
- **Correct:** open art.
- **Wrong:** a ghost rises; the evidence shows "Your order" and "Order in your notes" side by side.
- **Hint:** bone I locked in place with a small iron clasp icon and "Locked by hint".

**Mobile:** a vertical stack (I at the top), with the bones full width and the ▲▼ buttons on the right.

---

### Lock 4: Bound threads

**Scene:** an **old wooden frame**, like a loom or a pinboard, mounted on stone. Dark oiled wood with tarnished brass pins.

**The object**
- **Two columns**, 3–4 items each. **Left:** items on small brass plates. **Right:** matches on parchment slips.
- Each item is a full-width tappable card, about 280 × 64px, with its brass pin facing the centre.
- **Threads** between the pins: `spectre-300` while connecting, `candle-400` when correct.

**Parchment:**
> *"According to your notes, connect each part to its job."*

**States**
- **Default:** no threads.
- **In progress:** one item selected (outline, pin lit), one thread tied.
- **Correct:** open art.
- **Wrong:** a ghost rises.
- **Hint:** one thread tied with a small knot icon and "Tied by hint".

**Mobile:** the two columns stay side by side but narrower (each card about 160px), with text wrapping to two lines.

---

### Lock 5: Cursed object

**Scene:** a low **stone altar** in a chapel alcove, with a gothic arch behind it.

**The object**
- **4 distinct objects** in a row, each with its **label on a brass plaque** below (Crimson Pro 18px, `bone-50` on `stone-800`).

**Parchment:**
> *"According to your notes, three of these are chambers of the heart. Which one is not?"*

**States**
- **Default:** all four objects evenly lit.
- **In progress:** one selected, lifted slightly with a `spectre-300` outline.
- **Correct:** open art.
- **Wrong:** a ghost rises; the evidence states the category rule.
- **Hint:** a parchment ribbon stating the category ("Three of these are chambers of the heart.").

**Mobile:** a **2 × 2 grid** of objects, each with its plaque.

---

### Lock 6: Combination dial

**Scene:** a heavy **iron safe door** set into the crypt wall.

**The object**
- A **digit display** of 1–3 brass wheels showing the current value; **each wheel** has large **+ and −** buttons above and below it (44px).
- A plain **number input field** ("Or type the number"), with the **units** shown next to it.

**Parchment:**
> *"According to your notes, how many chambers does the human heart have?"*

**States**
- **Default:** the wheels show 0.
- **In progress:** the wheel shows a value.
- **Correct:** open art.
- **Wrong:** a ghost rises.
- **Hint:** none for the dial in this version (the hint is unreachable by design).

**Mobile:** the wheels and input stacked below the object.

---

## 4. Extra frames to check

1. **Crypt room overview:** the room with the locks, the progress candles, a ghost and the sealed exit door.
2. **Ghost return:** a ghost with a small parchment tag naming the returning concept.
3. **Lingering spirit:** a faint glow over a settled object, labelled "Review due".

---

## 5. Consistency checklist

- [ ] Every lock uses the same layout: object on the left, parchment on the right, action bar along the bottom.
- [ ] Question and option text is never under 16px and always sits on an evenly lit surface.
- [ ] Every state is shown with an icon and text, never colour alone.
- [ ] Gold means solved or progress; teal means interactive or ghost. Red is never used for mistakes.
- [ ] Each object has a distinct silhouette.
- [ ] Every interaction has visible buttons; dragging is never required.
- [ ] The tone is atmospheric but friendly: no gore, no jump scares.

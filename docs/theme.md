# The Rustward Concession — visual theme, design system, and build plan

A reskin of Fantastic Factories. Three references, each doing one job:

- **Dota 2** — the *UI*. Dark, dense, high contrast, glow means "actionable".
- **Dune: Imperium** — the *world*. Industrial, harsh, resource-heavy, brutalist desert.
- **Architects of the West Kingdom** — the *tactility*. Parchment, woodcut, and a
  visible sense that a plan became a building.

Nothing here changes the rules. `src/engine/` is untouched by all of it.

---

## 1. Theme and lore

**The Rustward Concession.** Three centuries after the Sundering dropped the
sky-foundries into the deep desert, the Guild parcels the glass flats into
*concessions* — squares of scorched ground with a wreck buried somewhere under
them. You hold one. Your Seat is a slab of poured basalt with three shafts sunk
into it: the Survey, the Kiln, and the Delve. Every dawn your crew rolls out of
the barracks, and what they are worth that day is what they are worth; you spend
them and you do not get to argue. Metal comes up out of the sand in torn sheets.
Energy is drawn off the old aether-lines that still hum under the crust. Goods
are the only thing the Guild will actually take in trade.

What you draft are **Foundry Writs** — arcane blueprint plates stamped in a
script nobody alive can compose any more, only copy. Each is a promise that if
you feed it scrap and current it will give back something the desert cannot.
Cheap writs raise sheds. Expensive ones raise works with chimneys that stain the
sky. And a handful — the Megaliths — raise things that outlive the concession,
the ones the Guild counts as *prestige* when the ledger finally closes. The
**Contractors** are freeholders passing through: they will do one thing for you,
today, for the price of a plate out of your own folio, and then they are gone. In
the Rustward you are not building a factory. You are building the argument that
you were ever here.

**Naming map** (rename in `src/lib/format.ts` and card data only):

| Engine term | Themed name |
|---|---|
| blueprint | Foundry Writ / plate |
| contractor | Freeholder |
| compound | the Works |
| headquarters | the Seat |
| research / generate / mine | Survey / Kiln / Delve |
| die | shift |
| prestige | standing |
| monument | Megalith |

---

## 2. Design system

### 2.1 Palette

Dark-only by design. Drop the `prefers-color-scheme` fork in `globals.css` and
set `color-scheme: dark` unconditionally — a light variant of this theme is a
different theme, not a toggle.

**Backgrounds — cold iron, never pure black**

| Token | Hex | Use |
|---|---|---|
| `--color-void` | `#0B0C0E` | page base |
| `--color-deep` | `#121417` | wells, rail backdrops |
| `--color-surface-1` | `#1A1D21` | cards, panels |
| `--color-surface-2` | `#23272C` | raised, hover |
| `--color-surface-3` | `#2E333A` | bevel highlight, top edge |
| `--color-edge` | `#3A4048` | hairline borders |
| `--color-edge-bright` | `#565E68` | active borders |

**Primary UI — steel**

| Token | Hex | Use |
|---|---|---|
| `--color-steel-100` | `#C9D1D9` | primary text |
| `--color-steel-300` | `#8B949E` | secondary text, meta lines |
| `--color-steel-500` | `#5A636E` | disabled, struck-through prices |

**Accent / glow — spice**

| Token | Hex | Use |
|---|---|---|
| `--color-spice-400` | `#FF8A3D` | glow, hover rim |
| `--color-spice-500` | `#E2660F` | primary accent, actionable rim |
| `--color-spice-600` | `#B44A08` | pressed |

**Secondary accent — aether** (drop targets, dice in flight; replaces `#5290e8`)

| Token | Hex |
|---|---|
| `--color-aether-400` | `#4DD5E8` |
| `--color-aether-500` | `#35C6DC` |

**Parchment and blueprint** (Architects layer)

| Token | Hex | Use |
|---|---|---|
| `--color-parchment` | `#E8DCC0` | card text plate |
| `--color-parchment-dim` | `#CBBE9E` | plate edges, worn areas |
| `--color-ink` | `#2A2318` | text on parchment |
| `--color-blueprint` | `#16324F` | art box ground (cyanotype) |
| `--color-blueprint-line` | `#7FB3D9` | woodcut line art |

**Resources** — must survive being 12px tall next to a number.

| Token | Hex | Resource |
|---|---|---|
| `--color-res-metal` | `#9AA7B4` | metal (cold sheet) |
| `--color-res-energy` | `#FFC53D` | energy (arc) |
| `--color-res-goods` | `#5FBF8A` | goods (crated) |
| `--color-res-standing` | `#D9B44A` | prestige (gilt) |

**Semantic states**

| Token | Hex | Meaning |
|---|---|---|
| `--color-legal` | `#46B37E` | you can act here (keeps today's `#4fb37c`) |
| `--color-chosen` | `#E3B341` | mid-choice, this is the card being paid for |
| `--color-target` | `#35C6DC` | the dragged die may land here |
| `--color-danger` | `#D94F3D` | over a limit, blocked |

**Replacements for `src/lib/colors.ts`** — the highest-leverage edit in the repo.

```ts
// DIE_SWATCHES — six crews, desaturated into the palette
red    #B5402F  border #D4664F  text #F2E8DF
blue   #2F6FA8  border #5A9BD1  text #F2E8DF
green  #3E8C63  border #63B589  text #F2E8DF
purple #6C4AA6  border #9375CE  text #F2E8DF
yellow #C99A22  border #E8BC4A  text #17140F
white  #D6D3C9  border #A9A69C  text #17140F   // bone, not white

// BLUEPRINT_TOOL_SWATCHES — guild marks
hammer #A94E28   wrench #1E6F79   gear #5A4FA3   shovel #6B7A2B

// BLUEPRINT_CATEGORY_SWATCHES — printed bands, flatter than the marks
production #2C5D8A   utility #B8862B   training #A33B2E
monument   #6E6A63   special #6B4E9E
```

### 2.2 Typography

Three families, all on `next/font/google`, all self-hosted at build time — which
matters because this ships as a static export to Workers.

| Role | Font | Weights | Notes |
|---|---|---|---|
| Display | **Cinzel** | 600, 700 | Title, Megalith names, game-over. Roman caps = the Guild's authority. Never below 16px. |
| UI label | **Oswald** | 400, 500 | Section headers, buttons, card names. Condensed industrial. `uppercase`, `tracking: 0.07em`. |
| Body / numerals | **Inter** | 400, 500, 600 | Everything else. `font-variant-numeric: tabular-nums` on every count, cost, and die face. |

Optional fourth: **Spectral** 400 for card rules text on the parchment plate — a
serif at 11–12px reads as *printed* rather than as *UI*, which is exactly the
Architects feel. Add it only if you accept the extra ~14kB.

Scale (tight, Dota-dense):

```
display   28 / 1.15  Cinzel 700  tracking -0.01em
h1        20 / 1.2   Cinzel 600
label     11 / 1.0   Oswald 500  uppercase  tracking 0.08em
card-name 13 / 1.2   Oswald 500  uppercase  tracking 0.04em
body      13 / 1.45  Inter 400
card-text 11.5/ 1.4  Spectral/Inter 400
micro     10 / 1.3   Inter 500   uppercase  tracking 0.06em
```

### 2.3 Texture and material

Five recipes. All pure CSS — no image assets, no bundle cost.

**Global grit.** One fixed pseudo-element on `body`, drawn once:

```css
body::after {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 100;
  opacity: 0.045;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
```

**Brushed brass.** Vertical gradient for the form, a 1px repeating gradient for
the grain, inset highlight top and shadow bottom for the bevel:

```css
background:
  repeating-linear-gradient(90deg, rgb(255 255 255 / 6%) 0 1px, transparent 1px 3px),
  linear-gradient(180deg, #3a3128 0%, #241e18 55%, #171310 100%);
box-shadow:
  inset 0 1px 0 rgb(255 214 153 / 22%),
  inset 0 -2px 6px rgb(0 0 0 / 55%),
  0 1px 0 rgb(0 0 0 / 60%);
```

**Worn parchment.** Base fill plus two off-centre stains, plus an inner vignette
so the edges look handled:

```css
background:
  radial-gradient(120px 80px at 15% 20%, rgb(120 92 48 / 14%), transparent 70%),
  radial-gradient(160px 100px at 85% 80%, rgb(120 92 48 / 12%), transparent 70%),
  var(--color-parchment);
box-shadow: inset 0 0 24px rgb(90 66 30 / 28%);
```

**Cyanotype grid** for the card art box:

```css
background:
  repeating-linear-gradient(0deg, rgb(127 179 217 / 10%) 0 1px, transparent 1px 8px),
  repeating-linear-gradient(90deg, rgb(127 179 217 / 10%) 0 1px, transparent 1px 8px),
  var(--color-blueprint);
```

**Glow.** Dota's glow is a *rim*, not a bloom: a crisp bright 1px edge, then a
short soft falloff, then nothing. Three layers, always in this order:

```css
box-shadow:
  0 0 0 1px rgb(226 102 15 / 55%),      /* the edge  */
  0 0 18px -4px rgb(255 138 61 / 65%),  /* the falloff */
  inset 0 1px 0 rgb(255 255 255 / 6%);  /* the bevel, kept */
```

Never animate `box-shadow` — cross-fade the opacity of a positioned
pseudo-element instead. Never use `filter: blur()` for glow; it forces a raster
pass on every card.

---

## 3. UI/UX layout

### 3.1 The cockpit

Today: one 1100px column, market on top, player panels stacked, a 300px rail.
That works but wastes the widescreen and buries your own engine below the fold.

Replace with a four-zone fixed shell. Nothing scrolls except the centre and the
rails — the dock is always there, because it is *you*.

```
┌──────────────────────────────────────────────────────────────────────┐
│ TOP BAR 52px   ⬢ Rustward   [ I ─ II ─▣ III ]  Round 4 (last)   ⚙ ✕ │
├──────────┬────────────────────────────────────────┬──────────────────┤
│ LEFT     │  CENTRE STAGE — THE MARKET             │ RIGHT RAIL       │
│ 264px    │  fluid                                 │ 320px            │
│          │                                        │                  │
│ Rival    │  Freeholders  ○ ○ ○ ○                  │ ┌ Moves │ Log ┐  │
│ concess- │  ▭ ▭ ▭ ▭                               │ │             │  │
│ ion,     │                                        │ │  move list  │  │
│ condensed│  Foundry Writs                         │ │             │  │
│          │  ▭ ▭ ▭ ▭ ▭ ▭                           │ └─────────────┘  │
│ collapse ◀│                                        │                  │
├──────────┴────────────────────────────────────────┴──────────────────┤
│ YOUR DOCK — sticky, ~340px, collapsible                              │
│  ⬡5 metal  ⚡3 energy  ▣7 goods  ✦4 standing        score 11        │
│  ┌ shifts ─┐ ┌ THE SEAT ────────┐ ┌ THE WORKS ──────────────────┐   │
│  │ ⚄ ⚂ ⚅ ⚀ │ │ Survey Kiln Delve│ │ ▮ ▮▮ ▮▮▮  (sorted by tier)  │   │
│  └─────────┘ └──────────────────┘ └─────────────────────────────┘   │
│  ┌ FOLIO (hand) ── cards rise on hover ──────────────────────────┐  │
└──────────────────────────────────────────────────────────────────────┘
```

```css
grid-template-columns: 264px minmax(0, 1fr) 320px;
grid-template-rows: 52px minmax(0, 1fr) auto;
```

Rationale for each placement:

- **Market in the centre, biggest cards, most light.** Drafting is the decision
  that matters; it gets the theatre.
- **Your engine at the bottom.** Where your hands are. The Folio pins to the very
  bottom edge and cards rise on hover — the physical gesture of holding a hand.
- **Rival on the left, condensed and read-only.** It is reference, not action.
  `PlayerPanel` already degrades to read-only when `interaction` is undefined,
  so this is a variant, not a new component.
- **Ledger on the right,** tabbed Moves / Log. This is Dota's scoreboard column.
- **Resources appear twice** — top bar and dock header. Redundancy is correct for
  the number you check most.

Below 1280px: rails collapse to icon strips. Below 900px: single column, dock
becomes a bottom sheet, market scroll-snaps horizontally.

### 3.2 Density without drowning — seven rules

The Dota 2 question. The answer is not "show less"; it is "rank harder".

1. **Three tiers of information.** *Glanceable* (always on the face: name, mark,
   category, cost). *On demand* (full rules text, why-not reasons — hover/focus,
   250ms delay, one shared tooltip portal). *Deep* (click to pin a codex panel in
   the right rail). Today the card face carries all of it at 12px; that is the
   density problem.

2. **Legality drives contrast.** This is the biggest win available and the engine
   already computes it. `board.takes`, `board.builds`, `board.freeActivations`,
   `board.copies` tell you exactly what is legal. Anything legal renders at full
   contrast; anything illegal drops to `opacity: 0.45; filter: saturate(0.5)`.
   The player's eye does the search, not their reading.

3. **Phase gates the board.** `state.phase` already exists. During the Work Phase
   the market dims to 40% and loses its glow; during the Market Phase the Works
   does. Half the screen goes quiet without anything moving.

4. **One glow means one thing.** Spice = primary action available. Aether = valid
   drop target for the die in your hand. Gilt = the card mid-choice. Never a
   fourth colour, never two at once on the same element. If everything glows,
   nothing does.

5. **Collapsible rails, remembered.** `src/lib/storage.ts` already persists the
   game; persist rail state next to it.

6. **Never colour alone.** Every tool keeps its glyph, every category keeps its
   printed word, every die keeps its numeral. This is already true in the current
   build — do not lose it in the reskin.

7. **Prompts stay where the action is.** The existing pattern of putting the
   "click a highlighted blueprint to pay" line beside the hand rather than in a
   global status bar is right. Keep it.

---

## 4. Card and asset design

### 4.1 Anatomy

`176 × 248` at rest (up from today's 148 wide), `1.06×` on hover, top to bottom:

```
╔══════════════════════════════╗  1  FRAME — 3px iron bezel, 4 corner rivets,
║ ◦  A E T H E R   K I L N  ⬢ ║  2  inner 2px keyline in the tool colour
╟──────────────────────────────╢  2  NAMEPLATE — brass strip, Oswald 500 caps,
║        P R O D U C T I O N   ║     tool mark as embossed disc, right
╟──────────────────────────────╢  3  CATEGORY BAND — full width, printed colour
║ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░ ║
║ ░░░  cyanotype woodcut  ░░░░ ║  4  ART BOX — 4:3, white line art on blueprint
║ ░░░  of the structure   ░░░░ ║     navy, hatched shadows
║ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░ ║
║ ╭──────────────────────────╮ ║  5  COST STRIP — half-overlaps the art box
║ │ ⬡2 ⚡1 · discard ⚒       │ ║     resource pips + tool requirement
╟─┴──────────────────────────┴─╢     discount: old price struck in steel-500
║ ▓ Spend 1 energy. Roll a   ▓ ║
║ ▓ shift; gain that many    ▓ ║  6  TEXT PLATE — worn parchment, ink text,
║ ▓ goods.                   ▓ ║     keywords bold and resource-coloured
╟──────────────────────────────╢
║  ▢ ▢          ✦2            ║  7  FOOTER — die sockets (engraved when empty,
╚══════════════════════════════╝     player-colour when filled); gilt standing
                                     seal, bottom right
```

**Contractors** are visually a different object, not a variant: torn paper edge
(`clip-path` with irregular vertices), no bezel, no rivets, no sockets, and a
faint diagonal "ONE ENGAGEMENT" watermark. Today they are signalled by
`border-style: dashed` alone, which is far too quiet for a card that vanishes.

**State layers** — overlays, never redraws. Maps 1:1 onto `CardView`'s existing
props:

| Prop | Layer |
|---|---|
| `highlight` | spice rim + falloff; `hover` brightens the rim |
| `selected` | gilt double rim, `scale(1.03)`, slight lift shadow |
| `dropTarget` | aether rim, sockets pulse at 1.4s |
| `spent` | `saturate(0.35) brightness(0.7)` + "WORKED" stamp, rotated −8°, 12% opacity |
| `note` | small ember tag pinned bottom-left, e.g. *needs 2 energy* |

**Art direction.** One-bit line art, no greys — hatching does the shading, as in
a woodcut. In hand and in the market, art is white-on-navy: these are *plans*.
Once built, the same art re-renders ink-on-parchment with a spice ember at the
base: it is a *structure*. That single inversion is the most valuable idea in
this document. The player watches paper become architecture.

### 4.2 Tier progression

The engine has categories, not tiers, so derive tier from cost and prestige in a
small pure module (`src/lib/tiers.ts`, testable, sits alongside `board.ts`):

```ts
export function tierOf(card: BlueprintCard): 1 | 2 | 3 {
  if (card.prestige) return 3;
  const cost = card.buildCost.metal + card.buildCost.energy;
  return cost >= 3 ? 2 : 1;
}
```

Every cue moves together, so the tier is legible from across the table:

| | **Tier 1 — Sheds** | **Tier 2 — Works** | **Tier 3 — Megaliths** |
|---|---|---|---|
| Silhouette | single low box | chimney + hopper + gantry | monolith, **breaks the top of the art box** |
| Frame | plain iron, no rivets | rivets + brass nameplate | gilt filigree corners, plinth |
| Material | corrugated tin, timber | riveted steel, brass fittings | poured basalt, gilt inlay |
| Light | none | spice ember at the base | persistent glow + aether crown |
| Sockets | 1 | 2 | 3 |
| Card scale in the Works | `1.0` | `1.04` | `1.10` |
| Height in the grid | 1 unit | 1.15 | 1.3 |
| Motion | still | slow smoke wisp (8s) | smoke + 3s glow breath |

Two structural moves make the progression *felt* rather than merely visible:

- **Sort the Works by tier ascending.** The compound becomes a skyline that grows
  left to right. Players see their city rise as they play.
- **Stamp the build.** hand → Works is a 420ms transition: `scale(1.06) → 1`, a
  spice flash across the nameplate, the art inverting from blueprint to
  parchment. This is the reward moment of the entire game; give it the animation
  budget. Respect `prefers-reduced-motion` by keeping the inversion and dropping
  the movement.

---

## 5. Next.js / React implementation

### 5.0 Step zero — Tailwind is not installed

```bash
npm install tailwindcss @tailwindcss/postcss postcss
```

`postcss.config.mjs`:

```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

Tailwind v4 is CSS-first: no `tailwind.config.js`. Everything in `@theme` becomes
**both** a utility class **and** a plain CSS custom property — which is why the
existing `game.module.css` keeps working and can start reading `var(--color-…)`
today. Migrate component by component; nothing has to be rewritten at once.

If you would rather not add Tailwind at all, drop the `@theme` block into
`:root`, skip the utility examples, and everything else in this document still
applies verbatim.

### 5.1 Token layer — `src/app/globals.css`

```css
@import "tailwindcss";

@theme {
  /* backgrounds */
  --color-void: #0b0c0e;
  --color-deep: #121417;
  --color-surface-1: #1a1d21;
  --color-surface-2: #23272c;
  --color-surface-3: #2e333a;
  --color-edge: #3a4048;
  --color-edge-bright: #565e68;

  /* steel */
  --color-steel-100: #c9d1d9;
  --color-steel-300: #8b949e;
  --color-steel-500: #5a636e;

  /* accents */
  --color-spice-400: #ff8a3d;
  --color-spice-500: #e2660f;
  --color-spice-600: #b44a08;
  --color-aether-400: #4dd5e8;
  --color-aether-500: #35c6dc;

  /* material */
  --color-parchment: #e8dcc0;
  --color-parchment-dim: #cbbe9e;
  --color-ink: #2a2318;
  --color-blueprint: #16324f;
  --color-blueprint-line: #7fb3d9;

  /* resources */
  --color-res-metal: #9aa7b4;
  --color-res-energy: #ffc53d;
  --color-res-goods: #5fbf8a;
  --color-res-standing: #d9b44a;

  /* states */
  --color-legal: #46b37e;
  --color-chosen: #e3b341;
  --color-target: #35c6dc;
  --color-danger: #d94f3d;

  /* named glows — v4 turns --shadow-* into shadow-* utilities */
  --shadow-glow-spice:
    0 0 0 1px rgb(226 102 15 / 55%), 0 0 18px -4px rgb(255 138 61 / 65%),
    inset 0 1px 0 rgb(255 255 255 / 6%);
  --shadow-glow-spice-hi:
    0 0 0 1px rgb(255 138 61 / 90%), 0 0 28px -2px rgb(255 138 61 / 80%),
    inset 0 1px 0 rgb(255 255 255 / 10%);
  --shadow-glow-aether:
    0 0 0 1px rgb(53 198 220 / 70%), 0 0 22px -6px rgb(77 213 232 / 70%);
  --shadow-plate:
    inset 0 1px 0 rgb(255 214 153 / 22%), inset 0 -2px 6px rgb(0 0 0 / 55%),
    0 1px 0 rgb(0 0 0 / 60%);

  /* type — wired from next/font in layout.tsx */
  --font-display: var(--font-cinzel), Georgia, serif;
  --font-label: var(--font-oswald), ui-sans-serif, sans-serif;
  --font-body: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
}

html { color-scheme: dark; }
```

### 5.2 Component hierarchy

```
app/layout.tsx                    next/font vars, body class, grit overlay
└─ app/page.tsx
   └─ <Game>                      client; owns pending/selection — UNCHANGED
      └─ <BoardShell>             grid template, rail collapse state
         ├─ <TopBar>              <PhaseTrack> <RoundPill> <NewGameButton>
         ├─ <LeftRail>            <RivalPanel>      (read-only PlayerPanel)
         ├─ <CentreStage>
         │  └─ <MarketPanel>
         │     ├─ <FreeholderRow> → <ContractorSlot> → <Card>
         │     └─ <WritRow>       → <Card>
         ├─ <RightRail>
         │  └─ <LedgerTabs>       <MoveList> <GameLog> <DevPanel>
         └─ <PlayerDock>          sticky bottom
            ├─ <DockHeader>       <ResourceBar> <ScorePill> <LimitWarning>
            ├─ <ShiftTray>        → <Die draggable>
            ├─ <SeatPanel>        → <SeatSection> → <DieSocket>
            ├─ <WorksGrid>        → <BuildingCard tier={1|2|3}>
            └─ <Folio>            → <Card>            (the hand, fanned)
      ├─ <CardTooltip>            ONE portal instance, positioned on demand
      └─ <GameOverDialog>
```

Notes that matter:

- **Do not touch `Game.tsx`'s move resolution.** `optionsFor`, `resolve`,
  `selectCard`, and the `pending` narrowing are the interaction brain and they
  are correct. Extract them to `src/hooks/useBoardSelection.ts` and let
  `<BoardShell>` be purely presentational, so layout churn never risks the rules.
- **Split `CardView`.** It is 188 lines of `card.kind ===` conditionals. Make it
  `<CardFrame>` (chrome, state layers, drop handling) wrapping `<WritBody>` or
  `<FreeholderBody>`. The tier work lands in `CardFrame` and the two bodies stop
  fighting each other.
- **Express state as `data-` attributes,** not concatenated className strings —
  Tailwind v4 styles them directly:

  ```tsx
  <div
    data-state={selected ? "selected" : highlight ? "legal" : undefined}
    data-tier={tierOf(card)}
    className="data-[state=legal]:shadow-glow-spice
               data-[state=selected]:shadow-glow-chosen
               data-[tier=3]:scale-110"
  />
  ```

  This kills the `.filter(Boolean).join(" ")` pattern in `CardView`,
  `PlayerPanel`, and `HeadquartersView`.
- **Static export is fine.** `output: export` plus `next/font` self-hosting means
  zero runtime cost; no CSS-in-JS, no font FOUT on Workers.
- **Performance.** `will-change: transform` only on the die actually being
  dragged. Transition `transform` and `opacity`, never `box-shadow` or `filter`.
  The grit overlay is one fixed element, drawn once.
- **Accessibility.** Keep every `title` and `aria-label` already in the codebase —
  the reskin must not trade them for glyphs. Add `prefers-reduced-motion`
  fallbacks for the smoke, the pulse, and the build stamp.

### 5.3 Three utility examples

**1. The Dota 2 glow** — an actionable card. Crisp rim, short falloff, brightens
on hover, and the transition is on `box-shadow` opacity only via a token swap:

```tsx
<button
  className="group relative rounded-lg border border-spice-500/60 bg-surface-1
             shadow-glow-spice transition-shadow duration-200 ease-out
             hover:shadow-glow-spice-hi
             focus-visible:outline-none focus-visible:shadow-glow-spice-hi
             motion-reduce:transition-none"
>
  {/* inner rim keeps the bevel readable against the glow */}
  <span className="pointer-events-none absolute inset-px rounded-[7px]
                   ring-1 ring-inset ring-white/5" />
  {children}
</button>
```

**2. Brushed brass button** — grain, bevel, and a real press:

```tsx
<button
  className="relative isolate overflow-hidden rounded-md px-4 py-2
             font-[family-name:var(--font-label)] text-[11px] uppercase
             tracking-[0.08em] text-parchment
             bg-[linear-gradient(180deg,#3A3128_0%,#241E18_55%,#171310_100%)]
             shadow-plate
             before:absolute before:inset-0 before:-z-10 before:opacity-40
             before:bg-[repeating-linear-gradient(90deg,rgb(255_255_255/6%)_0_1px,transparent_1px_3px)]
             hover:brightness-110
             active:translate-y-px
             active:shadow-[inset_0_2px_6px_rgb(0_0_0/70%)]"
>
  Raise the works
</button>
```

**3. Dune desert ground and the Architects parchment plate.**

The board backdrop — a spice haze from above, an aether bleed from below, and a
fine horizontal scanline for the industrial grain:

```tsx
<div
  className="min-h-dvh bg-void bg-fixed
             bg-[radial-gradient(1200px_600px_at_50%_-10%,rgb(226_102_15/16%),transparent_60%),
                 radial-gradient(800px_400px_at_85%_110%,rgb(53_198_220/8%),transparent_60%),
                 repeating-linear-gradient(0deg,rgb(255_255_255/2%)_0_1px,transparent_1px_4px)]"
/>
```

The card text plate — worn, stained, handled:

```tsx
<div
  className="rounded-sm px-2.5 py-2 text-[11.5px] leading-[1.4] text-ink bg-parchment
             bg-[radial-gradient(120px_80px_at_15%_20%,rgb(120_92_48/14%),transparent_70%),
                 radial-gradient(160px_100px_at_85%_80%,rgb(120_92_48/12%),transparent_70%)]
             shadow-[inset_0_0_24px_rgb(90_66_30/28%)]"
>
  {describeEffect(card.perk.effect)}
</div>
```

---

## 6. Migration order

Each step ships a playable game. Nothing here is a big bang.

1. **Tokens and fonts.** Install Tailwind, add `@theme`, wire `next/font`, delete
   the light-mode fork in `globals.css`. Board looks identical; substrate is in.
2. **Swap `src/lib/colors.ts`.** Dice, tool marks, category bands. One file, and
   ~80% of the palette reskin lands with zero component churn. Highest
   value-per-line change available.
3. **Card frame.** Split `CardView`, add `data-state`/`data-tier`, build the
   bezel, nameplate, art box, and parchment plate. Add `src/lib/tiers.ts` with
   tests beside `board.test.ts`.
4. **Board shell.** `<BoardShell>` grid, top bar, rails, dock. Extract
   `useBoardSelection` first so the rules logic never moves.
5. **Density pass.** Legality dimming, phase gating, the tooltip portal, rail
   collapse persisted through `lib/storage.ts`.
6. **Motion and reward.** The build stamp, tier smoke, glow breath, skyline sort
   of the Works — all behind `prefers-reduced-motion`.

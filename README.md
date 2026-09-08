# Fantastic Factories

A turn-based board game played solo against an AI opponent. Next.js exported as a
static SPA, served from Cloudflare Workers Assets.

The game rules are a deliberately thin slice — enough to play a full game end to
end, with `TODO` markers where the real rules go.

## Commands

```bash
npm run dev        # Next dev server on :3000
npm test           # Vitest over the engine and the AI
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # static export into out/
npm run preview    # build, then serve out/ through Wrangler locally
npm run deploy     # build, then wrangler deploy
```

`npm run typecheck` depends on route types that `next build` generates, so run a
build once after cloning.

## Layout

```
src/
  engine/     pure rules — no React, no DOM, no network
    types.ts    GameState, Player, Card, Die, Move, Phase
    cards.ts    placeholder blueprint deck
    setup.ts    createInitialState({ seed })
    rules.ts    legalMoves / applyMove / end conditions
    rng.ts      seeded PRNG
  ai/         opponents implementing the Ai interface
    random.ts   uniform over legal moves — the baseline to beat
  hooks/      useGame — React state plus the AI turn loop
  components/ board UI
  lib/        display formatting
```

### The two rules that keep this maintainable

**The engine is pure.** `src/engine` imports nothing from React, Next, or the
DOM. It would run unchanged in Node, a Worker, or a Durable Object. If solo play
ever grows into server-authoritative multiplayer, the engine moves — it does not
get rewritten.

**`Move` is the only contract.** Everything a player can do is one variant of the
`Move` union. The UI and the AI both go through `legalMoves` / `applyMove` and
know nothing else about the rules. A new AI is one new file.

State is immutable and the RNG is seeded and lives inside `GameState`, so a seed
plus a move list replays a game exactly. That is what makes the tests
deterministic and what undo and replay would build on.

## Rules so far

Dice come in six colours — red, blue, green, purple, yellow, white. Each player
takes one colour and every die they roll carries it, so up to six can play. The
human is blue and the AI red by default; pass `playerColors` to
`createInitialState` to change that.

Three resources: **metal** builds, **energy** powers, **goods** score. Players
start with 4 dice in their colour, 1 metal, 2 energy, 4 random blueprints, and
a Headquarters.

## The Headquarters

The tile every player starts with. It is not a card: it is never built, bought,
drafted or discarded, and it is not part of your compound — so it is the one
place a die can always go. Three sections take dice during the Work Phase and
pay out per die placed; the dice come off at cleanup.

| Section  | Slots | Takes      | Each die pays                     |
| -------- | ----: | ---------- | --------------------------------- |
| Research |     3 | any face   | Draw a blueprint off the deck     |
| Generate |     3 | 1, 2 or 3  | Energy equal to the die's face    |
| Mine     |     3 | 4, 5 or 6  | 1 metal                           |

Research draws off the top of the **deck**, not the market row, and reshuffles
the discard back into the deck when it runs out.

**Matching dice pay a bonus.** A die that matches one already on the same
section pays double; a third matching die pays triple, which is as far as it
goes — three slots is the whole section. The bonus is on the die being placed,
so three 2s on Generate pay 2, then 4, then 6 — twelve energy in all. Matches
are counted per section: a 5 on Research does nothing for a 5 on Mine.

## The cards

Two card types, each with its own deck and its own market row:

- **Blueprints** are built into your **compound** — the area in front of you —
  where each one's **perk** can be worked once per round. Every blueprint
  carries one of four colour-coded symbols: hammer, wrench, gear, shovel.
- **Contractors** never enter your hand. Taking one resolves its effect
  immediately and discards the card.

Setup lays out 4 face-up contractors and 4 face-up blueprints, one row each.
Each of the four contractor slots carries a **tool token** — one per type. To
take the contractor on a slot you discard a blueprint of that type from your
hand as payment, so a slot you have no matching blueprint for is simply not
available to you.

Because contractors resolve on take, your hand only ever holds blueprints —
that is enforced by the type of `Player.hand`, not by a runtime check.

### Building

**Building costs a card, not a die.** To build a blueprint you discard a
different blueprint of the **same symbol** from hand, and pay the resource cost
printed on it. So the Aluminum Factory — a shovel costing 2 metal and 2
energy — needs another shovel out of your hand on top of the resources. No die
is assigned; dice are for the Headquarters and for working what you have built.

**No compound holds two of the same blueprint.** Copies of a card differ only
by id, so the rule compares names.

### Perks

A built blueprint usually has a **perk**: dice go on it and it pays out, once
per round. Most take a single die of some face — a Mine works on a 4 or less
and pays 2 metal. Some take several, in a pattern; some charge resources on
top; and some take no dice at all.

A perk takes all its dice at once, so you need the whole set before you can
work it and no die is ever left stranded on a half-filled card.

### Scoring

**Your score is your goods plus the prestige standing in your compound.**
Blueprints in hand are worth nothing — prestige only counts once built. Metal
and energy are not score either; they are what you spend to get there.

Most of the placeholder blueprints are worth no prestige; the real ones are
worth 1 each. The highest score wins, and an equal score is a draw.

### The real blueprints so far

| Blueprint        | Copies | Symbol | Build cost         | Perk                                     | Prestige      |
| ---------------- | -----: | ------ | ------------------ | ---------------------------------------- | ------------- |
| Aluminum Factory |      3 | shovel | 2 metal + 2 energy | 2 matching dice + 5 energy → 2 goods, 1 metal | 1        |
| Assembly Line    |      2 | gear   | 2 metal + 1 energy | 3 consecutive dice → 2 goods             | 1             |
| Battery Factory  |      2 | wrench | 2 metal + 1 energy | 4 energy, no dice → 1 good               | 1             |
| Beacon           |      4 | shovel | 2 metal + 4 energy | none — it is pure score                  | 1 each, +1 set |

Every build cost is on top of discarding a blueprint of the same symbol.

**Consecutive** means a run with no gaps and no repeats: 2, 3, 4. Order does
not matter, so a roll of 4, 2, 3 works the Assembly Line.

**The Beacon is the one blueprint you may stand more than one of**, and it is
the only card that scores as a set: one prestige each plus one for having any,
so four Beacons are worth five.

The contractor deck so far — 17 cards, eight kinds:

| Contractor  | Copies | Extra cost | Effect                                                                                           |
| ----------- | -----: | ---------- | ------------------------------------------------------------------------------------------------ |
| Architect   |      2 | —          | Draw 3 blueprints                                                                                  |
| Electrician |      2 | —          | Gain 5 energy                                                                                      |
| Miner       |      2 | —          | Gain 3 metal                                                                                       |
| Investor    |      3 | —          | Reveal the top blueprint, gain metal and energy equal to its build cost, then discard it            |
| Specialist  |      3 | —          | One extra white die this round, at a face you pick after rolling                                    |
| Hired Hands |      3 | 3 energy   | Two extra white dice this round, rolled with your own                                              |
| Foreman     |      1 | 2 energy   | Set the face of up to 4 of your own dice instead of rolling them                                    |
| Engineer    |      1 | 4 energy   | Draw a blueprint and build it free — no die, no build cost. A duplicate is discarded and redrawn    |

"Extra cost" is charged on top of the slot's tool token, so a contractor you
cannot pay for is never offered. Extra dice are white and go back at cleanup
with everything else.

## The turn

A **turn** is a **Market Phase** then a **Work Phase**, taken by one player from
start to finish. You take your card and work your dice, and only then does the
next player begin their own market phase. A **round** is one turn each,
followed by **Cleanup**.

Market: take one face-up card from either row — there is no blind draw, so the
only way to a contractor is paying its token. A taken card is replaced from its
deck immediately, so the next player always sees a full row; a contractor slot
keeps its token and gets a new card.

Work: roll your dice, then spend them to build blueprints from hand, activate
your compound, and fill your Headquarters.

Cleanup: dice clear, Headquarters empty, buildings refresh. The game ends when
someone reaches 12 goods or 10 cards in their compound.

## Playing it

The board is the primary surface. In the Market Phase, cards you can take are
outlined and clickable — a blueprint is free, so all four always are, while a
contractor lights up only when you hold a blueprint of its token's type and can
pay whatever it charges on top. Clicking a contractor you could pay for in more
than one way asks which blueprint to spend: the candidates in your hand light
up, and clicking the contractor again backs out.

Building works the same way, from your hand: click a blueprint you can build
and the cards that could pay for it — same symbol — light up to be discarded.

In the Work Phase you drag a die onto what it should do: a Headquarters
section, or a building in your compound to work its perk. Only the places that
die can legally go light up while you drag, and on a Headquarters section the
slot it would fill lights up with them. Dropping a die on a perk that wants two
plays both at once. A perk that takes no dice — the Battery Factory — has
nothing to drag at it, so it is clicked instead.

A building says what is stopping it when that is not obvious: `needs 5 energy`,
`worked this round`.

The move list on the right stays as the complete, literal view of
`legalMoves` — it is the debugging surface, the keyboard path, and the only way
to play the moves with nothing on the board to point at: rolling, passing, and
naming the face of a die a contractor handed you.

## Filling in the rules

Start in `src/engine/rules.ts`. The implemented slice is: take a card from one
of the two rows, roll dice, spend dice to build blueprints, activate your
compound and work your Headquarters, end the round. Known stubs:

- `cards.ts` — the blueprints are invented placeholders; the contractors are
  real, but not yet the whole deck
- the Investor discards the blueprint it reveals rather than keeping it, and
  the Specialist's extra die is white like the Hired Hands dice — neither is
  spelled out on the card
- a Specialist die must be set straight after the roll, before anything is
  spent. Nothing yet changes a die mid-phase, so waiting would gain nothing
- an equal score is a draw. No tiebreak is defined
- 11 distinct blueprints and a Beacon that stacks four deep put the 10-card
  `END_COMPOUND_SIZE` in reach again, but only just
- the Headquarters is the same for every player. The published game hands out
  one of several starting tiles
- `Effect` — the real game needs many more variants than the seven here
- a `draw` effect always pulls blueprints; no card lets you choose a deck yet
- a perk that wants several dice must ask for matching ones or accept any
  combination; there is no "one 3 and one 5" yet
- contractor slot tokens are fixed to their slot for the whole game; they could
  instead be dealt or rotated each round
- cards still reach hand from the blueprint deck through `draw` effects; only
  the *move* was removed. Nothing draws contractors from their deck at all.
- no contractor *dice* — white is currently just another player colour
- dragging is HTML5 drag-and-drop, so it does not work by keyboard or on
  touch. The move list is the fallback on both
- the game still *ends* on 12 goods or 10 buildings, which are not the same
  thresholds as the score — a player can win on prestige without either
- `MAX_ROUNDS` — a safety valve so a half-written rule cannot hang a test run

`applyEffect` and `legalMoves` switch exhaustively with no `default`, so adding a
variant to `Effect` or `Move` makes TypeScript point at every place that needs
updating.

## Deploying

`wrangler.jsonc` serves `out/` as static assets. First deploy needs a Cloudflare
login:

```bash
npx wrangler login
npm run deploy
```

There is no server at runtime — no route handlers, no server actions, no image
optimization. That is the trade for a free, fast static deploy, and it is fine
while the game is client-side only. If you later need a server (multiplayer,
anti-cheat, saved games), drop `output: "export"` from `next.config.ts` and move
to `@opennextjs/cloudflare`.

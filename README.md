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
start with 4 dice in their colour, 1 metal, 2 energy, and 4 random blueprints.

Two card types, each with its own deck and its own market row:

- **Blueprints** are built into your **compound** — the area in front of you —
  where each one can be activated once per round. Every blueprint carries one
  of four colour-coded tool types: hammer, wrench, gear, shovel.
- **Contractors** never enter your hand. Taking one resolves its effect
  immediately and discards the card.

Setup lays out 4 face-up contractors and 4 face-up blueprints, one row each.
Each of the four contractor slots carries a **tool token** — one per type. To
take the contractor on a slot you discard a blueprint of that type from your
hand as payment, so a slot you have no matching blueprint for is simply not
available to you.

Because contractors resolve on take, your hand only ever holds blueprints —
that is enforced by the type of `Player.hand`, not by a runtime check.

A round runs **Market Phase** → **Work Phase** → **Cleanup**. Market: take one
face-up card from either row — there is no blind draw, so the only way to a
contractor is paying its token. Work: roll your dice, then spend them to build
blueprints from hand and activate your compound. Cleanup: dice clear, buildings
refresh, both rows refill — tokens stay on their slots. The game ends when
someone reaches 12 goods or 10 cards in their compound.

## Filling in the rules

Start in `src/engine/rules.ts`. The implemented slice is: take a card from one
of the two rows, roll dice, spend dice to build blueprints and activate your
compound, end the round. Known stubs:

- `cards.ts` — invented placeholder cards, not the published sets
- `createStartingBuilding` — a placeholder so the economy has a source
- `Effect` — only `gain` and `draw`; the real game needs many more variants
- a `draw` effect always pulls blueprints; no card lets you choose a deck yet
- blueprint tool types are read by the contractor tokens, nothing else yet
- contractor slot tokens are fixed to their slot for the whole game; they could
  instead be dealt or rotated each round
- cards still reach hand from the blueprint deck through `draw` effects; only
  the *move* was removed. Nothing draws contractors from their deck at all.
- no contractor *dice* — white is currently just another player colour
- `decideWinner` — most goods, buildings break ties
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

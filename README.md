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

## Filling in the rules

Start in `src/engine/rules.ts`. The implemented slice is: draft a card, roll
dice, spend dice to build blueprints and activate buildings, end the round.
Known stubs:

- `cards.ts` — invented placeholder blueprints, not the published card set
- `createStartingBuilding` — a placeholder so the economy has a source
- `Effect` — only `gain` and `draw`; the real game needs many more variants
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

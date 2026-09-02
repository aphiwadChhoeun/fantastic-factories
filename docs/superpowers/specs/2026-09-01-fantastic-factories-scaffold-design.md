# Fantastic Factories — scaffold design

Date: 2026-09-01
Status: implemented

## Goal

A barebones but genuinely running scaffold for Fantastic Factories, played solo
against an AI, on Cloudflare and Next.js. Rules are stubs; the structure around
them is real.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Game | Fantastic Factories | Matches the repo name |
| State and AI | Client-side, pure TypeScript | No DB, no latency, trivially testable; keeps a server move cheap later |
| Cloudflare target | Static export to Workers Assets | Simplest and cheapest; viable because the AI is client-side |
| Tooling | Vitest | Engine tests only; no Tailwind, no Biome, no CI |

## Architecture

Three layers, one direction of dependency: `components` → `hooks` → `ai` →
`engine`. The engine depends on nothing.

- `src/engine` — pure rules. No React, no DOM, no network imports. Runs
  unchanged in Node, a Worker, or a Durable Object.
- `src/ai` — opponents behind a one-method `Ai` interface.
- `src/hooks/useGame` — React state plus the AI turn loop.
- `src/components` — presentational board UI.
- `src/lib/format` — display strings, kept out of the engine.

### Immutable state, seeded RNG

`applyMove` never mutates and returns a new `GameState`. The RNG is a purely
functional mulberry32 whose state lives inside `GameState`. A seed plus a move
list reproduces a game exactly, which is what makes the tests deterministic and
what replay and undo would be built on.

### `Move` is the contract

Every legal action is one variant of a `Move` union. The UI and the AI both go
through `legalMoves(state)` and `applyMove(state, move)` and know nothing else
about the rules. Replacing the random AI with a heuristic or a search AI touches
exactly one new file.

`applyMove` throws on an illegal move rather than returning an error value — an
illegal move is a bug in the caller, not a game outcome.

### Rules slice implemented

A round runs `market → work → cleanup`. Market: each player drafts a face-up
card or draws blind. Work: each player rolls their workforce, then spends dice to
build blueprints from hand or activate built buildings. Cleanup: dice clear,
buildings refresh, the market refills, end conditions are checked.

End conditions: 12 goods or 10 buildings, plus a `MAX_ROUNDS` safety valve so a
half-written rule cannot hang a test run.

### Deliberate stubs

Placeholder card list, a placeholder starting building (without it nobody can
afford a first blueprint and the game stalls), two `Effect` variants, and
simplified scoring. Each is marked `TODO` at its definition.

## Testing

Vitest over `src/engine` and `src/ai` only — both are pure, so no DOM
environment. Coverage: setup shape, determinism from a seed, `legalMoves`
correctness per phase, immutability of `applyMove`, rejection of illegal moves,
replay equivalence, and two full games (random play terminates; greedy play
builds an engine and reaches a real end condition).

## Trade-offs accepted

Static export means no route handlers, no server actions, no image optimization.
Acceptable while play is client-side only. The escape hatch is to drop
`output: "export"` and adopt `@opennextjs/cloudflare`; because the engine is
pure, that is an addition rather than a rewrite.

## Out of scope

Persistence, multiplayer, a full card database, and visual design.

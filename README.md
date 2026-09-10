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
    cards.ts    the blueprint and contractor decks
    automa.ts   the opponent's own rules — it plays a different game
    setup.ts    createInitialState({ seed })
    rules.ts    legalMoves / applyMove / end conditions
    rng.ts      seeded PRNG
  ai/         opponents implementing the Ai interface
    random.ts   uniform over legal moves — the baseline to beat
  hooks/      useGame — React state plus the AI turn loop
  components/ board UI
  lib/        display formatting, and the saved game
  dev/        debug tools, compiled out of production
```

## Saving

The game in progress is written to `localStorage` after every move, so a
refresh — or closing the tab and coming back — picks up where you left off.
**New game** replaces it; there is no second slot. A save is around 27 KB and
takes a tenth of a millisecond to write, so it is written outright rather than
debounced.

`GameState` is plain data all the way down, including an rng that is a single
number, so `JSON.stringify` round-trips it exactly and `lib/storage.ts` needs
to know nothing about the rules. The seed is saved beside the state, because a
state restored next to the wrong seed would deal a different game the moment
anything reached for the deck.

Two things it has to survive. A save written by an older shape of the code:
`SAVE_VERSION` is bumped by hand whenever `GameState` changes in a way an old
save would not survive, and a mismatch is dropped rather than half-read.
And a browser that will not play along: private modes throw outright on
`localStorage` rather than coming back empty, so every access is wrapped and a
game that cannot be saved is still a game worth playing.

The board holds itself back for one render — the `Dealing…` placeholder — and
that is not cosmetic. The HTML in `out/` is prerendered at build time, where
there is no `localStorage` to read, so a board drawn straight from a save would
not match the HTML the browser is hydrating. `useMounted` is what keeps the two
renders agreeing; `useGame` may then read the save during its first render
rather than in an effect. One consequence worth knowing: the prerendered page
is now the placeholder and nothing else, which is why `out/index.html` is 6 KB.

The AI's own RNG is *not* saved — it lives in a closure, not in `GameState`.
That costs nothing today, because the automaton is offered exactly one legal
move at each of its decision points, so there is nothing for it to choose
between. A real AI with something to decide would need its state saved too.

## Debug tools

A panel in the right-hand column conjures any blueprint straight into your hand
or standing in your compound, so a card can be tried without playing towards
it. Nothing is paid and nothing is checked — that is the point.

It is on by default under `npm run dev`. To keep it in a production build:

```bash
NEXT_PUBLIC_DEV_TOOLS=1 npm run build
```

Without that, `DEV_TOOLS` folds to `false` at build time and the panel is
dropped from the bundle outright — not merely hidden. `next.config.ts` pins
the variable to a literal for exactly this reason: left to Next's own handling,
an *unset* `NEXT_PUBLIC_` variable compiles to a live `process.env` lookup,
which no bundler can fold, and the panel then ships as dead code. Grep `out/`
for `Dev tools` after a build if you ever want to check.

A granted card is not a move, so it goes through a `debug` escape hatch on
`useGame` rather than `applyMove` — the AI would otherwise be offered it, and
the rules would have to make sense of it. The cost is that a poked game no
longer replays from its seed and move list, which the log marks with `[dev]`.

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

Dice come in six colours — red, blue, green, purple, yellow, white. A human
player takes one colour and every die they roll carries it, so up to six can
play. The human is blue by default; pass `playerColors` to
`createInitialState` to change that. The automaton is seated on a colour like
anyone else, but rolls one die of *each* colour instead — see below.

Three resources: **metal** builds, **energy** powers, **goods** score. A human
starts with 4 dice in their colour, 1 metal, 2 energy, 4 random blueprints, and
a Headquarters. The automaton starts with none of the first four.

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
  carries a **type** and a **tool**, and they are not the same thing.
- **Contractors** never enter your hand. Taking one resolves its effect
  immediately and discards the card.

Setup lays out 4 face-up contractors and 4 face-up blueprints, one row each.
Each of the four contractor slots carries a **tool token** — one per tool. To
take the contractor on a slot you discard a blueprint carrying that tool from
your hand as payment, so a slot you have no matching blueprint for is simply
not available to you.

Because contractors resolve on take, your hand only ever holds blueprints —
that is enforced by the declared type of `Player.hand`, not by a runtime check.

### Type and tool

A blueprint's **type** is what the card is, printed as a coloured band:

| Type       | Colour |
| ---------- | ------ |
| Production | blue   |
| Utility    | yellow |
| Training   | red    |
| Monument   | grey   |
| Special    | purple |

A blueprint's **tool** — hammer, wrench, gear or shovel — is what it is worth
as payment, and nothing else. Building and contractor tokens both ask for a
tool; nothing yet asks for a type. A Beacon is a Monument you buy with a
shovel, and both facts are on the card.

Every blueprint carries both, and the type is required by the type system —
a card without one would answer to no die of the automaton's and go quietly
uncounted.

### Building

**Building costs a card, not a die.** To build a blueprint you discard a
different blueprint of the **same tool** from hand, and pay the resource cost
printed on it. So the Aluminum Factory — a shovel costing 2 metal and 2
energy — needs another shovel out of your hand on top of the resources. No die
is assigned; dice are for the Headquarters and for working what you have built.

**No compound holds two of the same blueprint.** Copies of a card differ only
by id, so the rule compares names.

### Perks

A built blueprint usually has a **perk**: dice go on it and it pays out, once
per round. Most take a single die of some face — a Fulfillment Center works on
a 4 and pays a good and a metal. Some take several, in a pattern; some charge
resources on top; and some take no dice at all.

A perk takes all its dice at once, so you need the whole set before you can
work it and no die is ever left stranded on a half-filled card.

Some perks charge something other than a printed price. The Concrete Plant
reads its cost off the table — metal equal to the pair of dice put on it, once
for the pair and not once each — so the same card is cheap on two 1s and dear
on two 6s.

**Two perks are paid in cards.** The Black Market and the Incinerator each eat
a blueprint out of hand on top of whatever else they charge. What the card was
matters to one and not the other: the Black Market pays back what it would have
cost to build, while the Incinerator burns anything for the same flat six
energy. A Beacon is worth four at the Black Market and six in the fire.

**Some perks pay one way or the other.** The Harvester's two matching dice buy
four metal *or* seven energy, never both. The Manufactory splits the difference:
a good is certain, and beside it you take two metal, three energy, or two cards
off the deck. Either way the choice is the player's, and it rides on the move as
an index into what the card offers.

**The Motherlode is paid by the die rather than by the player.** Any face works
it, and what it pays depends on which: a metal for a 3 or less, two for a 4 or
more. Nothing is chosen — the die was chosen when it was placed.

Effects compose, which is what lets a card do two things, offer three, or pay
by the face: `all` runs each in turn, `oneOf` runs whichever was picked,
`byFace` runs whichever the die falls into, and any of them can hold another.

**Some perks pay out in dice rather than in goods.** Three of them change a die
you already have: the Dojo turns it over to the face on the other side —
opposite faces on a d6 add up to seven, so a 5 becomes a 2 — while the Fitness
Center takes a pip off and the Gymnasium puts one on. A step that would run off
the die is simply not offered, which is the whole of why the Fitness Center
cannot touch a 1 and the Gymnasium cannot touch a 6.

None of them spends the die or puts it on the card. It stays on the table
showing its new face, for whatever it now fits. Once a round each, and only
your own dice.

**The Golem sells you a die outright.** Name a face and pay that much energy —
a 5 costs five — and it arrives white and unspent, yours for the round like a
contractor's loan, and gone at cleanup. It is the only perk whose price you
choose rather than read. The Mega Factory hands one over on the same terms and
charges nothing for it, having already asked for three matching dice.

**The Foundry's payout is the die too.** Place any die, pay energy equal to its
face, and take that much metal — a 5 costs five energy and pays five metal. It
is the one card that reads the die on both sides of the trade.

### The end-of-phase limits

**Nothing leaves a Work Phase over the limits.** Before the phase can end you
must be down to **12 metal and energy together** and **10 cards in hand**.

Goods are not counted. They are score, not stock, and hoarding them is the
point — 12 of them is what ends the game.

Anything over comes off one at a time, and you choose what goes: which
resource, and which cards. Nothing is taken automatically, because a metal and
an energy are not interchangeable to whoever has to spend them next.

The limits only bite at the *end* of the phase, so you may run well over them
mid-phase and spend your way back down. Spending counts: building a blueprint
costs two cards out of hand and some resources, so it can put you back inside
both limits at once. `End turn` is simply not offered until you are.

None of this touches the automaton: it holds no cards and is dealt no metal or
energy, so it can never be over either.

### Passives

**The Laboratory is not worked at all.** It has no perk: nothing goes on it,
nothing is paid, and there is nothing to click. It watches, and the first time
you gain goods in a round it draws you a blueprint.

Once a round however many goods arrive, and it does not care where they came
from — a perk, a Headquarters section, or anything added later. Every payout in
the engine goes through one function, which is what stops a future card from
gaining goods by a route the Laboratory never hears about.

It marks its round as spent with the same `worked` flag a perk uses, so cleanup
clears it along with everything else. The card says `watching` or `already
fired this round` so you can tell which.

The automaton never works a perk, and a card in hand would be the first it ever
held, so a Laboratory in its compound stays quiet like the rest of it.

**The Megalith gets cheaper the more Monuments you have.** It is not worked
either: it simply costs a metal less for each Monument standing when you build
it, down to nothing but the wrench.

The discount is on the card going up, not on one already there, so it needs no
Megalith standing first — three Beacons take three metal off your very first
one. And since a Megalith is itself a Monument, each one you stand makes the
next cheaper again.

It is the second blueprint you may stand more than one of, and at 3 prestige
each it is the heaviest scorer in the deck.

### Scoring

**Your score is your goods plus the prestige standing in your compound.**
Blueprints in hand are worth nothing — prestige only counts once built. Metal
and energy are not score either; they are what you spend to get there.

Most blueprints are worth 1 prestige; the Megalith is worth 3 and the Obelisk
2, the Concrete Plant and three of the Training cards are worth none, and the
Beacon scores as a set. The highest score wins, and an equal score is a draw.

The Dojo, the Fitness Center and the Gymnasium are worth nothing but what they
do to your dice, which is the closest thing the deck has to a trade-off between
scoring and playing well.

When the game ends, a dialog gives the result: who won, what ended it, and both
scores split into goods and prestige — which half someone won on says more
about the game than the total does. It offers another game.

**Hide result** puts it away so the final board can be looked over, as do
Escape and a click on the backdrop; **Show result** appears beside *New game*
to bring it back, and is only there while the result is hidden. Hiding is not
saved with the game: coming back to a finished one shows the result again
rather than assuming you remember it.

### The real blueprints so far

Seventy-four cards, thirty-two of them distinct — every one a real card.

| Blueprint        | Copies | Type       | Tool   | Build cost         | Perk                                     | Prestige      |
| ---------------- | -----: | ---------- | ------ | ------------------ | ---------------------------------------- | ------------- |
| Aluminum Factory |      2 | Production | shovel | 2 metal + 2 energy | 2 matching dice + 5 energy → 2 goods, 1 metal | 1        |
| Assembly Line    |      2 | Production | gear   | 2 metal + 1 energy | 3 consecutive dice → 2 goods             | 1             |
| Battery Factory  |      2 | Production | wrench | 2 metal + 1 energy | 4 energy, no dice → 1 good               | 1             |
| Beacon           |      4 | Monument   | shovel | 2 metal + 4 energy | none — it is pure score                  | 1 each, +1 set |
| Biolab           |      2 | Production | gear   | 1 metal + 3 energy | a 1 + 1 energy → 1 good                  | 1             |
| Black Market     |      2 | Utility    | gear   | 3 metal + 2 energy | any die + a blueprint from hand → its build cost back, at most 4 | 1 |
| Concrete Plant   |      2 | Production | shovel | 2 metal + 2 energy | 2 matching dice + metal equal to them → 2 goods | —      |
| Dojo             |      2 | Training   | gear   | 1 metal + 2 energy | 1 energy → turn an unspent die over        | —             |
| Fitness Center   |      3 | Training   | wrench | 1 metal            | 1 energy → take 1 off an unspent die       | —             |
| Foundry          |      2 | Utility    | gear   | 2 metal + 1 energy | any die + energy equal to it → that much metal | 1         |
| Fulfillment Center |    2 | Production | hammer | 2 metal + 1 energy | a 4 + 2 energy → 1 good, 1 metal           | 1             |
| Golem            |      2 | Monument   | hammer | 4 metal            | buy an extra die at any face, for that much energy | 1     |
| Gymnasium        |      3 | Training   | shovel | 1 metal            | 1 energy → put 1 on an unspent die         | —             |
| Harvester        |      2 | Utility    | hammer | 1 metal + 2 energy | 2 matching dice → 4 metal *or* 7 energy    | 1             |
| Incinerator      |      2 | Utility    | shovel | 2 metal + 1 energy | a blueprint from hand + 1 metal → 6 energy | 1             |
| Laboratory       |      2 | Special    | wrench | 1 metal + 4 energy | none — it watches (see below)              | 1             |
| Manufactory      |      2 | Production | wrench | 2 metal + 3 energy | 2 matching dice → 1 good, and 2 metal *or* 3 energy *or* 2 blueprints | 1 |
| Mega Factory     |      2 | Production | gear   | 3 metal + 2 energy | 3 matching dice → 2 goods, and a free die at any face | 1     |
| Megalith         |      3 | Monument   | wrench | 5 metal + 2 energy | none — it discounts the next (see below)   | 3             |
| Motherlode       |      2 | Training   | shovel | 1 metal + 3 energy | any die → 1 metal, or 2 metal on a 4+      | 1             |
| Nuclear Plant    |      2 | Production | gear   | 2 metal + 2 energy | a 6 → 1 good, 1 energy                     | 1             |
| Obelisk          |      5 | Monument   | hammer | 3 metal + 1 energy | none — it is pure score                    | 2             |
| Power Plant      |      2 | Utility    | gear   | 3 metal            | any die → that much energy                 | 1             |
| Recycling Plant  |      3 | Production | gear   | 2 metal            | 2 blueprints from hand + 2 energy → 1 good, draw 1 | 1     |
| Refinery         |      2 | Utility    | wrench | 1 metal + 3 energy | a blueprint from hand + 3 energy → 3 metal | 1             |
| Replicator       |      2 | Special    | shovel | 2 metal + 2 energy | 1 energy → work a face-up blueprint's perk (see below) | 1 |
| Robot            |      3 | Special    | hammer | 1 metal + 1 energy | 1 metal → roll an extra white die          | —             |
| Scrap Yard       |      2 | Special    | wrench | 1 metal + 2 energy | none — it pays on every build (see below)  | —             |
| Solar Array      |      2 | Special    | gear   | 1 metal + 2 energy | none — it pays on every build (see below)  | —             |
| Temp Agency      |      2 | Training   | hammer | 1 metal            | 1 energy → throw any number of your unspent dice again | — |
| Trash Compactor  |      2 | Production | shovel | 2 metal + 1 energy | 2 matching dice + 2 blueprints from hand → 2 goods | 1     |
| Warehouse        |      2 | Production | hammer | 2 metal + 2 energy | 3 dice adding to 14+ → 2 goods, 2 energy   | 1             |

Every build cost is on top of discarding a blueprint of the same tool.

**Consecutive** means a run with no gaps and no repeats: 2, 3, 4. Order does
not matter, so a roll of 4, 2, 3 works the Assembly Line.

**The Black Market pays at most four.** A blueprint that cost less than that
pays out whole; one that cost more pays four, and the player says which four —
a Beacon, at 2 metal and 4 energy, can be sold for any of 4 energy, 1 metal and
3 energy, or 2 metal and 2 energy.

**The Scrap Yard and the Solar Array pay for building, not for working.**
Every card you stand up hands you 1 metal or 2 energy while they are up — but
never the build that stood *them* there, so the first card either pays for is
the next one. Unlike the Laboratory they are not held to once a round: build
four cards and they pay four times. That covers a card the Engineer builds off
the deck too, which costs nothing and is still a build.

**The Temp Agency is the only Training card that can leave you worse off.** A
flip and a step are worked out before you pay for them — you can see what a 5
becomes. A throw is a throw: name any number of your unspent dice, pay the
energy, and they land where they land. The sets are offered smallest first,
since what you are really choosing is how much to risk.

**The Warehouse asks for a big roll, not a shaped one.** Three dice adding to
fourteen or more, in any combination — 6, 6, 2 and 5, 5, 4 both do it, and
6, 5, 2 falls one short. That is a floor on the set, where every other card's
requirement is a rule about each die on its own, so nothing below a 2 can ever
be part of one: even 6, 6, 1 is thirteen.

**The Robot is the Golem in reverse.** The Golem names the face it wants and
pays energy equal to it; the Robot pays a flat metal and takes whatever comes
up. Both hand over a white die that goes back at cleanup.

**The Replicator has no perk of its own.** It works a face-up blueprint's
instead, for 1 energy on top of whatever that card charges — its dice, its
faces, its pattern, its payout, and any blueprint it eats. The copied card
stays in the market: only its perk is borrowed, and the dice go on the
Replicator. It reads the row as it stands when you work it, so a card swept
away is a card you can no longer copy. A Monument or a Laboratory has nothing
to lend, and a Replicator cannot copy another Replicator.

On the board it is two clicks: click the Replicator, and the blueprints you
could afford to work light up in the row — click one and it happens. Anything
that card still leaves open is asked afterwards, in the usual place: which
blueprint to burn, which dice to use, which payout to take. Nothing is spent
until the move resolves, as everywhere else. Dragging a die onto the Replicator
works too, and narrows the row to the cards that die could work.

The row is shown even when only one card on it could be worked. Everywhere
else the board settles a lone option without asking — but which card is being
worked is the whole of the Replicator, and firing it off a single click leaves
the player with no idea what just happened.

"As if it were in your compound" is held to as an equivalence, and tested as
one: for every blueprint in the deck with a perk to lend, copying it offers
move for move what owning it offers, and leaves the player in the same place
bar the 1 energy. A card added later that the Replicator cannot faithfully
copy fails that test rather than surprising someone in play.

Two readings worth knowing, since neither is spelled out on the card. The
no-duplicates rule governs *building*, so a card already standing and already
worked can still be copied out of the row — the copy is a second use of that
perk in a round. And a Replicator cannot copy another Replicator, which would
only ask the question again.

**Five perks are priced in cards rather than resources.** The Black Market
sells one out of hand, the Incinerator burns one, the Refinery melts one down,
and the Recycling Plant and the Trash Compactor swallow *two*. What goes in makes
no difference to any of them except the Black Market, which pays back what it
was worth. On the board they are fed one click at a time: the hand narrows to
the cards that could still pay, and what you have already promised stays lit.

**The Beacon, the Megalith and the Obelisk are the blueprints you may stand
more than one of** — all three Monuments, and all three pure score. The Beacon
is the only card that scores as a *set*: one prestige each plus one for having
any, so four Beacons are worth five. Five Obelisks are worth ten and not a pip
more.

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

## The automaton

The opponent does not play the game you play. It never builds, never spends,
never holds a card and never touches its Headquarters. It rolls **five dice —
one red, blue, purple, yellow and green — at the top of its turn** and reads
the whole turn off them.

It starts with **three blueprints already standing** in its compound, dealt
face up. A Monument dealt there is set aside and another card dealt in its
place, so it opens with three cards it could produce from. Its compound is
kept grouped by type.

**Market Phase — the green die decides.**

| Green | What it does                                                     |
| ----: | ---------------------------------------------------------------- |
| 1–4   | Take that blueprint from the row, counting from the left          |
| 5     | Reveal the top blueprint, then sweep the whole blueprint row away |
| 6     | Reveal the top blueprint, then sweep the whole contractor row away|

Whatever it takes goes straight into its compound. It pays nothing — no card,
no metal, no energy — and a card it takes is never built, just stood up.

**Work Phase — the other four dice pay out.** Each colour answers for one type
of card in its compound, and pays **one good if its face is at most the number
of cards of that type standing**:

| Die    | Counts  |
| ------ | ------- |
| red    | Training |
| blue   | Production |
| purple | Special |
| yellow | Utility |

So a blue 2 pays a good against two or more Production cards, and nothing
against one. Four dice, so at most four goods a turn.

**Monument has no die**, which is why one is never dealt into its opening
compound — it can still take one from the market, where it counts for prestige
and produces nothing.

The automaton is offered **exactly one legal move at each point of its turn**,
so the automaton lives in the engine and any `Ai` implementation plays it
correctly. Its turn is still `Move`s through `applyMove`: a seed and a move
list replay it like any other game.

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

Cleanup: dice clear, Headquarters empty, buildings refresh — and the end is
checked for.

### Calling the end

**You call the end by reaching 12 goods, or by standing 10 blueprints in your
compound. The automaton can only call it on goods.** Its compound is not a
trigger, because it takes a card into it every single turn and would otherwise
call time around round seven of every game, whatever either side had actually
done.

Calling it does not stop the game where it stands. The round it happened in is
finished, and then **one last round is played** — so a call in round 6 means
rounds 6 and 7 are both played out in full, by both sides. The status line says
`(last)` while that round runs, because what is worth doing changes completely
once there is only one round left to do it in.

Whoever calls it first sets the date; a second player reaching a threshold
afterwards does not buy another round. In practice games run eight to twelve
rounds, well inside the `MAX_ROUNDS` safety valve.

## Playing it

The board is the primary surface. In the Market Phase, cards you can take are
outlined and clickable — a blueprint is free, so all four always are, while a
contractor lights up only when you hold a blueprint of its token's type and can
pay whatever it charges on top. Clicking a contractor you could pay for in more
than one way asks which blueprint to spend: the candidates in your hand light
up, and clicking the contractor again backs out.

Building works the same way, from your hand: click a blueprint you can build
and the cards that could pay for it — same tool — light up to be discarded.

In the Work Phase you drag a die onto what it should do: a Headquarters
section, or a building in your compound to work its perk. Only the places that
die can legally go light up while you drag, and on a Headquarters section the
slot it would fill lights up with them. Dropping a die on a perk that wants two
plays both at once. A perk that takes no dice — the Battery Factory — has
nothing to drag at it, so it is clicked instead.

The Dojo, the Fitness Center and the Gymnasium are dragged at like anything
else, even though they spend no die: drop the die you want changed onto one and
it comes back showing its new face. The Golem has nothing to drag at it — there
is no die yet — so it is clicked, and it asks which face you are buying. The
Laboratory cannot be clicked at all; it is not worked, and it says so.

Over a limit, the panel says so and `End turn` disappears until you are back
inside. Resource discards are buttons — there is nothing on the board to point
at — and a card is discarded by clicking it in hand. A card you could *also*
build offers both.

A drop that leaves something open asks rather than guessing. The Black Market
wants a blueprint out of hand, so the candidates light up as they do for a
build; once the card is settled, anything still open — which four resources to
take for it, or which run of three works an Assembly Line — is spelled out as
buttons under your compound. Clicking the card being worked backs out.

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

- **the Obelisk's type is a guess.** The card gave none — `type: hammer` was
  the tool, and the cost was under `symbol` — so it is read as a Monument on
  the strength of being pure score, stackable and perk-less, which is the
  Beacon and the Megalith exactly. It is one word in `cards.ts` if that is
  wrong, and it matters: type is what the automaton's dice count and what the
  Megalith's discount counts
- **the Replicator copies the blueprint row only.** "A card in the market"
  could take in the contractor row too, but a contractor has no perk to work —
  it resolves when taken and is discarded — so there would be nothing for the
  dice to go on. If contractors were meant, this needs a different mechanic,
  not a wider filter
- **74 cards, and the tools have evened out** — 21 gears to 16 wrenches, where
  hammers were once 2 of 26 and are now 18. Utility and Training are the
  thinnest types at 12, and Special has gone from the runt to 11, so the
  automaton's purple die finally has something to count
- **74 cards is a comfortable deck.** Setup deals eleven — four to hand, four
  to the row, three to the automaton — so the draw pile no longer turns over in
  a couple of rounds
- **`gainOnBuild` fires on every build, not the first of a round.** Nothing on
  the Scrap Yard or the Solar Array says otherwise, where the Laboratory says
  so outright — so they spend no `worked` flag
- **the Recycling Plant is the first perk to eat two cards**, which is why
  `discardsCards` is a count and `Move.activate.paymentCardIds` a list. Nothing
  yet needs a perk that eats *different* cards — the same tool, say — and the
  move would have to say which is which if one did
- `cards.ts` — every blueprint is now a real card, but neither deck is
  complete. The scaffold's invented placeholders are gone
- the Investor discards the blueprint it reveals rather than keeping it, and
  the Specialist's extra die is white like the Hired Hands dice — neither is
  spelled out on the card
- an equal score is a draw. No tiebreak is defined
- 32 distinct blueprints, plus three Monuments that stack, put the 10-card
  `END_COMPOUND_SIZE` in reach for a human. The automaton sails past it — dealt
  three and taking one a turn — which is exactly why its compound is not a
  trigger; it routinely finishes on thirteen or fifteen cards having called
  nothing
- the Headquarters is the same for every player. The published game hands out
  one of several starting tiles
- `Effect` — the real game needs many more variants than the seventeen here, one
  of which (`borrowFromMarket`) is a marker rather than an effect: it is
  swapped for the copied card's before anything runs
- a `draw` effect always pulls blueprints; no card lets you choose a deck yet
- the Black Market's cap is read as four resources in total, and the card it
  eats is discarded rather than kept. Taking less than the cap is not offered
- the automaton's dice are lopsided against the deck it draws from: 19
  Production copies to 14 Monument (which never pays), 10 Training, 8 Utility
  and 2 Special. Its blue die does most of the work and its purple one least
- no rule reads a blueprint's type outside the automaton's Work Phase
- a Specialist die is set before anything is spent, but the Dojo and the
  Fitness Center now *do* change a die mid-phase. Whether a Specialist die
  should be settled that early is worth another look
- sweeping a row refills it at once, so the human still faces a full market.
  Denial rather than churn would be the other reading
- the automaton takes no notice of duplicates: it will stand up two of the same
  blueprint, where a human may build only one. Only its *opening* deal rejects
  a card, and only a Monument
- an automaton turn is three moves — roll, market, work — so it is three ticks
  of the `AI_THINK_MS` pause rather than one
- a perk that wants several dice must ask for matching ones or accept any
  combination; there is no "one 3 and one 5" yet
- contractor slot tokens are fixed to their slot for the whole game; they could
  instead be dealt or rotated each round
- cards still reach hand from the blueprint deck through `draw` effects; only
  the *move* was removed. Nothing draws contractors from their deck at all.
- no contractor *dice* — white is currently just another player colour
- dragging is HTML5 drag-and-drop, so it does not work by keyboard or on
  touch. The move list is the fallback on both
- the game is *called* on 12 goods or 10 buildings, which are not the same
  thresholds as the score — a player can win on prestige having called neither
- a call is spotted at cleanup rather than the instant it happens. That is only
  equivalent because goods are never spent and a compound never shrinks, so
  neither threshold can be crossed and then uncrossed within a round. A card
  that spent goods would break it
- the end-of-phase limits are 12 and 10, which read like `END_GOODS` and
  `END_COMPOUND_SIZE` but are unrelated numbers on unrelated things. They are
  separate constants so that changing one cannot quietly move the other
- the limits are checked at the end of the Work Phase only. Whether the Market
  Phase should also cap a hand that a contractor has just filled is unsaid
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

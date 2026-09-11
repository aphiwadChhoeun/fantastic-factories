# Motion, particles, and game feel

How to make the Rustward Concession feel like a machine rather than a web page.
Companion to [theme.md](theme.md), which owns the static look; this owns
everything that moves.

Two libraries, and a hard line between them:

- **Motion** drives every pixel the player reads or clicks. All of it stays in
  the DOM.
- **React Three Fiber** drives light and dust — embers, spice, heat. None of it
  is ever interactive, and none of it ever carries information.

If a particle has to be read, it belongs in the DOM. If a card has to be
clicked, it stays in the DOM. The canvas is weather.

---

## 0. What this costs, before anything else

> **Measured, after the fact.** Both are installed now, and the estimates below
> were close. `three` + `@react-three/fiber` + the whole of `src/effects`
> comes to **232.2 kB gzipped**, against **235.2 kB** for the entire rest of
> the game. It doubles the bundle rather than tripling it, and — because it is
> behind `next/dynamic` — it costs the **first load 2.1 kB**, which is the
> number that actually matters. See §7.

Neither library is installed. The honest numbers, gzipped:

| Package | Size | Note |
|---|---|---|
| `motion` | ~34 kB | ~28 kB with `LazyMotion` + `domMax` (layout and drag need `domMax`) |
| `three` | ~160 kB | the floor; not meaningfully tree-shakeable |
| `@react-three/fiber` | ~40 kB | |
| `@react-three/drei` | 2–60 kB | entirely down to what you import |
| `postprocessing` + `@react-three/postprocessing` | ~100 kB | **skip it** — see §3.4 |

The game's current JS is a few tens of kB. The 3D layer roughly triples the
bundle, and it is served as a static asset from Workers with no server to
stream it.

So the recommendation, in order:

1. **Ship Motion first.** It is cheap and it is where most of the perceived
   uplift lives — the drafting FLIP in §2.1 alone changes how the game feels.
2. **Make R3F a progressive enhancement**, dynamically imported on idle (§1.2).
   The game must be fully playable before it arrives and fully playable if it
   never does.
3. **Consider not using R3F at all.** A hand-rolled 2D canvas emitter is about
   80 lines and 0 kB of dependencies, and for round additive sprites over a dark
   board it is visually indistinguishable from §3. Everything in §1 about
   layering, coordinates, and the event bus applies unchanged — only the
   renderer swaps. The R3F guide below is complete because you asked for it, but
   if the bundle matters more than the shader headroom, that is the better
   trade.

---

## 1. Architecture and performance

### 1.1 One canvas, ever

Each `<Canvas>` is a WebGL context. Browsers cap contexts somewhere between 8
and 16 and start evicting the oldest, so a canvas per factory card is a
guaranteed collapse. There is exactly **one** canvas, it is fixed to the
viewport, it never unmounts, and game code talks to it through a bus.

```
src/effects/
  bus.ts            emitBurst / onBurst — a module singleton, no context
  EffectsCanvas.tsx the single <Canvas>, dynamically imported
  Embers.tsx        the one <points> that draws everything
  screen.ts         CSS pixels → world units
```

A module singleton rather than React context on purpose: the canvas lives behind
a `dynamic()` boundary, and a context provider would have to wrap the whole
board and therefore be in the main bundle.

```ts
// src/effects/bus.ts
export type Burst = {
  /** Viewport CSS pixels — straight out of getBoundingClientRect(). */
  readonly x: number;
  readonly y: number;
  readonly count?: number;
  /** Any CSS colour. Read the theme token and pass it through. */
  readonly color?: string;
  /** Radians of cone half-angle, measured off straight up. */
  readonly spread?: number;
  readonly speed?: number;
};

type Listener = (burst: Burst) => void;
const listeners = new Set<Listener>();

/**
 * Fire and forget. Nothing is queued: with no canvas mounted the burst is
 * dropped, which is the correct behaviour for decoration.
 */
export function emitBurst(burst: Burst): void {
  for (const listener of listeners) listener(burst);
}

export function onBurst(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
```

### 1.2 Keeping it off the main thread

WebGL draws on the GPU, but R3F's render loop is `requestAnimationFrame` on the
main thread — so "not blocking" is mostly about not *doing* anything per frame.

**`frameloop="demand"` is the single biggest lever here, and it is specific to
this game.** A turn-based board is static almost all of the time. On demand, R3F
renders only when something calls `invalidate()`. Between bursts the canvas costs
literally nothing: no rAF, no draw, no GC churn.

```tsx
// src/effects/EffectsCanvas.tsx
"use client";

import { Canvas } from "@react-three/fiber";
import { Embers } from "./Embers";

export default function EffectsCanvas() {
  return (
    <Canvas
      // Renders only when invalidate() is called. The board is static between
      // moves, so this is the difference between 0% and 8% of a core at idle.
      frameloop="demand"
      orthographic
      // zoom 1 makes one world unit exactly one CSS pixel, which is what lets
      // a DOM rect be an emitter position without any projection maths.
      camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 1000 }}
      dpr={[1, 1.5]}
      gl={{
        // The glow does the softening; AA on additive sprites buys nothing.
        antialias: false,
        alpha: true,
        powerPreference: "high-performance",
        // Nothing is ever read back or screenshotted.
        preserveDrawingBuffer: false,
      }}
      style={{
        position: "fixed",
        inset: 0,
        // Never steals a click. The board does not know this exists.
        pointerEvents: "none",
        zIndex: 20,
      }}
    >
      <Embers />
    </Canvas>
  );
}
```

Mount it lazily, after the board is interactive, and behind the `useMounted`
gate that already exists for the static export:

```tsx
// in BoardShell (or Game), alongside the existing mounted check
const EffectsCanvas = dynamic(() => import("@/effects/EffectsCanvas"), {
  ssr: false,
  // Decoration has no loading state.
  loading: () => null,
});

const [effectsReady, setEffectsReady] = useState(false);

useEffect(() => {
  // Three.js parse is ~15ms of main thread on a mid laptop. Spend it when the
  // player is reading the board, not while they are waiting for it.
  const idle = requestIdleCallback?.(() => setEffectsReady(true), { timeout: 3000 });
  return () => idle !== undefined && cancelIdleCallback?.(idle);
}, []);

// …
{mounted && effectsReady && !reducedMotion && <EffectsCanvas />}
```

Three more rules that matter more than any config flag:

- **Never `setState` in `useFrame`.** Mutate refs and typed arrays. One
  `setState` per frame re-reconciles the React tree sixty times a second and is
  the actual cause of almost every "R3F is slow" report.
- **Never a React component per particle.** §3 draws every particle in the game
  with one `<points>` and one draw call.
- **`React.memo` the canvas wrapper with no changing props**, so board
  re-renders — which happen on every move — cannot touch the 3D tree.

### 1.3 Mixing DOM and canvas without a z-index war

The trick is to stop thinking of them as layers that interleave. They do not.
There is one ladder, declared once, and nothing negotiates:

| Layer | z-index | Notes |
|---|---|---|
| Board DOM (panels, cards, dock) | 0–10 | where every readable thing lives |
| Effects canvas | 20 | `position: fixed`, `pointer-events: none` |
| Grain overlay | 100 | already in `globals.css` |
| `<dialog>` | — | the browser's top layer, above all of it for free |

The result dialog is already a native `<dialog>`, so it is above the canvas
without anyone doing anything. That is worth keeping.

**Put the canvas above the board, not below it.** Embers should pass in front of
a card, and a canvas underneath a panel with an opaque fill is a canvas you
cannot see.

**Do not reach for `mix-blend-mode: screen` on the canvas element.** It promotes
the entire page into one composited blending group and can cost more than the
particles do. Get additive light *inside* the canvas instead —
`AdditiveBlending` on the material — and let the canvas composite over the DOM
with ordinary alpha. Same look, none of the cost.

**Coordinates.** With `orthographic` and `zoom: 1`, the visible world is exactly
`width × height` units centred on the origin, so the bridge is two subtractions:

```ts
// src/effects/screen.ts
/** A viewport CSS point in the canvas's world units. */
export function toWorld(x: number, y: number, width: number, height: number) {
  return [x - width / 2, height / 2 - y] as const;
}

/** Where a DOM element is, for something to be emitted from it. */
export function anchorOf(el: Element, edge: "center" | "bottom" = "center") {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: edge === "bottom" ? r.bottom : r.top + r.height / 2 };
}
```

**Two things not to do.** Do not use drei's `<Html>` for game UI — it re-parents
DOM into the canvas container, which fights shared-layout animation and puts
your text inside a transformed ancestor. And do not try to render cards as 3D
planes; they are text, and text belongs to the DOM's rasteriser.

---

## 2. Choreography

### 2.0 First, a seam the game does not have yet

`applyMove` is a pure transition: the engine returns a new state and says
nothing about what just happened. Animation needs the verb. Rather than teach
the engine about presentation, diff two consecutive states on the way past:

```ts
// src/hooks/useGameEvents.ts
"use client";

/**
 * What just happened, worked out by comparing the state before a move with the
 * state after it. The engine stays free of display concerns — it does not know
 * an animation exists — and the board gets verbs instead of snapshots.
 */
export type GameEvent =
  | { kind: "drafted"; cardId: string; playerIndex: number }
  | { kind: "built"; cardId: string; playerIndex: number }
  | { kind: "produced"; cardId: string; playerIndex: number; goods: number }
  | { kind: "gained"; playerIndex: number; metal: number; energy: number; goods: number }
  | { kind: "turn"; playerIndex: number }
  | { kind: "phase"; phase: Phase };

export function useGameEvents(state: GameState, onEvent: (event: GameEvent) => void) {
  const previous = useRef(state);

  useEffect(() => {
    const before = previous.current;
    previous.current = state;
    if (before === state) return;

    for (const [index, after] of state.players.entries()) {
      const was = before.players[index];

      // A card that is in a compound now and was in a hand then was built.
      for (const building of after.compound) {
        if (!was.compound.some((b) => b.card.id === building.card.id)) {
          onEvent({ kind: "built", cardId: building.card.id, playerIndex: index });
        }
      }
      // A perk that was not worked and now is produced whatever arrived with it.
      for (const building of after.compound) {
        const then = was.compound.find((b) => b.card.id === building.card.id);
        if (then && !then.worked && building.worked) {
          const goods = after.resources.goods - was.resources.goods;
          onEvent({ kind: "produced", cardId: building.card.id, playerIndex: index, goods });
        }
      }
      // …and the plain deltas, for the chips in the dock header.
      const d = {
        metal: after.resources.metal - was.resources.metal,
        energy: after.resources.energy - was.resources.energy,
        goods: after.resources.goods - was.resources.goods,
      };
      if (d.metal || d.energy || d.goods) onEvent({ kind: "gained", playerIndex: index, ...d });
    }

    if (before.currentPlayerIndex !== state.currentPlayerIndex) {
      onEvent({ kind: "turn", playerIndex: state.currentPlayerIndex });
    }
    if (before.phase !== state.phase) onEvent({ kind: "phase", phase: state.phase });
  }, [state, onEvent]);
}
```

Two things to know about this hook. It runs in an effect, so it fires *after*
paint — which is what you want, because the DOM has already moved and
`getBoundingClientRect` will give you where things actually are. And it is
`O(compound)`, which is at most a dozen cards.

### 2.0b The AI timer will fight you

[`useGame.ts:16`](../src/hooks/useGame.ts) sets `AI_THINK_MS = 450` and then
plays blind. The drafting sequence below takes ~520 ms, so the automaton's next
move will land mid-flight and re-render the board out from under an animation
that has not settled. Two changes:

```ts
// Long enough to outlast the draft FLIP in docs/motion.md §2.1, which is the
// longest thing the board does. A guess either way, but a guess on the right
// side of the animation.
const AI_THINK_MS = 720;
```

and, better, gate the effect on an `animating` flag the event queue owns, so the
pause is a floor rather than a bet. The timer is the only place in the codebase
where presentation timing already leaks into logic; it is worth doing properly
before adding 400 ms of choreography on top of it.

### 2.1 Card drafting — row to hand

The engine moves the card in one synchronous `applyMove`: out of
`state.blueprints.row`, into `player.hand`. In the DOM that is an unmount from
one list and a mount in another, which is exactly what shared-layout animation
is for.

**Why this works at all:** ids are globally unique and stable for the whole game
(`aluminum-factory-0`, `aluminum-factory-1` — [cards.ts:708](../src/engine/cards.ts)),
so `layoutId` has something honest to key on. If two copies of a card shared an
id, Motion would try to animate one element to two places and the board would
visibly tear. Namespace it anyway, since blueprints and contractors are expanded
by separate calls:

```tsx
layoutId={`card:${card.kind}:${card.id}`}
```

**The fixed plate pays off here.** Cards are a fixed 164×228 (theme.md §4.1), so
the FLIP is a pure translate — no scale distortion of the text, no need for
`layout="position"`. Variable-height cards would have squashed their own rules
text on the way across.

Timeline, ~520 ms:

| At | What | How |
|---|---|---|
| 0 ms | **Press.** Card lifts to 1.06 and the rim flares to `--shadow-glow-spice-hi`. | `whileTap`, 60 ms. Do not wait for state — this is the click's receipt. |
| 60 ms | `play(move)` commits. FLIP begins. | `layoutId` + `layout` |
| 60–410 ms | **Travel.** Arcs, shrinks in flight, overshoots on arrival. | spring `{ stiffness: 420, damping: 32, mass: 0.9 }` |
| 60–410 ms | **Smear.** `rotate: [0, -6, 0]`, `scale: [1.06, 0.96, 1]` | keyframes on the inner layer |
| 410 ms | **Arrival.** Hand section border flashes spice for 140 ms; neighbours slide aside. | `onLayoutAnimationComplete` → `layout` on the row |
| 410 ms | A small ember puff at the card's bottom edge. | `emitBurst(anchorOf(el, "bottom"))` |
| 420–520 ms | **Backfill.** The replacement rises out of the deck position. | `initial={{ opacity: 0, y: -12, scale: 0.94 }}` |

A spring rather than a cubic bézier because the overshoot is the point: a card
that arrives and settles reads as having mass, and a card that eases to a stop
reads as a div. Keep `damping` above ~28 or it wobbles like rubber.

On the trail: true velocity-driven skew is not available here. Motion writes the
layout transform directly rather than through a `MotionValue` you can hand to
`useVelocity`, so `rotate`/`scale` keyframes on the inner layer are the honest
version. It reads the same.

**No `AnimatePresence` around the lists.** This document originally called for
`mode="popLayout"` on the hand; building it showed that to be wrong. An exiting
copy left behind in the market row would share a `layoutId` with the arriving
one, and two elements claiming to be the same card is exactly how a
shared-layout transition tears. A card moving between lists needs no
`AnimatePresence` at all — Motion records the old box before the commit and
animates the newly-mounted element from it. Keep `AnimatePresence` for things
that leave *without* reappearing.

`layout="position"` rather than plain `layout`, for the same reason the fixed
plate helps: there is no size to interpolate, so say so and skip the work.

### 2.2 Factory production

The rule for all of it: **take something away before you give it.** An
anticipation frame is what separates a machine turning over from a div lighting
up.

| At | What |
|---|---|
| 0–80 ms | **Anticipation.** `scaleY: 0.97`, and the glow *dims* to 0.4. The card gathers itself. |
| 80–140 ms | **Release.** `scale: 1.04`, rim to `-hi`, and a 1px white-hot inner ring expands and dies (`scale: 1 → 1.8`, `opacity: 1 → 0`). |
| 100 ms | **Embers.** 14–20 particles from the card's bottom edge, additive, `--color-res-goods` for goods and `--color-spice-400` for energy, ~600 ms life. |
| 160–420 ms | **Receipt.** A `+1` rises and fades out of the dock chip (`y: -14`), the glyph pulses `1 → 1.35 → 1`, and the number *rolls* rather than swapping (§5.1). |
| 140–280 ms | A brief `saturate(1.15) brightness(1.05)` on the panel. Subliminal; 140 ms is enough. |

**Screen shake: almost never.** No shake for a good — it fires several times a
round and would turn the board into a paint mixer. Reserve it for standing up a
Megalith and for the game ending, at 2–3 px over 120 ms with an exponential
decay (§5.4). Shake is the most overused technique in this whole document and
the fastest way to make a game feel cheap.

### 2.3 UI feedback, Dota-style

Dota's feel is not "smooth". It is **fast, rim-lit, and tactile**: highlights
land in under 100 ms, the thing that changes is *light* rather than *position*,
and every click has a hard edge to it.

- **Hover a card or chip: 80 ms, and brighten rather than move.** A 200 ms hover
  feels like syrup. Nothing translates on hover except by a pixel or two.
- **Tooltips: 250 ms in, instant out, and shared.** Put the delay on the group,
  not the element, so sliding along a row of chips does not re-wait each time —
  `LayoutGroup` plus one shared timer.
- **Linked highlighting.** Hovering the metal chip should dim every card the
  player cannot currently afford. This is the most Dota-like thing available and
  the data is already computed: `board.builds` is the legal set, so the diff
  against the full hand is the "too expensive" set. Costs nothing and makes the
  board feel like it understands itself.
- **Working a perk = casting.** The die snaps into its socket with a 90 ms
  overshoot; a ring expands out of the socket and fades. A building already
  worked this round takes a radial `conic-gradient` sweep — reads instantly as a
  cooldown to anyone who has played a MOBA.
- **Turn transitions: 240 ms, and never blocking.** A spice rail wipes
  left-to-right under the top bar, the phase pill crossfades, the finished
  player's panel desaturates over 200 ms while the next one's rim ignites. Input
  stays live the whole time; a transition that eats clicks is worse than no
  transition.

---

## 3. The particle system

### 3.1 The shape of it

One `<points>`. One material. One draw call for every particle on screen. A
fixed pool that is never resized, and — the important part — **the simulation
lives in the vertex shader**. The CPU writes a particle's initial conditions
once, at emit, and then never touches it again; `useFrame` advances a single
`uTime` uniform. There is no per-frame particle loop at all.

```tsx
// src/effects/Embers.tsx
"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, Color, type BufferAttribute, type ShaderMaterial } from "three";
import { onBurst } from "./bus";
import { toWorld } from "./screen";

/**
 * Every ember in the game, at once. Sized for the worst case — a Megalith
 * finishing while three perks resolve — and then left alone: the pool is
 * allocated once and written into as a ring, so nothing allocates mid-game and
 * there is no garbage for the collector to find between frames.
 */
const POOL = 768;

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;

  attribute vec3 aVelocity;
  attribute float aBirth;
  attribute float aLife;
  attribute float aSize;
  attribute vec3 aColor;

  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    float age = uTime - aBirth;
    float t = age / aLife;

    // Unborn or dead: collapse to a degenerate point outside the frustum. The
    // pool keeps its size and the slot costs one discarded vertex.
    if (t < 0.0 || t > 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      return;
    }

    // Ballistic with drag, integrated in closed form so the CPU is not in the
    // loop: position is a pure function of age.
    float drag = (1.0 - exp(-2.2 * age)) / 2.2;
    vec3 p = position + aVelocity * drag;
    p.y -= 38.0 * age * age;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);

    // Small and hot at birth, swelling as it cools and fades.
    gl_PointSize = aSize * (0.55 + t) * uPixelRatio;
    vAlpha = (1.0 - t) * (1.0 - t);
    vColor = aColor;
  }
`;

const FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    // A soft round sprite, drawn procedurally. No texture to load, decode,
    // upload or sample — and it stays crisp at any point size.
    float d = length(gl_PointCoord - 0.5);
    float core = 1.0 - smoothstep(0.0, 0.5, d);
    if (core <= 0.0) discard;

    // The core reads hotter than the colour it was given, which is what makes
    // an ember look like it is emitting rather than reflecting.
    gl_FragColor = vec4(vColor * (0.35 + core * 1.8), core * core * vAlpha);
  }
`;

export function Embers() {
  const material = useRef<ShaderMaterial>(null);
  const geometry = useRef<{ attributes: Record<string, BufferAttribute> }>(null);
  const cursor = useRef(0);
  /** When the last live particle dies. Until then, keep asking for frames. */
  const deadline = useRef(0);

  const { invalidate, size, clock } = useThree();

  const buffers = useMemo(
    () => ({
      position: new Float32Array(POOL * 3),
      aVelocity: new Float32Array(POOL * 3),
      aColor: new Float32Array(POOL * 3),
      aBirth: new Float32Array(POOL).fill(-1e3),
      aLife: new Float32Array(POOL).fill(1),
      aSize: new Float32Array(POOL).fill(6),
    }),
    [],
  );

  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uPixelRatio: { value: 1 } }),
    [],
  );

  useEffect(() => {
    const scratch = new Color();

    return onBurst(({ x, y, count = 16, color = "#ff8a3d", spread = 0.6, speed = 190 }) => {
      const attrs = geometry.current?.attributes;
      if (!attrs) return;

      const [wx, wy] = toWorld(x, y, size.width, size.height);
      const now = clock.elapsedTime;
      scratch.set(color);

      for (let n = 0; n < count; n++) {
        const i = cursor.current;
        cursor.current = (cursor.current + 1) % POOL;

        // Straight up, give or take — embers off hot metal, not a firework.
        const angle = Math.PI / 2 + (Math.random() - 0.5) * 2 * spread;
        const v = speed * (0.55 + Math.random() * 0.75);
        const life = 0.45 + Math.random() * 0.5;

        buffers.position.set([wx + (Math.random() - 0.5) * 26, wy, 0], i * 3);
        buffers.aVelocity.set([Math.cos(angle) * v, Math.sin(angle) * v, 0], i * 3);
        buffers.aColor.set([scratch.r, scratch.g, scratch.b], i * 3);
        buffers.aBirth[i] = now;
        buffers.aLife[i] = life;
        buffers.aSize[i] = 3 + Math.random() * 5;

        deadline.current = Math.max(deadline.current, now + life);
      }

      // Only the slices that changed. Uploading 768 particles to re-light 16 is
      // the difference between this being free and this being a profile entry.
      for (const name of ["position", "aVelocity", "aColor", "aBirth", "aLife", "aSize"]) {
        attrs[name].needsUpdate = true;
      }

      // frameloop is "demand", so the loop has to be asked to start.
      invalidate();
    });
  }, [buffers, clock, invalidate, size.height, size.width]);

  useFrame(({ clock, viewport }) => {
    if (!material.current) return;
    material.current.uniforms.uTime.value = clock.elapsedTime;
    material.current.uniforms.uPixelRatio.value = viewport.dpr;

    // Self-sustaining while anything is alive, and silent the moment nothing
    // is. This is what makes an idle board cost zero.
    if (clock.elapsedTime < deadline.current) invalidate();
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry ref={geometry}>
        <bufferAttribute attach="attributes-position" args={[buffers.position, 3]} />
        <bufferAttribute attach="attributes-aVelocity" args={[buffers.aVelocity, 3]} />
        <bufferAttribute attach="attributes-aColor" args={[buffers.aColor, 3]} />
        <bufferAttribute attach="attributes-aBirth" args={[buffers.aBirth, 1]} />
        <bufferAttribute attach="attributes-aLife" args={[buffers.aLife, 1]} />
        <bufferAttribute attach="attributes-aSize" args={[buffers.aSize, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        transparent
        // Light adds. Two embers crossing are brighter than one, which is the
        // whole reason this looks like heat.
        blending={AdditiveBlending}
        // Nothing occludes anything; sorting additive sprites is wasted work.
        depthWrite={false}
        depthTest={false}
      />
    </points>
  );
}
```

Calling it, from the production choreography in §2.2:

```tsx
import { emitBurst } from "@/effects/bus";
import { anchorOf } from "@/effects/screen";

onEvent: (event) => {
  if (event.kind !== "produced") return;
  const el = document.querySelector(`[data-card-id="${event.cardId}"]`);
  if (!el) return;
  const { x, y } = anchorOf(el, "bottom");
  emitBurst({
    x,
    y,
    count: 14 + event.goods * 4,
    // Read the token rather than hardcoding — the theme owns the colour.
    color: getComputedStyle(el).getPropertyValue("--color-res-goods").trim(),
  });
};
```

Add `data-card-id={card.id}` to the card element. A data attribute rather than a
ref registry because the emitter is fire-and-forget and must not keep cards
alive or care whether one has unmounted.

### 3.2 Why `Points` and not `Sparkles`

drei's `<Sparkles>` is ambient — a drifting volume of motes with no emit API. It
is the right call for dust hanging in the desert air behind the board, and the
wrong one for "this factory just produced". Use both, for different jobs:

```tsx
// Atmosphere only. One instance, parked behind everything, never triggered.
<Sparkles count={60} scale={[size.width, size.height, 1]} size={2} speed={0.08} opacity={0.25} />
```

Note that ambient drift and `frameloop="demand"` are in tension — anything
continuously animating means you are always rendering. If you want the dust,
either accept a permanent loop at low `dpr`, or do the drift in CSS on a DOM
layer instead and keep the canvas purely event-driven. On a turn-based game I
would do the latter.

### 3.3 Performance, in order of how much it matters

1. **`frameloop="demand"`.** Zero cost at idle, which is most of the game.
2. **One draw call.** One `<points>`, one material, every particle. Adding a
   second material doubles your draw calls for no visual gain.
3. **Simulate in the shader.** No CPU loop, so particle count is nearly free —
   768 and 8000 cost the same on the main thread.
4. **Partial buffer uploads.** Or at minimum, only flag `needsUpdate` on emit,
   never per frame.
5. **`dpr={[1, 1.5]}`, `antialias: false`.** Additive sprites on a dark board
   have nothing to alias.
6. **`depthWrite`/`depthTest` off, `frustumCulled={false}`.** No sorting, no
   per-frame bounds recompute on a geometry whose vertices the CPU never reads.

**When to use `InstancedMesh` instead.** `Points` cannot rotate — `gl_PointCoord`
is axis-aligned, always. If you want spice flakes that tumble, or streaked
sparks that orient along their velocity, you need quads: one `<instancedMesh>`
with a plane geometry and per-instance attributes, same closed-form shader
simulation, still one draw call. The cost is four vertices per particle instead
of one, which at these counts is noise. For round embers, `Points` is strictly
cheaper and looks identical.

### 3.4 Do not add postprocessing

A bloom pass is the obvious way to make embers glow, and it is the wrong one
here: `postprocessing` is ~100 kB, it forces a full-screen render target, and
`frameloop="demand"` plus multi-pass rendering is a fight you do not need. The
additive core in the fragment shader already reads as hot, and everything in the
DOM already has a real glow from `--shadow-glow-spice`. Spend nothing.

---

## 4. The card component

### 4.1 The gotcha that shapes the whole thing

**Tilt and layout animation both want `transform`.** Motion writes the layout
projection transform directly onto the element it is animating, so if that same
element also has `rotateX`/`rotateY` from a hover, they will stamp on each other
— the card will snap flat mid-flight, or arrive at the wrong place, depending on
ordering.

The fix is structural and not negotiable: **two elements.** The outer owns
`layoutId` and nothing else. The inner owns the tilt and never moves.

```
<motion.div layoutId layout>        ← travels. transform belongs to Motion.
  <motion.div style={{ rotateX }}>  ← tilts. transform belongs to you.
```

```tsx
// src/components/MotionCard.tsx
"use client";

import { useRef } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import type { Card } from "@/engine";
import styles from "./game.module.css";

type Props = {
  card: Card;
  /** There is something you can do with this card right now. */
  playable?: boolean;
  /** Mid-choice: this is the card being paid for. */
  selected?: boolean;
  onSelect?: () => void;
  children: React.ReactNode;
};

export function MotionCard({ card, playable, selected, onSelect, children }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  // Pointer position over the card, as -0.5 … 0.5 on each axis.
  const px = useMotionValue(0);
  const py = useMotionValue(0);

  // Springs, so the plate keeps tilting for a beat after the pointer stops —
  // the difference between a card with mass and a card glued to the cursor.
  const sx = useSpring(px, { stiffness: 300, damping: 22, mass: 0.4 });
  const sy = useSpring(py, { stiffness: 300, damping: 22, mass: 0.4 });

  const rotateY = useTransform(sx, [-0.5, 0.5], [-9, 9]);
  const rotateX = useTransform(sy, [-0.5, 0.5], [7, -7]);

  // The specular highlight. Tilt alone reads as a skew; it only reads as a
  // physical plate once the light moves across it the other way.
  const glareX = useTransform(sx, [-0.5, 0.5], [18, 82]);
  const glareY = useTransform(sy, [-0.5, 0.5], [12, 88]);
  const sheen = useMotionTemplate`radial-gradient(150px 150px at ${glareX}% ${glareY}%, rgb(255 233 200 / 20%), transparent 72%)`;

  function track(event: React.PointerEvent) {
    if (reduced) return;
    const r = host.current?.getBoundingClientRect();
    if (!r) return;
    px.set((event.clientX - r.left) / r.width - 0.5);
    py.set((event.clientY - r.top) / r.height - 0.5);
  }

  return (
    <motion.div
      // Globally unique and stable for the whole game, so the FLIP from the
      // market row to the hand has something honest to key on. Namespaced
      // because blueprints and contractors are expanded separately.
      layoutId={`card:${card.kind}:${card.id}`}
      layout
      data-card-id={card.id}
      // Position only: the plate is a fixed 164x228, so there is no size
      // interpolation to distort the rules text.
      transition={{ type: "spring", stiffness: 420, damping: 32, mass: 0.9 }}
      // Exit through popLayout so a card leaving does not shove its neighbours
      // before the gap is real.
      initial={{ opacity: 0, y: -12, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
    >
      <motion.div
        ref={host}
        className={styles.card}
        onPointerMove={track}
        onPointerLeave={() => {
          px.set(0);
          py.set(0);
        }}
        onClick={onSelect}
        style={{
          rotateX,
          rotateY,
          // On the element itself rather than the parent, so a row of cards
          // does not share one vanishing point and fan like a pop-up book.
          transformPerspective: 900,
          transformStyle: "preserve-3d",
        }}
        whileHover={reduced ? undefined : { scale: 1.03 }}
        whileTap={reduced ? undefined : { scale: 0.985 }}
        transition={{ duration: 0.08, ease: "easeOut" }}
      >
        {children}

        {/* The moving highlight. Painted over the face, under nothing. */}
        <motion.div className={styles.sheen} style={{ background: sheen }} aria-hidden />

        {/*
          * The glow is its own layer whose *opacity* animates. Animating
          * box-shadow itself re-rasterises the card every frame; animating the
          * opacity of a pre-rendered shadow is a compositor job.
          */}
        <motion.div
          className={selected ? styles.glowChosen : styles.glowSpice}
          aria-hidden
          initial={false}
          animate={
            selected
              ? { opacity: 1 }
              : playable && !reduced
                ? { opacity: [0.55, 1, 0.55] }
                : { opacity: playable ? 0.85 : 0 }
          }
          transition={
            playable && !selected && !reduced
              ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.18 }
          }
        />
      </motion.div>
    </motion.div>
  );
}
```

With the glow layers in CSS, reusing the tokens the theme already defines:

```css
.sheen,
.glowSpice,
.glowChosen {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
}

.glowSpice {
  box-shadow: var(--shadow-glow-spice-hi);
}

.glowChosen {
  box-shadow: var(--shadow-glow-chosen);
}
```

### 4.2 Wiring it up without rewriting the board

- `<MotionConfig reducedMotion="user">` once at the root of `<Game>`. That is the
  whole accessibility story for every animation in the tree, and it is one line.
- `<LazyMotion features={domMax} strict>` plus importing `m` instead of `motion`
  keeps ~10 kB out of the initial bundle. `strict` makes using `motion` by
  mistake a build error rather than a silent regression.
- `AnimatePresence mode="popLayout"` around the hand and the market rows.
- Keep `Game.tsx`'s move logic exactly as it is. `optionsFor`/`resolve`/
  `selectCard` are the interaction brain; `MotionCard` wraps the presentation
  and `CardView`'s body renders inside it as `children`.

### 4.3 The dice will need a decision

`PlayerPanel` drags dice with HTML5 drag-and-drop — `draggable`, `onDragStart`,
`dataTransfer`. Motion's `drag` is pointer-events based and sets
`touch-action: none`. **They do not compose**; putting `drag` on a `draggable`
element gives you a native ghost image racing a transform.

Either:

- **Keep HTML5 DnD** and animate only the drop target (socket glow, ring
  expansion). Zero refactor. The dragged die keeps the browser's ghost, which
  looks like a file being moved, because it is.
- **Move to Motion `drag`** with `dragSnapToOrigin`, hit-testing drops with
  `document.elementFromPoint` in `onDragEnd`. The die then actually follows your
  finger with spring physics and snaps home when you miss — much better, and it
  fixes touch, where HTML5 DnD does not work at all.

The second is the right answer and it is a contained change: the drop targets
already exist as sets in `board.dice`, so only the gesture layer moves. Worth
doing before adding polish to a gesture that does not work on a phone.

---

## 5. Juice

Five techniques, cheapest first, all of which drop into the existing components.

### 5.1 Numbers that roll

The single highest ratio of *feels expensive* to *effort* in this document.
Every resource count, every score.

```tsx
function Rolling({ value }: { value: number }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => Math.round(v).toString());
  useEffect(() => {
    animate(mv, value, { duration: 0.45, ease: [0.16, 1, 0.3, 1] });
  }, [mv, value]);
  return <motion.span>{text}</motion.span>;
}
```

Everything numeric is already `font-variant-numeric: tabular-nums`, so nothing
reflows while it counts. Pair it with a colour flash on the delta's sign — green
up, ember down — and a `+1` that rises and fades.

### 5.2 Anticipation and overshoot on press

Two percent of squash, and a hard edge to the click:

```
active:scale-[0.98] active:translate-y-px transition-transform duration-[60ms]
```

Then let it release past 1.0 — `whileTap={{ scale: 0.98 }}` with a spring back
gives the overshoot for free. The `.moveButton` brass plate already drops its
highlight and pools shadow on `:active`; this adds the movement it implies.

### 5.3 A light rake across metal

A gradient that sweeps on hover. On brushed brass it reads as a real specular
highlight travelling over the surface, which is exactly the theme's material
claim:

```css
.plate { position: relative; overflow: hidden; }

.plate::after {
  content: "";
  position: absolute;
  inset: -40% -60%;
  background: linear-gradient(105deg, transparent 35%, rgb(255 233 200 / 16%) 50%, transparent 65%);
  transform: translateX(-60%);
  transition: transform 420ms ease-out;
}

.plate:hover::after { transform: translateX(60%); }

@media (prefers-reduced-motion: reduce) {
  .plate::after { transition: none; }
}
```

### 5.4 Screen shake, with a real decay envelope

One wrapper, one hook, and strict rationing — Megaliths and the game ending, and
nothing else.

```ts
export function useShake() {
  const ref = useRef<HTMLElement>(null);
  return useCallback((amplitude = 3, ms = 140) => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    const step = (now: number) => {
      const t = (now - start) / ms;
      if (t >= 1) {
        el.style.transform = "";
        return;
      }
      // Decaying sinusoid: it hits hardest immediately and is gone before the
      // player can decide whether it was annoying.
      const decay = amplitude * Math.exp(-4 * t);
      el.style.transform = `translate(${Math.sin(t * 42) * decay}px, ${Math.cos(t * 37) * decay}px)`;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);
}
```

Mutating `style.transform` directly rather than through state: sixty renders in
140 ms to shake a div is not a trade worth making.

### 5.5 Focus pull for a choice in progress

The best of the five, because the state already exists. `Game.tsx` knows when a
choice is mid-flight — `payments`, `borrowing`, `choice`. While one is open,
blur and desaturate everything that is not a candidate:

```css
.board[data-choosing="true"] .section:not([data-candidate="true"]) {
  filter: blur(2.5px) saturate(0.55) brightness(0.8);
  transition: filter 180ms ease-out;
}
```

This is Dota's ability-targeting mode, and the effect on comprehension is much
larger than it sounds: the board stops being twelve cards and becomes the two
you are choosing between. Beware `backdrop-filter` on large areas — `filter` on
the panels themselves is cheaper and has no stacking-context surprises.

### Bonus: the blueprint draws itself

The thematic payoff, when the card art eventually exists. On build, animate the
line art's `stroke-dashoffset` from full to zero — the structure inks itself
onto the plate over ~600 ms — then cross-fade the art from blueprint-on-navy to
ink-on-parchment (theme.md §4.1). Motion does this natively on SVG:

```tsx
<motion.path
  initial={{ pathLength: 0, opacity: 0.4 }}
  animate={{ pathLength: 1, opacity: 1 }}
  transition={{ duration: 0.6, ease: "easeInOut" }}
/>
```

That single moment — paper becoming architecture — is the one the whole theme is
built around. Spend the most time here.

---

## 5b. Verifying animation, and two ways to fool yourself

Both of these cost real time once. Neither is a bug in anything.

**A hidden preview pane runs no frames.** `requestAnimationFrame` is throttled
to zero when `document.hidden` is true, which it is whenever the app window is
behind another window. Time-based animations queue and never advance, so an
element sits at its `initial` values forever and an `AnimatePresence` exit never
completes — which looks *exactly* like a broken animation. `setTimeout` keeps
running, so state moves on while nothing on screen does, which makes it look
worse. Check before debugging anything:

```js
requestAnimationFrame(() => {}); // then:
({ hidden: document.hidden, frames: /* count over 500ms */ });
```

Forcing a screenshot asks for a composite, which runs a few frames — enough to
step an animation and confirm it reaches its target, though not enough to sample
it smoothly.

**A spring interpolates two values, not a keyframe list.** `animate={{ rotate:
[0, -4, 0] }}` against a spring transition throws *"Only two keyframes currently
supported with spring and inertia animations"* — and it throws at animation
time, so it will not show up in a typecheck or a test. Drive the effect off a
boolean instead and let it travel out and back on the same spring, which is
usually what you wanted anyway. **Read the console after any animation change;**
this class of error is invisible everywhere else.

**Inline style is not the source of truth.** Motion hands compositable
properties — opacity in particular — to the Web Animations API, so the value
lives in the animation timeline and `element.getAttribute("style")` keeps
showing whatever was last written there. Transform often *is* in the inline
style, because it is usually driven by a MotionValue chain. Reading the
attribute therefore shows transform animating while opacity appears frozen.
Always read `getComputedStyle(el).opacity`.

## 6. Order to build it in

Each step is shippable and none of them depends on the next.

1. **Motion, plus `MotionConfig reducedMotion="user"`.** Nothing animates yet.
2. **`useGameEvents`** (§2.0) and fix `AI_THINK_MS` (§2.0b). Log the events and
   watch them in the console for a game or two — if the verbs are wrong,
   everything downstream is wrong.
3. **`MotionCard`** (§4): tilt, sheen, glow layers. Biggest visible change for
   the least risk, and no new coordinate systems.
4. **The drafting FLIP** (§2.1). This is the one that changes how the game
   feels.
5. **Juice** (§5.1, §5.2, §5.5). Numbers, press, focus pull.
6. **Dice gesture decision** (§4.3) — before polishing a gesture that is broken
   on touch.
7. **R3F embers** (§1–3), on idle, behind a flag. Measure the bundle before and
   after and decide whether the 200 kB bought as much as steps 3–5 did.

---

## 7. What step 7 turned out to be

Built as `src/effects`: a `bus` (pure pub/sub), `screen` (pure coordinate
conversion, unit-tested), `cardBurst` (id → DOM → anchor → burst), `Embers`
(the `<points>` and the shader), `EffectsCanvas` (the lazy boundary), and
`EmbersLayer` (the two gates).

Wired to two events, and they are deliberately unalike, because one is a
payout and the other is an impact:

| | `produced` | `placed` |
|---|---|---|
| Means | a factory paid out | a die was struck into a Headquarters slot |
| From | the bottom edge of the card | the centre of the section's dice row |
| Colour | goods green, or hot metal | aether |
| Count | `14 + goods × 5`, capped at 56 | 12 |
| Spread | 0.6 rad — a fountain | 1.15 rad — a flat spray |

The aether is not decoration: the theme already spends that colour on *the die
you are holding lands here*, so the slot glows aether while you drag and the
landing finishes the sentence the drag started. Keeping the two bursts
different in colour *and* silhouette is what stops "something happened" from
collapsing into one undifferentiated sparkle.

`placed` did not exist — `diffStates` had nothing to say about the
Headquarters. It is detected by list length rather than by comparing faces,
because two dice showing the same number on one section are two placements and
a face comparison would see one. Placements only grow within a round, so a
shorter list is the between-rounds sweep and not a move.

Three corrections to what is written above.

### 7.1 `clock.elapsedTime` is a trap under `frameloop="demand"`

§3.1 stamps a particle's birth from three's clock. Do not. That clock only
advances when a frame renders, and on demand there are no frames between turns
— so a burst emitted after ten idle seconds stamps a birth ten seconds in the
past and every particle in it is already dead on its first frame. It fails
*only* when the loop has been idle, which is to say it works perfectly in
development with something always animating and never once in a real game.

Read wall time instead, in both places:

```ts
function now(): number {
  return performance.now() / 1000;
}
```

### 7.2 A hand-written shader needs the colour space asking for

`ShaderMaterial` gets three's shader prefix but not its chunks, so a
`gl_FragColor` written by hand goes to the framebuffer as linear values in a
space that expects sRGB — every ember comes out muddy. One line fixes it, at
the end of `main`:

```glsl
#include <colorspace_fragment>
```

### 7.3 `<Canvas>` writes inline styles, so the overlay cannot be a class

`position: relative`, `pointer-events: auto` and a 100% box go onto the
wrapper as inline styles, and a CSS module class loses to all three. Pass
`style` — which `<Canvas>` merges over its own defaults — rather than
`className`, or the canvas quietly sits *in* the layout taking clicks.

### 7.4 The flag is narrower than it sounds

`NEXT_PUBLIC_EMBERS=0` folds to `false` and the canvas is never rendered, so
the chunk is never fetched. Turbopack still **emits** it: a dynamic import
gets a chunk whether or not the branch reaching it survives folding. Measured,
not assumed — both builds came out byte-identical. Actually deleting the
232 kB means deleting the import.

### 7.5 Verifying it

Neither a screenshot nor `toDataURL` can prove a WebGL frame in a hidden pane —
see §5b for why there are no frames, and note additionally that a forced
composite only repaints dirty regions, so an untouched area screenshots black.
What does work is wrapping `drawArrays` and calling `readPixels` immediately
after the real call, while the buffer is still intact:

| | Idle | `produced` | `placed` |
|---|---|---|---|
| Lit pixels | **0** | 70 → 122 → 96 | 48 |
| Peak alpha | 0 | 255 → 93 → 59 | 255 |
| Mean RGB | — | (72, 49, 22) — orange | (32, 79, 81) — cyan |
| Box | — | x 536–563 → 520–581, rising 680 → 641 | x 358–388, y 412–417 |
| Anchor asked for | — | (548, 684) card bottom | (374, 417) dice row |

Every column checks out: the boxes sit on their anchors, the colours are the
two tokens and are not each other, the card burst visibly rises and spreads
while fading, and the HQ burst is six times wider than tall — the flat spray
it was asked for. The idle column is worth as much as the others: it proves
the on-demand loop really is asleep and the overlay really is transparent.

To watch the effect rather than measure it, divide `now()` by 8000 instead of
1000 for a run. Eight-times slow motion, identical shape, and a forced
composite can catch it.

# Heavy dice: rolling, dragging, and landing

The crew is the game. Everything else on the board is a way of spending them, so
the moment they hit the table is the moment the game is most physical — and
right now it is four coloured rounded rectangles appearing instantly.

Companion to [motion.md](motion.md), which owns the architecture this sits in
(one canvas, `frameloop="demand"`, the event bus, the DOM/3D layering ladder).
Everything here assumes that.

---

## 0. The constraint that decides the architecture

**Physics must never decide a face.** The engine already rolled:

```ts
// src/engine/rules.ts:1659 — inside applyMove, off the seeded RNG
face: (value + 1) as DieFace,
```

That number is in the state before anything is drawn, it is written to
`localStorage` on the same tick, it is replayable from the seed, and 330 tests
depend on it. A physics simulation that produced its own outcome would be a
second, disagreeing source of truth.

So the roll is not a roll. **It is a lie, told convincingly, about a number that
already exists.** Everything in §1 is in service of that.

And a roll is only one of six ways a face changes. The animation layer has to
answer all of them, and most are not throws at all:

| Move / effect | What the dice do | Animation |
|---|---|---|
| `rollDice` | all of them, at once | the throw (§1) |
| `rollExtraDie` | one white die arrives mid-round | a single throw into the tray |
| `rerollDice` | a chosen subset goes again | throw only those; the rest sit still |
| `setDie` (Foreman) | face chosen, never thrown | **no throw** — the die fades in showing it |
| `flipDie` | 5 becomes 2 | a 180° tumble in place, ~260 ms |
| `stepDie` | 3 becomes 4 | a 90° tip in place, ~200 ms |

`setDie` is the one that catches people out. `describeMove` already says *"Keep
these dice"* when the roll is a formality, and there is a legal path through the
game where a player never throws anything. A dice system that only knows how to
throw will have nothing to show.

---

## 1. The throw

### 1.1 Feeling heavy

Weight is not mass. Doubling a die's mass changes nothing about how it falls —
gravity scales with it. Four things actually read as brass:

| Property | Value | Why |
|---|---|---|
| **Gravity** | `[0, -45, 0]` | The real lever. At dice scale, earth gravity looks like styrofoam in slow motion; heavy things fall *fast* and stop *now*. Tune this before touching anything else. |
| `restitution` | `0.12` | Brass on a wooden tray barely bounces. Plastic is ~0.6, and that single number is most of what makes dice look cheap. |
| `friction` | `0.85` | It bites and stops, rather than skating. |
| `angularDamping` | `0.55` | Kills the long lazy spin that light objects do. |
| `linearDamping` | `0.15` | Slight air resistance; mostly helps it settle in time. |
| Collider | `RoundCuboidCollider`, radius ≈ 12% of half-extent | Real dice are chamfered, and the bevel completely changes how they tumble — a hard-edged cube catches and stops dead. This is worth more than it sounds. |

Two more things that are not physics at all:

- **Sound is about half of perceived weight.** A low thud plus a short metallic
  ring, pitch-randomised ±10%, will do more than any parameter above. Even one
  sample, retriggered, is transformative.
- **The tray has to be visibly solid.** Embers and dust on impact (§3.1) tell
  the player the table is hard.

### 1.2 The component

```tsx
// src/dice/DieBody.tsx
"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { RigidBody, RoundCuboidCollider, type RapierRigidBody } from "@react-three/rapier";
import { Quaternion, Vector3 } from "three";
import type { DieColor, DieFace } from "@/engine";
import { DIE_MATERIALS } from "./materials";

/** Half-extent of a die, in world units. One unit is one centimetre here. */
const HALF = 0.8;

export type DieHandle = {
  /** Throws it. The face it must show is decided; see settle(). */
  throwIn: (from: Vector3) => void;
  body: () => RapierRigidBody | null;
};

export function DieBody({
  face,
  color,
  ref,
}: {
  face: DieFace;
  color: DieColor;
  ref: Ref<DieHandle>;
}) {
  const body = useRef<RapierRigidBody>(null);

  useImperativeHandle(ref, () => ({
    body: () => body.current,
    throwIn(from: Vector3) {
      const rb = body.current;
      if (!rb) return;

      rb.setTranslation(from, true);
      // A random starting orientation, so the tumble does not begin from the
      // same pose every time — most of "organic" is here rather than in the
      // impulse.
      rb.setRotation(
        new Quaternion().setFromEuler(
          new (require("three").Euler)(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
          ),
        ),
        true,
      );
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);

      // Thrown inward and down, not dropped. The lateral component is what
      // makes it skitter and settle somewhere unpredictable.
      rb.applyImpulse(
        {
          x: (Math.random() - 0.5) * 5,
          y: -2 - Math.random() * 2,
          z: -3 - Math.random() * 3,
        },
        true,
      );
      // Torque is where the character is. Unequal on each axis, or it spins
      // like a coin instead of tumbling like a cube.
      rb.applyTorqueImpulse(
        {
          x: (Math.random() - 0.5) * 0.35,
          y: (Math.random() - 0.5) * 0.2,
          z: (Math.random() - 0.5) * 0.35,
        },
        true,
      );
    },
  }));

  return (
    <RigidBody
      ref={body}
      colliders={false}
      restitution={0.12}
      friction={0.85}
      linearDamping={0.15}
      angularDamping={0.55}
      // Fast + thin walls = tunnelling, which is what "bounced off the screen"
      // actually is. See §4.2.
      ccd
      canSleep
    >
      {/* Chamfered, like a real die. The bevel is why it tumbles instead of
          catching an edge and stopping dead. */}
      <RoundCuboidCollider args={[HALF * 0.88, HALF * 0.88, HALF * 0.88, HALF * 0.12]} />
      <mesh castShadow>
        <boxGeometry args={[HALF * 2, HALF * 2, HALF * 2]} />
        {/* Six materials, one per face — the arcane inscriptions. */}
        {DIE_MATERIALS[color].map((material, index) => (
          <primitive key={index} object={material} attach={`material-${index}`} />
        ))}
      </mesh>
    </RigidBody>
  );
}
```

### 1.3 Landing on the face the engine already rolled

Three ways, in the order I would actually reach for them.

**A — Free roll, then tip it. Recommended.**

Let the physics run honestly. As the die slows past a velocity threshold but
before it sleeps, check which face is up; if it is wrong, apply a small torque
impulse that tips it a quarter turn toward the right one. Repeat as it settles.
Because the die is still genuinely moving, the correction reads as the last
micro-settle rather than as a cheat.

```ts
// src/dice/faces.ts
import { Quaternion, Vector3 } from "three";
import type { DieFace } from "@/engine";

/**
 * Which way each face looks, in the die's own frame. Opposite faces sum to
 * seven, as they do on a real die, which is what makes the box texture layout
 * and this table agree.
 */
const NORMALS: Record<DieFace, Vector3> = {
  1: new Vector3(0, 1, 0),
  6: new Vector3(0, -1, 0),
  2: new Vector3(0, 0, 1),
  5: new Vector3(0, 0, -1),
  3: new Vector3(1, 0, 0),
  4: new Vector3(-1, 0, 0),
};

const UP = new Vector3(0, 1, 0);

/** Whichever face is pointing most nearly at the ceiling. */
export function upFace(rotation: Quaternion): DieFace {
  let best: DieFace = 1;
  let bestDot = -Infinity;
  for (const [face, normal] of Object.entries(NORMALS)) {
    const dot = normal.clone().applyQuaternion(rotation).dot(UP);
    if (dot > bestDot) {
      bestDot = dot;
      best = Number(face) as DieFace;
    }
  }
  return best;
}

/**
 * The shortest rotation that would bring `face` up, as an axis and an angle.
 * Used two ways: as a torque impulse while the die is still moving, and as a
 * hard correction if it runs out of time.
 */
export function tipToward(rotation: Quaternion, face: DieFace) {
  const normal = NORMALS[face].clone().applyQuaternion(rotation);
  const axis = new Vector3().crossVectors(normal, UP);
  const angle = Math.acos(Math.min(1, Math.max(-1, normal.dot(UP))));
  // Already up, or exactly upside down — in which case any horizontal axis
  // will do and the cross product gave us nothing usable.
  if (axis.lengthSq() < 1e-6) return { axis: new Vector3(1, 0, 0), angle };
  return { axis: axis.normalize(), angle };
}
```

```tsx
// inside the roller, in useFrame
const MOVING = 0.9;      // above this, leave it alone
const SETTLING = 0.25;   // below this, it is committing to a face
const DEADLINE_MS = 1800;

useFrame(() => {
  for (const die of dice) {
    const rb = die.handle.body();
    if (!rb || rb.isSleeping()) continue;

    const speed = Math.hypot(...Object.values(rb.linvel()));
    const spin = Math.hypot(...Object.values(rb.angvel()));
    if (speed > MOVING || spin > MOVING) continue;

    const rotation = new Quaternion().copy(rb.rotation() as Quaternion);
    if (upFace(rotation) === die.face) continue;

    const { axis, angle } = tipToward(rotation, die.face);
    if (speed < SETTLING && spin < SETTLING) {
      // Nudge, don't shove: just enough to tip it over one edge. Overdo this
      // and the die visibly jumps, which is the tell.
      rb.applyTorqueImpulse(axis.multiplyScalar(angle * 0.055), true);
    }
  }
});
```

And a hard floor under it, because a die balanced on a corner can take a very
long time and the engine already knows the answer:

```tsx
// If it has not converged by the deadline, stop asking nicely: slerp the
// remaining rotation over ~140ms while the die is essentially still. At that
// point the eye reads it as the final settle.
```

**B — Precomputed impulse table.** Search offline for initial conditions that
land each face, bucket a dozen per face, and pick one at random at runtime. It
is the best-looking option because nothing is corrected at all. The catch is
that it depends on Rapier being deterministic, and float behaviour across
browsers and CPUs is not something I would bet a visible game outcome on
without per-platform validation. Good as an optimisation over A, not as the
foundation.

**C — No physics engine at all.** Keyframe the tumble: a quaternion path with
two fake bounces, randomised Y-spin, landing on the face you were given. Three
variants × six faces is eighteen short clips and is genuinely hard to tell apart
from physics at dice scale. It always lands correctly, it is deterministic, it
is testable, and it costs **zero bytes**.

That last point matters more than it looks. `@react-three/rapier` carries a WASM
build of Rapier — call it ~400 kB gzipped on top of the ~200 kB from
[motion.md §0](motion.md). For six-sided dice whose outcome is already decided,
that is a lot of bytes to buy a tumble. **If I were choosing for this project I
would build C first**, measure whether anyone misses the physics, and keep A in
this document for when the answer is yes.

### 1.4 Performance

- **Sleep is the whole game.** Rapier auto-sleeps a settled body. Once every
  die is asleep, unmount the `<Physics>` tree entirely and hand off to the DOM
  (§2.1) — a stepped physics world with nothing moving in it still costs a
  broadphase pass per frame.
- **Pause when there is nothing to simulate.** `<Physics paused={!rolling}>`.
  Between rolls, which is most of the round, the simulation does not exist.
- **Fixed timestep** (`timeStep={1 / 60}`) rather than variable, so a frame
  hitch cannot throw a die through a wall.
- The canvas is already `frameloop="demand"` — during a roll, `invalidate()`
  every frame; when the last die sleeps, stop.
- Colliders: six dice, one floor, four walls. Put dice in their own collision
  group so they never test against anything else in the scene.
- `castShadow` on six dice with one light is fine. A shadow map per die is not.

---

## 2. Dragging: the crucial question

### 2.1 Drag in the DOM, not in 3D

**Recommendation: roll in 3D, hand off, drag in the DOM with Motion.** Not a
compromise — the right answer for this game specifically, for five reasons:

1. **The drop targets are DOM.** Headquarters sections and compound cards are
   laid out by CSS, contain text, and move when the window resizes. Dragging in
   3D means maintaining invisible proxy colliders that mirror a CSS layout, and
   re-deriving them on every reflow. That is the coordinate nightmare, and it is
   unforced.
2. **The legality model is already id-based.** `DieTargets` gives
   `sections: Map<HqSectionId, Move>` and `activations: Map<cardId, Move[]>` —
   sets of ids. DOM elements carry those ids. A raycast gives you a mesh, and
   you would have to map back.
3. **Accessibility.** Every die and slot today has a `title` and an
   `aria-label`, and the board is playable by clicking. A canvas has no
   keyboard path and no accessible name, and building one is a project.
4. **Hit-testing is one line in the DOM** (`document.elementFromPoint`) and a
   raycast plus a registry in 3D.
5. **Cost per pointermove.** A DOM drag is one compositor transform. A 3D drag
   is a raycast plus a React render, sixty times a second, while physics may
   still be awake.

The trick is that the player must never see the handoff.

```
roll in canvas ──► all bodies asleep ──► project each die to screen space
                                              │
                              DOM dice mount at exactly those coordinates,
                              opacity 0 ──► swap in one frame ──► canvas fades
                              out over 120ms ──► canvas unmounts
                                              │
                              DOM dice `layout`-animate into the tidy tray row
```

That last step is worth doing for its own sake: the dice scatter where they
land, then gather themselves into a neat row. Chaos resolving into order, and it
tells the player the roll is over and the spending has begun.

Projection is free, because the effects canvas already uses an orthographic
camera at `zoom: 1` where one world unit is one CSS pixel
([motion.md §1.3](motion.md)) — so a die's screen position is its world
position plus half the viewport. If the dice canvas uses a perspective camera
instead, `vector.project(camera)` and scale by half the viewport.

### 2.2 The draggable die

```tsx
// src/components/DraggableDie.tsx
"use client";

import { useRef } from "react";
import { m, useMotionValue, useSpring, useTransform, useVelocity } from "motion/react";
import type { Die } from "@/engine";
import { DIE_SWATCHES } from "@/lib/colors";
import styles from "./game.module.css";

export function DraggableDie({
  die,
  movable,
  bounds,
  onPick,
  onMove,
  onRelease,
}: {
  die: Die;
  movable: boolean;
  /** The board area, so a die cannot be thrown into the log. */
  bounds: React.RefObject<HTMLElement | null>;
  onPick: () => void;
  onMove: (point: { x: number; y: number }) => void;
  onRelease: () => void;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Heavy things lag and lean. `drag` writes x and y itself, so unlike a
  // layout animation these *are* MotionValues we own — which means real
  // velocity is available, and the die can tilt into its own motion.
  const vx = useVelocity(x);
  const lean = useSpring(useTransform(vx, [-1800, 0, 1800], [-14, 0, 14]), {
    stiffness: 260,
    damping: 26,
  });

  return (
    <m.span
      className={styles.die}
      style={{ ...DIE_SWATCHES[die.color], x, y, rotate: lean }}
      drag={movable}
      dragConstraints={bounds}
      // Low, because brass is not rubber. 0.5 feels like a balloon on a string.
      dragElastic={0.12}
      dragMomentum={false}
      dragSnapToOrigin
      dragTransition={{ bounceStiffness: 620, bounceDamping: 42 }}
      onDragStart={onPick}
      onDrag={(_, info) => onMove(info.point)}
      onDragEnd={onRelease}
      whileDrag={{
        scale: 1.18,
        zIndex: 50,
        boxShadow: "var(--shadow-glow-aether)",
        cursor: "grabbing",
      }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      title={`${die.color} ${die.face}`}
    >
      {die.face}
    </m.span>
  );
}
```

`dragSnapToOrigin` matters: a die dropped on nothing should go back to the tray
under spring, not stay where it was abandoned. The tray is where dice live.

### 2.3 Magnetism, without fighting the drag

The instinct is to pull the die toward the slot. Resist it — `drag` owns `x`
and `y`, and anything else writing to them produces a tug-of-war the player
feels as stickiness.

**Two moves instead.**

*First, the slot reaches out.* Most of the perceived magnetism is here, and it
costs nothing:

```tsx
<m.span
  className={styles.hqSlot}
  animate={
    near
      ? { scale: 1.22, borderColor: "var(--color-aether-400)", opacity: 1 }
      : { scale: 1, borderColor: "var(--color-edge)", opacity: 0.35 }
  }
  transition={{ type: "spring", stiffness: 500, damping: 26 }}
/>
```

*Second, the die leans in — on the inner layer.* Same two-element separation as
the card tilt in [motion.md §4.1](motion.md): the outer element is dragged, the
inner one is magnetised, and they never write to the same transform.

```tsx
// outer: drag owns x / y
<m.span drag ... >
  {/* inner: the magnet owns this offset, in the outer's local space */}
  <m.span animate={{ x: pull.x, y: pull.y }}
          transition={{ type: "spring", stiffness: 700, damping: 30 }}>
    {die.face}
  </m.span>
</m.span>
```

Finding the target, from the `onDrag` point — legality first, distance second,
so a die is never magnetised to a slot that would refuse it:

```ts
const SNAP_RADIUS = 72;

/** The nearest slot this die could legally fill, if one is close enough. */
function nearestTarget(point: { x: number; y: number }, legal: ReadonlySet<string>) {
  let best: { id: string; dx: number; dy: number; d: number } | null = null;

  for (const id of legal) {
    const el = document.querySelector(`[data-slot-id="${id}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - point.x;
    const dy = r.top + r.height / 2 - point.y;
    const d = Math.hypot(dx, dy);
    if (d < SNAP_RADIUS && (!best || d < best.d)) best = { id, dx, dy, d };
  }
  return best;
}

// The pull eases in over the radius, so the die drifts rather than jumping.
const pull = target
  ? { x: target.dx * 0.35 * (1 - target.d / SNAP_RADIUS),
      y: target.dy * 0.35 * (1 - target.d / SNAP_RADIUS) }
  : { x: 0, y: 0 };
```

On release with a target, do **not** animate the die into the socket and then
swap it. Play the move immediately and let the socket's own arrival animation
carry it — the board is the source of truth, and a die animating into a slot
that the engine has not agreed to fill is a lie waiting to be caught.

This replaces the HTML5 drag-and-drop in `PlayerPanel` — `draggable`,
`onDragStart`, `dataTransfer`. The two gesture systems do not compose, and
HTML5 drag-and-drop does not work on touch at all, so this is the change that
makes the game playable on a phone.

---

## 3. Landing: snap, charge, trigger

~900 ms end to end, and it should be interruptible — a player who is already
dragging the next die must not be made to wait.

### 3.1 The Snap (0–180 ms)

| At | What |
|---|---|
| 0 | Socket scales `1.22 → 0.94 → 1` on a stiff spring. The impact is the socket giving, not the die. |
| 0 | A ring expands out of the socket and dies: `scale 1 → 2.1`, `opacity 0.9 → 0`, 280 ms. |
| 20 | Dust, not embers — 10–14 particles, `--color-parchment-dim`, low speed, wide cone, short life. Brass on a table throws grit. |
| 30 | **No screen shake.** Dice land several times a round. Shake is for Megaliths and for the ending ([motion.md §5.4](motion.md)). |
| 0–180 | The die's own `rotate` returns to 0 and its glow crossfades aether → spice: it has stopped being a thing you are holding and become a thing that is committed. |

### 3.2 The Charge (180–520 ms)

The inscriptions light. If the die is a DOM element by now — and after the
handoff it is — this is a CSS mask animation, not 3D:

```css
.dieRunes {
  background: linear-gradient(120deg, transparent 40%, var(--color-aether-400) 50%, transparent 60%);
  background-size: 300% 100%;
  /* The glyphs are the mask, so the sweep only shows where the engraving is. */
  mask-image: var(--rune-mask);
  animation: charge 340ms ease-out forwards;
}

@keyframes charge {
  from { background-position: 120% 0; opacity: 0; }
  40%  { opacity: 1; }
  to   { background-position: -60% 0; opacity: 0.9; }
}
```

Then the energy leaves the die for the factory: the trajectory line from §3.4,
reversed and fired along its own path in ~180 ms, arriving at the card's
nameplate.

### 3.3 The Trigger (520–900 ms)

This is the production sequence already specified in
[motion.md §2.2](motion.md) — anticipation, release, embers, the rolling number
in the resource bar — fired by the `produced` event from
[`lib/events.ts`](../src/lib/events.ts). It already exists. The charge in §3.2
is just the fuse.

Sequencing them means the die landing and the factory firing are one continuous
gesture rather than two unrelated animations that happen to be adjacent.

### 3.4 The trajectory line

One SVG path over the whole board, driven by MotionValues. SVG rather than
canvas because it is a single path and CSS can animate the dashes; canvas
because of one line would mean another render loop.

```tsx
// src/components/DragTrajectory.tsx
"use client";

import { m, useMotionTemplate, useSpring, type MotionValue } from "motion/react";

export function DragTrajectory({
  from,
  to,
  live,
}: {
  from: { x: MotionValue<number>; y: MotionValue<number> };
  /** Centre of the slot being aimed at, or null when nothing is in range. */
  to: { x: number; y: number } | null;
  live: boolean;
}) {
  // Sprung, so the far end catches up rather than snapping between slots.
  const tx = useSpring(to?.x ?? 0, { stiffness: 400, damping: 30 });
  const ty = useSpring(to?.y ?? 0, { stiffness: 400, damping: 30 });

  // A quadratic curve with the control point lifted, so it arcs like a field
  // line. A straight line reads as a ruler, which is the wrong idea entirely.
  const d = useMotionTemplate`M ${from.x} ${from.y} Q ${tx} ${from.y} ${tx} ${ty}`;

  return (
    <svg className="pointer-events-none fixed inset-0 z-30 h-full w-full" aria-hidden>
      <m.path
        d={d}
        fill="none"
        stroke="var(--color-aether-400)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="2 10"
        initial={{ opacity: 0 }}
        animate={{ opacity: live && to ? 0.85 : 0 }}
        transition={{ duration: 0.14 }}
        // Energy flowing toward the slot. Negative, so it runs the right way.
        style={{ animation: "flow 600ms linear infinite" }}
      />
      {/* A bloom at the aiming end, so the line has somewhere to arrive. */}
      <m.circle
        cx={tx}
        cy={ty}
        r={6}
        fill="var(--color-aether-400)"
        animate={{ opacity: live && to ? 0.5 : 0, r: live && to ? 9 : 6 }}
        transition={{ duration: 0.2, repeat: Infinity, repeatType: "reverse" }}
      />
    </svg>
  );
}
```

```css
@keyframes flow {
  to { stroke-dashoffset: -24; }
}

@media (prefers-reduced-motion: reduce) {
  /* The line still shows where the die will land; it just stops travelling. */
  [data-trajectory] { animation: none !important; }
}
```

Two notes. `stroke-dashoffset` is not compositor-accelerated, so keep it to this
one path. And the line should only ever point at a **legal** target — a
trajectory to a slot that will refuse the die is worse than no trajectory, and
`DieTargets` already knows the difference.

---

## 4. Edge cases

### 4.1 Rolling several at once

Everything that goes wrong with multiple dice goes wrong in the first frame.

- **Stagger the spawns in time, not just in space.** 60–90 ms apart. Nearly all
  interpenetration comes from bodies created overlapping on the same tick, and
  no solver recovers from that gracefully — it explodes them apart, which is
  exactly the "bouncing off the screen" failure.
- **Spawn on an arc above the tray**, one die per station, with small jitter,
  so the initial positions cannot collide even if the stagger is lost.
- **Vary the impulse per die.** Identical impulses produce synchronised dice,
  which looks scripted even though it is fully simulated.
- **Six is the practical ceiling** — workforce plus white extras. Size the tray
  for six at rest with room to spare; dice that have nowhere to settle keep
  nudging each other and never sleep.

### 4.2 Dice escaping the tray

The classic, and it is always one of two causes.

**Tunnelling.** A fast body and a thin wall, and in one step the die is on the
other side. Three fixes, all of them: `ccd` on the dice, walls at least as
thick as a die is wide (they are invisible, so make them 3 units), and a fixed
timestep so a frame hitch cannot produce a huge step.

**Explosive recovery** from an overlap at spawn — see §4.1.

Then a safety net, because neither fix is a proof:

```ts
// Anything outside the tray has escaped, however it managed it. Put it back
// rather than letting the player watch a die leave the board: the face is
// already decided, so nothing about the game is affected.
useFrame(() => {
  for (const die of dice) {
    const rb = die.handle.body();
    if (!rb) continue;
    const p = rb.translation();
    if (Math.abs(p.x) > TRAY_X || Math.abs(p.z) > TRAY_Z || p.y < -8) {
      die.handle.throwIn(new Vector3(0, 9, 0));
    }
  }
});
```

### 4.3 The rest of them

- **A die that never sleeps** — balanced on a corner, or shuffling against
  another die. The `DEADLINE_MS` hard settle in §1.3 covers it. Never let the
  UI wait on physics converging.
- **Re-roll mid-round.** `rerollDice` takes a subset. Wake and re-throw only
  those; the others must not so much as twitch, or the player will think their
  faces changed too.
- **Tab hidden during a roll.** `requestAnimationFrame` stops, then resumes with
  a huge delta. On `visibilitychange`, skip straight to the settled state — the
  faces are already known, so there is nothing to lose.
- **Reduced motion.** No throw at all. The dice fade in showing their faces,
  which is exactly the `setDie` path from §0, already built.
- **A resize mid-drag.** `dragConstraints` is measured on drag start. Motion
  re-measures on `layout` changes, but a resize during a drag is worth just
  cancelling the drag over — `dragSnapToOrigin` sends the die home and nothing
  is lost.

---

## 5. Order to build it in

1. **`setDie` and `flipDie` first.** No physics, no canvas, no new
   dependencies — a die that tumbles 180° in place when the Gymnasium flips it.
   It proves the die is an animated object and makes six ways of changing a face
   into one component.
2. **Motion drag** (§2.2), replacing HTML5 drag-and-drop. This fixes touch,
   which is a real bug, not polish.
3. **Magnetism and the trajectory line** (§2.3, §3.4). Pure DOM and SVG. At
   this point the core mechanic already feels good and nothing 3D exists yet.
4. **The landing sequence** (§3), wired to the `produced` event that
   `lib/events.ts` already emits.
5. **Method C tumble** (§1.3) — keyframed, no engine. Measure whether anyone
   asks for more.
6. **Rapier, if they do** (§1.1–1.4), behind a dynamic import and a flag, with
   the handoff in §2.1.

Steps 1–4 are the mechanic. Steps 5–6 are the spectacle, and the order is
deliberate: the game should feel good to play before it costs 600 kB.

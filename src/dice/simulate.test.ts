import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Euler, Quaternion } from "three";
import { DIE_FACES, type DieFace } from "@/engine";
import { steerToward, upFace } from "./faces";
import {
  BEVEL,
  BODY,
  DEADLINE_MS,
  GRAVITY,
  HALF,
  STEER_CAP,
  TIME_STEP,
  TRAY,
  throwFor,
} from "./throw";

/**
 * The simulation, run without a canvas.
 *
 * Everything else about the physics dice is a matter of taste and cannot be
 * argued with in a test — but three things about them are simply true or not:
 * a die must stay in the tray, it must stop in the time the board is prepared
 * to wait, and it must come to rest showing the face the engine already rolled.
 * Those are the ones that ruin a game when they are wrong, and Rapier is the
 * same solver here as in the browser, so they can be checked on the way past.
 *
 * This is also where the numbers in `throw.ts` were tuned. Not by eye, which
 * was not available, but by asking the solver whether the tray holds.
 */

/** How the board sees a settled die: barely moving, one way or another. */
const AT_REST = 0.6;

type Settled = {
  readonly face: DieFace;
  readonly position: { x: number; y: number; z: number };
  readonly steps: number;
  readonly asleep: boolean;
  /** Whether it came to rest on the owed face without the deadline stepping in. */
  readonly corrected: boolean;
  /** The most the correction ever turned it in one step, in degrees: the tell. */
  readonly worstTurn: number;
};

function tray(world: RAPIER.World): void {
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(TRAY.x + TRAY.wall, 1, TRAY.z + TRAY.wall)
      .setRestitution(BODY.restitution)
      .setFriction(BODY.friction),
    floor,
  );

  // Thick, because they are invisible and a thin wall is a wall a fast die
  // goes through in one step. See docs/dice.md §4.2.
  const walls: [number, number, number, number, number, number][] = [
    [TRAY.x + TRAY.wall, 0, 0, TRAY.wall, TRAY.height, TRAY.z + TRAY.wall],
    [-TRAY.x - TRAY.wall, 0, 0, TRAY.wall, TRAY.height, TRAY.z + TRAY.wall],
    [0, 0, TRAY.z + TRAY.wall, TRAY.x + TRAY.wall, TRAY.height, TRAY.wall],
    [0, 0, -TRAY.z - TRAY.wall, TRAY.x + TRAY.wall, TRAY.height, TRAY.wall],
  ];
  for (const [x, y, z, hx, hy, hz] of walls) {
    const wall = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setRestitution(BODY.restitution)
        .setFriction(BODY.friction),
      wall,
    );
  }
}

function die(world: RAPIER.World, dieId: string, index: number, count: number) {
  const thrown = throwFor(dieId, index, count);
  const pose = new Quaternion().setFromEuler(
    new Euler(thrown.spin.x, thrown.spin.y, thrown.spin.z),
  );

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(thrown.from.x, thrown.from.y, thrown.from.z)
      .setRotation({ x: pose.x, y: pose.y, z: pose.z, w: pose.w })
      .setLinearDamping(BODY.linearDamping)
      .setAngularDamping(BODY.angularDamping)
      .setCcdEnabled(true),
  );
  world.createCollider(
    RAPIER.ColliderDesc.roundCuboid(
      HALF * (1 - BEVEL),
      HALF * (1 - BEVEL),
      HALF * (1 - BEVEL),
      HALF * BEVEL,
    )
      .setRestitution(BODY.restitution)
      .setFriction(BODY.friction),
    body,
  );

  body.applyImpulse(thrown.impulse, true);
  body.applyTorqueImpulse(thrown.torque, true);
  return body;
}

/** Throws one die at a face and runs it until it stops or time runs out. */
function roll(dieId: string, face: DieFace, index = 0, count = 1): Settled {
  const world = new RAPIER.World(GRAVITY);
  world.timestep = TIME_STEP;
  tray(world);
  const body = die(world, dieId, index, count);

  const limit = Math.ceil(DEADLINE_MS / 1000 / TIME_STEP);
  let steps = 0;
  let corrected = false;
  let worstTurn = 0;

  for (; steps < limit; steps++) {
    world.step();

    const linear = body.linvel();
    const angular = body.angvel();
    const speed = Math.hypot(linear.x, linear.y, linear.z);
    const spin = Math.hypot(angular.x, angular.y, angular.z);
    const rotation = new Quaternion().copy(body.rotation() as Quaternion);

    const steered = steerToward(rotation, face, Math.max(speed, spin));
    if (steered) {
      worstTurn = Math.max(worstTurn, (rotation.angleTo(steered) * 180) / Math.PI);
      body.setRotation({ x: steered.x, y: steered.y, z: steered.z, w: steered.w }, true);
    }

    if (body.isSleeping()) break;
    if (speed < AT_REST && spin < AT_REST && upFace(rotation) === face) {
      corrected = true;
      // Settled, and settled on the right number: there is nothing left for
      // the deadline to fix.
      break;
    }
  }

  const rotation = new Quaternion().copy(body.rotation() as Quaternion);
  const position = body.translation();
  return {
    face: upFace(rotation),
    position,
    steps,
    asleep: body.isSleeping(),
    corrected,
    worstTurn,
  };
}

/** One of every face, several times over, from ids no two of which match. */
function everyThrow(): { id: string; face: DieFace; settled: Settled }[] {
  const rolls = [];
  for (const face of DIE_FACES) {
    for (let take = 0; take < 4; take++) {
      const id = `p0-r1-${face}-${take}`;
      rolls.push({ id, face, settled: roll(id, face) });
    }
  }
  return rolls;
}

describe("a die thrown into the tray", () => {
  beforeAll(async () => {
    // The WASM is base64 into the bundle, so there is nothing to fetch and
    // this works the same here as it does in a browser.
    await RAPIER.init();
  });

  it("stays in the tray", () => {
    // The classic failure, and the one a player actually notices: a die that
    // leaves the board. Either it tunnelled through a wall or the solver blew
    // two overlapping bodies apart — see docs/dice.md §4.2.
    for (const { id, settled } of everyThrow()) {
      expect(Math.abs(settled.position.x), `${id} in x`).toBeLessThan(TRAY.x);
      expect(Math.abs(settled.position.z), `${id} in z`).toBeLessThan(TRAY.z);
      expect(settled.position.y, `${id} above the floor`).toBeGreaterThan(-HALF);
    }
  });

  it("mostly settles long before the board stops waiting", () => {
    /*
     * Not every die: one balanced on a corner can take very nearly for ever,
     * which is what the deadline is for. What matters is that the deadline is
     * the exception rather than the mechanism — if the typical throw were
     * running to the end of it, every roll would take as long as the worst one
     * and the board would be waiting on physics, which docs/dice.md §4.3 is
     * clear it must never do.
     */
    const limit = Math.ceil(DEADLINE_MS / 1000 / TIME_STEP);
    const taken = everyThrow()
      .map(({ settled }) => settled.steps)
      .sort((a, b) => a - b);
    const median = taken[Math.floor(taken.length / 2)];

    // Measured at 94 steps, which is a roll of about a second and a half
    // against a deadline of two and a fifth.
    expect(median).toBeLessThan(limit * 0.8);
    expect(taken.filter((steps) => steps < limit).length / taken.length).toBeGreaterThan(0.8);
    // ...and the wait is bounded whatever happens, because the loop is.
    expect(taken.at(-1)).toBeLessThanOrEqual(limit);
  });

  it("comes to rest showing the face the engine rolled", () => {
    // The one that matters. The board wrote this number to storage before the
    // canvas existed; a die showing anything else is the game contradicting
    // itself in front of the player.
    for (const { id, face, settled } of everyThrow()) {
      expect(settled.face, `${id} landed on ${settled.face}, owed ${face}`).toBe(face);
    }
  });

  it("gets there by being steered rather than by being put there", () => {
    // The hard correction at the deadline is a backstop, not the mechanism. If
    // most throws needed it, every landing would be a slerp onto a die that
    // had already stopped, which is the one thing a player would see.
    const rolls = everyThrow();
    const steered = rolls.filter(({ settled }) => settled.corrected).length;

    expect(steered / rolls.length).toBeGreaterThan(0.8);
  });

  it("never turns the die further in a step than the tumble already is", () => {
    // The tell, measured. Six degrees a frame is 360 a second, hidden inside a
    // die that is still rolling; the moment it is more than that, the player
    // is watching the board correct itself.
    for (const { id, settled } of everyThrow()) {
      expect(settled.worstTurn, `${id} turned`).toBeLessThanOrEqual(STEER_CAP + 0.01);
    }
  });

  it("throws a handful without exploding them apart", () => {
    const world = new RAPIER.World(GRAVITY);
    world.timestep = TIME_STEP;
    tray(world);
    // All six at once and on the same tick, which is the worst case the
    // spawn stagger exists to avoid: if it holds here it holds staggered.
    const bodies = [0, 1, 2, 3, 4, 5].map((index) => die(world, `p0-r1-${index}`, index, 6));

    for (let step = 0; step < 240; step++) world.step();

    for (const [index, body] of bodies.entries()) {
      const at = body.translation();
      expect(Math.abs(at.x), `die ${index} in x`).toBeLessThan(TRAY.x);
      expect(Math.abs(at.z), `die ${index} in z`).toBeLessThan(TRAY.z);
    }
  });
});

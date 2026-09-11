"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, Color, type BufferGeometry, type ShaderMaterial } from "three";
import { onBurst } from "./bus";
import { toWorld } from "./screen";

/**
 * Every ember in the game, at once. Sized for the worst case — a big run
 * paying out while a perk resolves — and then left alone: the pool is
 * allocated once and written as a ring, so nothing allocates mid-game and
 * there is no garbage for the collector to find between frames. The oldest
 * ember loses its slot, which at this size cannot happen while it is still
 * visible.
 */
const POOL = 768;

/** Every buffer that an emit writes, for the re-upload. */
const ATTRIBUTES = ["position", "aVelocity", "aColor", "aBirth", "aLife", "aSize"] as const;

/**
 * The clock both the emitter and the shader read.
 *
 * Deliberately not three's `clock`. With `frameloop="demand"` the loop is
 * stopped for most of a turn, and `clock.elapsedTime` only moves when a frame
 * renders — so a burst emitted after ten idle seconds would stamp a birth ten
 * seconds in the past and be dead before its first frame. Which is to say: it
 * would work perfectly in dev, with something always animating, and never once
 * on a real turn. Wall time has no such gap.
 *
 * Already relative to the page opening, so it needs no epoch of its own: a
 * float32 holds it to within a couple of milliseconds after eight hours, and
 * an ember lives for half a second.
 */
function now(): number {
  return performance.now() / 1000;
}

/**
 * The simulation, such as it is, lives here.
 *
 * The CPU writes a particle's initial conditions once and then never touches
 * it again; a single `uTime` uniform advances and every position falls out of
 * it. There is no per-frame particle loop anywhere in this file, which is why
 * 768 embers and 8000 embers cost the main thread the same.
 */
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

    // Unborn or dead: collapse to a point outside the frustum. The pool keeps
    // its size and the slot costs one discarded vertex.
    if (t < 0.0 || t > 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      return;
    }

    // Ballistic with drag, integrated in closed form so that position is a
    // pure function of age rather than something that has to be stepped.
    float drag = (1.0 - exp(-2.2 * age)) / 2.2;
    vec3 p = position + aVelocity * drag;
    p.y -= 120.0 * age * age;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);

    // Small and hot at birth, swelling as it cools and fades. Point size is in
    // device pixels, so the ratio keeps an ember the same size on screen
    // whatever the display.
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

    // three's colour management hands us linear values, and the framebuffer
    // wants the output colour space. A material built from three's own shader
    // chunks gets this for free; a hand-written one has to ask, and without it
    // every ember comes out muddy and too dark.
    #include <colorspace_fragment>
  }
`;

export function Embers() {
  const material = useRef<ShaderMaterial>(null);
  const geometry = useRef<BufferGeometry>(null);
  /** Next slot to overwrite. */
  const cursor = useRef(0);
  /** When the last live ember dies. Until then, keep asking for frames. */
  const deadline = useRef(0);

  const invalidate = useThree((state) => state.invalidate);
  const size = useThree((state) => state.size);

  const buffers = useMemo(
    () => ({
      position: new Float32Array(POOL * 3),
      aVelocity: new Float32Array(POOL * 3),
      aColor: new Float32Array(POOL * 3),
      // Far enough in the past that every slot starts dead.
      aBirth: new Float32Array(POOL).fill(-1e3),
      aLife: new Float32Array(POOL).fill(1),
      aSize: new Float32Array(POOL).fill(6),
    }),
    [],
  );

  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uPixelRatio: { value: 1 } }), []);

  useEffect(() => {
    const scratch = new Color();

    return onBurst(({ x, y, count = 16, color = "#ff8a3d", spread = 0.6, speed = 190 }) => {
      const geo = geometry.current;
      if (!geo) return;

      const [wx, wy] = toWorld(x, y, size.width, size.height);
      const born = now();
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
        buffers.aBirth[i] = born;
        buffers.aLife[i] = life;
        buffers.aSize[i] = 3 + Math.random() * 5;

        deadline.current = Math.max(deadline.current, born + life);
      }

      for (const name of ATTRIBUTES) geo.getAttribute(name).needsUpdate = true;

      // `frameloop` is "demand", so the loop is asleep and has to be woken.
      invalidate();
    });
  }, [buffers, invalidate, size.height, size.width]);

  useFrame(({ viewport }) => {
    const shader = material.current;
    if (!shader) return;

    const time = now();
    shader.uniforms.uTime.value = time;
    shader.uniforms.uPixelRatio.value = viewport.dpr;

    // Self-sustaining while anything is alive, and silent the moment nothing
    // is. This is what makes an idle board cost zero.
    if (time < deadline.current) invalidate();
  });

  return (
    // Nothing here is ever inside the camera's idea of its own bounds — the
    // positions are written after the geometry is built — so culling it by
    // them would cull all of it.
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
        // whole reason this reads as heat.
        blending={AdditiveBlending}
        // Nothing occludes anything; sorting additive sprites is wasted work.
        depthWrite={false}
        depthTest={false}
      />
    </points>
  );
}

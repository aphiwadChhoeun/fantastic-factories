import { CanvasTexture, MeshStandardMaterial, SRGBColorSpace } from "three";
import { DIE_FACES, type DieColor, type DieFace } from "@/engine";
import { DIE_SWATCHES } from "@/lib/colors";

/**
 * The six faces of a die, in the colour that die is.
 *
 * Numerals rather than pips, because the rest of the board shows numerals: a
 * die that reads 4 in the tray and four dots in the air is two different dice.
 * Drawn to a canvas rather than loaded, so there is no image to fetch, nothing
 * to go missing, and the colours come from the same swatches the DOM uses —
 * which is what keeps the handoff in §2.1 from being a visible costume change.
 *
 * Cached per colour. Six materials and six textures per player, made once and
 * kept for the life of the page; a material per die per roll would be a new
 * texture upload every time anyone rolled.
 */

/** Big enough to stay crisp on a die filling a fifth of the screen. */
const FACE_PX = 128;

const cache = new Map<DieColor, MeshStandardMaterial[]>();

function faceTexture(face: DieFace, color: DieColor): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = FACE_PX;
  canvas.height = FACE_PX;
  const draw = canvas.getContext("2d");
  /*
   * The swatches are typed as CSS properties, where every value is optional
   * and a length may be a number. Read as text with the same fallbacks the
   * DOM would land on, so a die is never drawn with `undefined` for a colour.
   */
  const swatch = DIE_SWATCHES[color];
  const fill = String(swatch.background ?? "#888");
  const ink = String(swatch.color ?? "#fff");
  const edge = String(swatch.borderColor ?? fill);

  if (draw) {
    draw.fillStyle = fill;
    draw.fillRect(0, 0, FACE_PX, FACE_PX);

    // The same inset highlight the DOM die wears along its top edge.
    draw.fillStyle = "rgba(255, 255, 255, 0.18)";
    draw.fillRect(0, 0, FACE_PX, 3);

    draw.strokeStyle = edge;
    draw.lineWidth = 4;
    draw.strokeRect(2, 2, FACE_PX - 4, FACE_PX - 4);

    draw.fillStyle = ink;
    draw.font = `500 ${FACE_PX * 0.56}px ui-sans-serif, system-ui, sans-serif`;
    draw.textAlign = "center";
    draw.textBaseline = "middle";
    // Nudged, because a numeral's optical centre is not its bounding box's.
    draw.fillText(String(face), FACE_PX / 2, FACE_PX / 2 + FACE_PX * 0.03);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Six materials in the order `BoxGeometry` wants them: +X, -X, +Y, -Y, +Z, -Z.
 *
 * Which face goes where is not free choice — it has to agree with `NORMALS` in
 * `faces.ts`, or the number the correction brings up is not the number the
 * player reads. Opposite faces sum to seven, as they do on a real die.
 */
const FACE_ORDER: readonly DieFace[] = [3, 4, 1, 6, 2, 5];

export function materialsFor(color: DieColor): MeshStandardMaterial[] {
  const made = cache.get(color);
  if (made) return made;

  const materials = FACE_ORDER.map(
    (face) =>
      new MeshStandardMaterial({
        map: faceTexture(face, color),
        // Brass, not plastic: a tight highlight over a fairly dark body.
        roughness: 0.42,
        metalness: 0.25,
      }),
  );
  cache.set(color, materials);
  return materials;
}

/** Every face is accounted for exactly once, which is worth saying out loud. */
export const FACES_PLACED = DIE_FACES.every((face) => FACE_ORDER.includes(face));

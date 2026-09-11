import { describe, expect, it, vi } from "vitest";
import { emitBurst, onBurst, type Burst } from "./bus";

const SPARKS: Burst = { x: 10, y: 20 };

describe("the burst bus", () => {
  it("drops a burst when nothing is listening", () => {
    // The whole point: the board can emit before the canvas has loaded, or
    // when it is switched off entirely, and never has to check.
    expect(() => emitBurst(SPARKS)).not.toThrow();
  });

  it("hands the burst to a listener", () => {
    const heard = vi.fn();
    const off = onBurst(heard);

    emitBurst(SPARKS);

    expect(heard).toHaveBeenCalledExactlyOnceWith(SPARKS);
    off();
  });

  it("hands it to every listener", () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = onBurst(first);
    const offSecond = onBurst(second);

    emitBurst(SPARKS);

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    offFirst();
    offSecond();
  });

  it("stops once unsubscribed", () => {
    const heard = vi.fn();
    onBurst(heard)();

    emitBurst(SPARKS);

    expect(heard).not.toHaveBeenCalled();
  });

  it("still reaches the others when one unsubscribes mid-delivery", () => {
    // A canvas unmounting on the same tick as a burst. Iterating the live set
    // would be fine for a deletion and not for an insertion; this pins the
    // behaviour either way.
    const later = vi.fn();
    const offLater = onBurst(later);
    const offFirst = onBurst(() => {
      offFirst();
      offLater();
    });

    emitBurst(SPARKS);

    expect(later).toHaveBeenCalledOnce();
    offLater();
  });
});

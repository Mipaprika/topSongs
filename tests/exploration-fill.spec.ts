import { describe, expect, it } from "vitest";

import { fillWithExploration } from "../src/recommendation/exploration";

describe("fillWithExploration", () => {
  it("fills to limit with exploration pool when candidates不足", () => {
    const filled = fillWithExploration(["s1"], ["e1", "e2", "e3"], 3);
    expect(filled).toEqual(["s1", "e1", "e2"]);
  });
});

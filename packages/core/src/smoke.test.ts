import { describe, expect, it } from "vitest";

describe("core smoke", () => {
  it("runs in the Node environment", () => {
    expect("document" in globalThis).toBe(false);
  });
});

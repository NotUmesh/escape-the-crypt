import { describe, expect, it } from "vitest";

describe("worker smoke", () => {
  it("runs in the Node environment", () => {
    expect("document" in globalThis).toBe(false);
  });
});

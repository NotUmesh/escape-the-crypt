import { describe, expect, it } from "vitest";

describe("web smoke", () => {
  it("runs in the jsdom environment", () => {
    expect(typeof document).toBe("object");
    expect(document.createElement("div").tagName).toBe("DIV");
  });
});

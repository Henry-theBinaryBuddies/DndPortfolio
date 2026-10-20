import { describe, expect, it } from "vitest";
import { sourceLabel } from "./sourceLabel";

describe("sourceLabel", () => {
  it("has no label for library monsters", () => {
    expect(sourceLabel({ source: "srd", validated: true })).toBeNull();
    expect(sourceLabel({ source: "curated", validated: true })).toBeNull();
  });

  it("labels generated and reskinned monsters, noting when they are unchecked", () => {
    expect(sourceLabel({ source: "ai", validated: false })).toBe("Generated, unvalidated");
    expect(sourceLabel({ source: "reskin", validated: false })).toBe("Reskin, unvalidated");
    expect(sourceLabel({ source: "ai", validated: true })).toBe("Generated");
  });
});

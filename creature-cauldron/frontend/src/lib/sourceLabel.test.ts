import { describe, expect, it } from "vitest";
import { SOURCES, SOURCE_NAMES, sourceLabel } from "./sourceLabel";

describe("sourceLabel", () => {
  it("has no label for library monsters", () => {
    expect(sourceLabel({ source: "srd", validated: true })).toBeNull();
    expect(sourceLabel({ source: "curated", validated: true })).toBeNull();
  });

  it("labels A5E monsters, which are library monsters but not 2014 ones", () => {
    expect(sourceLabel({ source: "a5e", validated: true })).toBe("A5E");
  });

  it("names every source for the filter", () => {
    expect([...SOURCES]).toEqual(["srd", "a5e", "curated", "ai", "reskin"]);
    expect(SOURCES.map((s) => SOURCE_NAMES[s])).toEqual(["SRD 5.1", "A5E", "Curated samples", "Generated", "Reskin"]);
  });

  it("labels generated and reskinned monsters, noting when they are unchecked", () => {
    expect(sourceLabel({ source: "ai", validated: false })).toBe("Generated, unvalidated");
    expect(sourceLabel({ source: "reskin", validated: false })).toBe("Reskin, unvalidated");
    expect(sourceLabel({ source: "ai", validated: true })).toBe("Generated");
  });
});

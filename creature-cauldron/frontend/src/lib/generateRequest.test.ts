import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS } from "./filters";
import { buildGenerateRequest, describeRequest, fewResultsPrompt } from "./generateRequest";

describe("buildGenerateRequest", () => {
  it("copies the filters when there is no difficulty pick", () => {
    const { request, problem } = buildGenerateRequest({ ...EMPTY_FILTERS, types: ["undead"], crMin: 2 }, null);
    expect(problem).toBeNull();
    expect(request).toMatchObject({ types: ["undead"], crMin: 2, crMax: null });
  });

  it("turns a difficulty band into a CR range", () => {
    const { request } = buildGenerateRequest(EMPTY_FILTERS, { min: 700, max: 1800 });
    expect(request).toMatchObject({ crMin: 3, crMax: 4 });
  });

  it("narrows the band with a CR filter that overlaps it", () => {
    const { request } = buildGenerateRequest({ ...EMPTY_FILTERS, crMin: 4, crMax: 10 }, { min: 700, max: 1800 });
    expect(request).toMatchObject({ crMin: 4, crMax: 4 });
  });

  it("reports a problem when the CR filter and the band do not overlap", () => {
    const { request, problem } = buildGenerateRequest({ ...EMPTY_FILTERS, crMin: 10 }, { min: 700, max: 1800 });
    expect(request).toBeNull();
    expect(problem).toMatch(/don't overlap/);
  });

  it("reports a problem when no CR fits the band", () => {
    const { request, problem } = buildGenerateRequest(EMPTY_FILTERS, { min: 20, max: 24 });
    expect(request).toBeNull();
    expect(problem).toMatch(/No challenge rating/);
  });

  it("does not share arrays with the filters", () => {
    const filters = { ...EMPTY_FILTERS, types: ["undead" as const] };
    const { request } = buildGenerateRequest(filters, null);
    request!.types.push("beast");
    expect(filters.types).toEqual(["undead"]);
  });
});

describe("describeRequest", () => {
  const base = buildGenerateRequest(EMPTY_FILTERS, null).request!;

  it("says any monster when nothing is chosen", () => {
    expect(describeRequest(base)).toBe("Any monster");
  });

  it("joins choices in plain English", () => {
    const request = { ...base, types: ["undead" as const], crMin: 3, crMax: 4, environments: ["swamp" as const, "underdark" as const] };
    expect(describeRequest(request)).toBe("Undead, CR 3 to 4, swamp or underdark");
  });

  it("handles one-sided CR bounds and a single CR", () => {
    expect(describeRequest({ ...base, crMin: 5 })).toBe("Any monster, CR 5 or higher");
    expect(describeRequest({ ...base, crMax: 0.25 })).toBe("Any monster, CR up to 1/4");
    expect(describeRequest({ ...base, crMin: 2, crMax: 2 })).toBe("Any monster, CR 2");
  });

  it("uses a comma and 'or' for three types", () => {
    expect(describeRequest({ ...base, types: ["beast", "dragon", "undead"] })).toBe("Beast, Dragon or Undead");
  });
});

describe("fewResultsPrompt", () => {
  it("is silent at three or more matches", () => {
    expect(fewResultsPrompt(3)).toBeNull();
    expect(fewResultsPrompt(40)).toBeNull();
  });

  it("speaks up below three, with the right wording", () => {
    expect(fewResultsPrompt(0)).toBe("Nothing matches these filters.");
    expect(fewResultsPrompt(1)).toBe("Only 1 match.");
    expect(fewResultsPrompt(2)).toBe("Only 2 matches.");
  });
});

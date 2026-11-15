// The published JSON Schema for 2014 packs, made from the same Zod definitions the app checks packs with.
// Editors such as VS Code read it (a pack's "$schema" field points at it) to autocomplete and underline mistakes.
//
// This test fails if public/schemas/dnd5e-2014-pack.schema.json is out of date; `npm run schema` rewrites it.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { packFileSchema } from "./packFormat";

describe("published JSON Schema", () => {
  it("matches the pack format", async () => {
    const schema = {
      ...z.toJSONSchema(packFileSchema, { target: "draft-2020-12", unrepresentable: "any" }),
      $id: "https://anvil.creaturecauldron.com/schemas/dnd5e-2014-pack.schema.json",
      title: "Adventurer Anvil content pack (D&D 5e, 2014 rules)",
    };
    await expect(JSON.stringify(schema, null, 2) + "\n").toMatchFileSnapshot(
      "../../../public/schemas/dnd5e-2014-pack.schema.json",
    );
  });
});

import { describe, expect, it } from "vitest";
import sample from "../../public/data/sample-monsters.json";
import type { Monster } from "../types/monster";
import { actionName, legendaryIntro, renderAction, segmentsToText } from "./renderAction";
import { spellcastingToText } from "./spellcastingText";

// The back end (Python) must write the same stat block sentences as this page. This test writes what the
// page produces for every sample monster into a file the Python tests read, and fails if the page's output
// changes. After an intentional wording change, run `npx vitest run -u` and then the back end tests.

const monsters = sample as unknown as Monster[];

interface Entry {
  section: string;
  display_name: string;
  prose: string;
}

function entriesFor(monster: Monster): Entry[] {
  const sections = [
    ["trait", monster.traits],
    ["action", monster.actions],
    ["bonus_action", monster.bonus_actions],
    ["reaction", monster.reactions],
  ] as const;
  return sections.flatMap(([section, list]) =>
    list.map((action) => ({
      section,
      display_name: actionName(action),
      prose: segmentsToText(renderAction(action, monster.name)),
    })),
  );
}

describe("shared stat block wording", () => {
  it("matches the golden file the Python tests read", async () => {
    const golden = monsters.map((monster) => ({
      name: monster.name,
      entries: entriesFor(monster),
      spellcasting: monster.spellcasting ? spellcastingToText(monster.spellcasting) : null,
      legendary_intro: monster.legendary_actions
        ? legendaryIntro(monster.name, monster.legendary_actions.per_round)
        : null,
    }));
    await expect(`${JSON.stringify(golden, null, 2)}\n`).toMatchFileSnapshot("../../../backend/tests/fixtures/rendered-actions.json");
  });
});

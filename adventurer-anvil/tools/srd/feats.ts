// SRD 5.1's only feat, entered by hand from the SRD's text (page 75): the pinned community files have no feats file.
import type { Feat } from "../../frontend/src/systems/dnd5e-2014/packFormat";

const GRAPPLER = [
  "You've developed the skills necessary to hold your own in close-quarters grappling. You gain the following benefits:",
  "- You have advantage on attack rolls against a creature you are grappling.",
  "- You can use your action to try to pin a creature grappled by you. To do so, make another grapple check. If you succeed, you and the creature are both restrained until the grapple ends.",
].join("\n");

export function buildFeats(): Feat[] {
  return [
    {
      id: "grappler",
      name: "Grappler",
      summary: "Advantage against creatures you grapple, and you can pin them.",
      description: `Prerequisite: Strength 13 or higher\n\n${GRAPPLER}`,
      requires: { abilities: [{ ability: "str", min: 13 }] },
      effects: [{ type: "feature", name: "Grappler", description: GRAPPLER }],
    },
  ];
}

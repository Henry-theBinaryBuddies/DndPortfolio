import type { ReactNode } from "react";
import type { Ability, Action, Monster } from "../types/monster";
import { abilityModifier, formatSigned } from "../lib/dice";
import { actionName, renderAction, type Segment } from "../lib/renderAction";
import "./StatBlock.css";

// A component is a function that takes props and returns markup. StatBlock is
// built from a few small components below, each responsible for one part.

const ABILITY_ORDER: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function joinList(items: string[]): string {
  return items.join(", ");
}

function formatSpeeds(speeds: Monster["speeds"]): string {
  const parts: string[] = [];
  if (speeds.walk !== undefined) parts.push(`${speeds.walk} ft.`);
  for (const mode of ["burrow", "climb", "fly", "swim"] as const) {
    const feet = speeds[mode];
    if (feet !== undefined) parts.push(`${mode} ${feet} ft.${mode === "fly" && speeds.hover ? " (hover)" : ""}`);
  }
  return parts.length > 0 ? parts.join(", ") : "0 ft.";
}

function formatSenses(senses: Monster["senses"]): string {
  const parts: string[] = [];
  for (const sense of ["blindsight", "darkvision", "tremorsense", "truesight"] as const) {
    const feet = senses[sense];
    if (feet !== undefined) parts.push(`${sense} ${feet} ft.`);
  }
  parts.push(`passive Perception ${senses.passive_perception}`);
  return joinList(parts);
}

function formatBonuses(bonuses: Record<string, number>): string {
  return joinList(Object.entries(bonuses).map(([name, bonus]) => `${capitalize(name)} ${formatSigned(bonus)}`));
}

/** One "Label value" line, with the label in bold. Renders nothing for empty values. */
function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="statblock__property">
      <strong>{label}</strong> {children}
    </p>
  );
}

function Segments({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((segment, i) => (segment.italic ? <em key={i}>{segment.text}</em> : segment.text))}
    </>
  );
}

function AbilityTable({ abilities }: { abilities: Monster["abilities"] }) {
  return (
    <table className="statblock__abilities">
      <thead>
        <tr>
          {ABILITY_ORDER.map((a) => (
            <th key={a}>{a.toUpperCase()}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {ABILITY_ORDER.map((a) => (
            <td key={a}>
              {abilities[a]} ({formatSigned(abilityModifier(abilities[a]))})
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/** A traits or actions entry: bold-italic name, then the rendered prose. */
function Entry({ action, monsterName }: { action: Action; monsterName: string }) {
  return (
    <p className="statblock__entry">
      <em>
        <strong>{actionName(action)}.</strong>
      </em>{" "}
      <Segments segments={renderAction(action, monsterName)} />
    </p>
  );
}

function ActionSection({ title, actions, monsterName }: { title: string; actions: Action[]; monsterName: string }) {
  if (actions.length === 0) return null;
  return (
    <section>
      <h3 className="statblock__heading">{title}</h3>
      {actions.map((action) => (
        <Entry key={action.name} action={action} monsterName={monsterName} />
      ))}
    </section>
  );
}

function LegendarySection({ monster }: { monster: Monster }) {
  const legendary = monster.legendary_actions;
  if (!legendary) return null;
  const name = monster.name.toLowerCase();
  return (
    <section>
      <h3 className="statblock__heading">Legendary Actions</h3>
      <p className="statblock__entry">
        The {name} can take {legendary.per_round} legendary actions, choosing from the options below. Only one legendary
        action can be used at a time and only at the end of another creature's turn. The {name} regains spent legendary
        actions at the start of its turn.
      </p>
      {legendary.options.map((option) => (
        <p className="statblock__entry" key={option.name}>
          <em>
            <strong>
              {option.name}
              {option.cost > 1 ? ` (Costs ${option.cost} Actions)` : ""}.
            </strong>
          </em>{" "}
          {option.text}
        </p>
      ))}
    </section>
  );
}

export default function StatBlock({ monster }: { monster: Monster }) {
  const { challenge, senses } = monster;
  const subtitle = [
    `${capitalize(monster.size)} ${monster.type}`,
    monster.subtypes.length > 0 ? `(${joinList(monster.subtypes)})` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const traits: Action[] = [...monster.traits];
  if (monster.spellcasting) {
    traits.push({ kind: "text", name: "Spellcasting", text: monster.spellcasting.text });
  }

  return (
    <article className="statblock">
      <div className="statblock__rule" />
      <h2 className="statblock__name">{monster.name}</h2>
      <p className="statblock__subtitle">
        {subtitle}, {monster.alignment}
      </p>
      <div className="statblock__divider" />

      <Property label="Armor Class">
        {monster.armor_class.value}
        {monster.armor_class.note ? ` (${monster.armor_class.note})` : ""}
      </Property>
      <Property label="Hit Points">
        {monster.hit_points.average} ({monster.hit_points.dice})
      </Property>
      <Property label="Speed">{formatSpeeds(monster.speeds)}</Property>
      <div className="statblock__divider" />

      <AbilityTable abilities={monster.abilities} />
      <div className="statblock__divider" />

      {Object.keys(monster.saves).length > 0 && (
        <Property label="Saving Throws">{formatBonuses(monster.saves)}</Property>
      )}
      {Object.keys(monster.skills).length > 0 && <Property label="Skills">{formatBonuses(monster.skills)}</Property>}
      {monster.vulnerabilities.length > 0 && (
        <Property label="Damage Vulnerabilities">{joinList(monster.vulnerabilities)}</Property>
      )}
      {monster.resistances.length > 0 && <Property label="Damage Resistances">{joinList(monster.resistances)}</Property>}
      {monster.immunities.length > 0 && <Property label="Damage Immunities">{joinList(monster.immunities)}</Property>}
      {monster.condition_immunities.length > 0 && (
        <Property label="Condition Immunities">{joinList(monster.condition_immunities)}</Property>
      )}
      <Property label="Senses">{formatSenses(senses)}</Property>
      <Property label="Languages">{monster.languages}</Property>
      <Property label="Challenge">
        {challenge.cr} ({challenge.xp.toLocaleString("en-US")} XP)
      </Property>
      <div className="statblock__divider" />

      {traits.map((trait) => (
        <Entry key={trait.name} action={trait} monsterName={monster.name} />
      ))}

      <ActionSection title="Actions" actions={monster.actions} monsterName={monster.name} />
      <ActionSection title="Bonus Actions" actions={monster.bonus_actions} monsterName={monster.name} />
      <ActionSection title="Reactions" actions={monster.reactions} monsterName={monster.name} />
      <LegendarySection monster={monster} />

      <div className="statblock__rule" />
      <p className="statblock__flavor">{monster.description}</p>
      {monster.attribution && <p className="statblock__attribution">{monster.attribution}</p>}
    </article>
  );
}

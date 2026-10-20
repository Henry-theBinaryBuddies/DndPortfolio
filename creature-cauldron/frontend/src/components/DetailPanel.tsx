import type { Monster } from "../types/monster";
import StatBlockContent, { type StatBlockContentProps } from "./StatBlockContent";
import { CauldronArt } from "./Illustrations";

interface DetailPanelProps extends Omit<StatBlockContentProps, "monster"> {
  /** The chosen monster, or null when nothing is chosen yet. */
  monster: Monster | null;
}

// The right-hand page of the spread (wide screens): the chosen monster's stat block, always on screen beside the list.
export default function DetailPanel({ monster, ...content }: DetailPanelProps) {
  return (
    <section className="panel detail-panel" aria-label={monster ? `${monster.name} stat block` : "Stat block"}>
      {monster ? (
        <StatBlockContent monster={monster} {...content} />
      ) : (
        <div className="empty-scene detail-empty">
          <CauldronArt className="empty-scene__art" />
          <p className="empty-state">Choose a monster from the list to read its stat block.</p>
        </div>
      )}
    </section>
  );
}

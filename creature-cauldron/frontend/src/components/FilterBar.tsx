import { useEffect, useRef, useState, type ReactNode } from "react";
import { CR_LADDER, toggle, type FilterState } from "../lib/filters";
import {
  CREATURE_TYPES,
  DAMAGE_THEMES,
  ENVIRONMENTS,
  FEATURES,
  FEATURE_LABELS,
  ROLES,
  SIZES,
  label,
} from "../lib/options";

// A horizontal bar: a search box plus one dropdown menu per filter group. Like the old
// side panel it never stores filter values itself. It shows whatever `filters` says and
// reports changes through `onChange`; App owns the state ("lifting state up").

interface FilterBarProps {
  filters: FilterState;
  activeCount: number;
  onChange: (next: FilterState) => void;
  onClear: () => void;
}

interface CheckboxListProps<T extends string> {
  options: readonly T[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  getLabel?: (value: T) => string;
}

/** A list of checkboxes. Generic over the option type, so a Role list only accepts Roles. */
function CheckboxList<T extends string>({ options, selected, onToggle, getLabel = label }: CheckboxListProps<T>) {
  return (
    <ul className="filter-options">
      {options.map((option) => (
        <li key={option}>
          <label>
            <input type="checkbox" checked={selected.includes(option)} onChange={() => onToggle(option)} />
            {getLabel(option)}
          </label>
        </li>
      ))}
    </ul>
  );
}

function CrSelect({
  id,
  text,
  value,
  onChange,
}: {
  id: string;
  text: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="cr-select" htmlFor={id}>
      {text}
      <select
        id={id}
        value={value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      >
        <option value="">Any</option>
        {CR_LADDER.map((cr) => (
          <option key={cr.label} value={String(cr.value)}>
            {cr.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface MenuProps {
  id: string;
  title: string;
  /** How many picks are active in this group, shown as a badge on the button. */
  count: number;
  open: boolean;
  onToggle: () => void;
  buttonRef: (element: HTMLButtonElement | null) => void;
  children: ReactNode;
}

/** A button that opens a small panel of controls under it. Only the open state lives outside, in FilterBar. */
function Menu({ id, title, count, open, onToggle, buttonRef, children }: MenuProps) {
  const panelId = `filter-menu-${id}`;
  return (
    // data-menu names this menu, so FilterBar can tell a click or focus inside it from one elsewhere.
    <div className="menu" data-menu={id}>
      <button
        type="button"
        ref={buttonRef}
        className="menu-button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={onToggle}
      >
        {title}
        {count > 0 && <span className="filter-count">{count}</span>}
        <span aria-hidden="true"> ▾</span>
      </button>
      {open && (
        <div id={panelId} className="menu-panel" role="group" aria-label={title}>
          {children}
        </div>
      )}
    </div>
  );
}

export default function FilterBar({ filters, activeCount, onChange, onClear }: FilterBarProps) {
  const update = (changes: Partial<FilterState>) => onChange({ ...filters, ...changes });

  // Only one menu is open at a time, so a single value says which (or none).
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  // While a menu is open, a click anywhere else, moving keyboard focus out of it, or the Escape key closes it.
  // An effect that returns a function cleans up after itself when the menu closes.
  useEffect(() => {
    if (openMenu === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-menu]")) setOpenMenu(null);
    };
    const onFocusIn = (event: FocusEvent) => {
      const menu = (event.target as Element).closest("[data-menu]");
      if (menu?.getAttribute("data-menu") !== openMenu) setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenMenu(null);
      buttons.current[openMenu]?.focus(); // put keyboard focus back on the button that opened it
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  // Keep the range sensible: raising the minimum above the maximum drags the maximum up, and vice versa.
  const setCrMin = (crMin: number | null) =>
    update({ crMin, crMax: crMin !== null && filters.crMax !== null && crMin > filters.crMax ? crMin : filters.crMax });
  const setCrMax = (crMax: number | null) =>
    update({ crMax, crMin: crMax !== null && filters.crMin !== null && crMax < filters.crMin ? crMax : filters.crMin });

  /** Props every menu shares. */
  const menu = (id: string, title: string, count: number) => ({
    id,
    title,
    count,
    open: openMenu === id,
    onToggle: () => setOpenMenu(openMenu === id ? null : id),
    buttonRef: (element: HTMLButtonElement | null) => {
      buttons.current[id] = element;
    },
  });

  return (
    <section className="filter-bar" aria-label="Filters">
      <input
        type="search"
        className="search-box"
        placeholder="Search by name"
        aria-label="Search by name"
        value={filters.search}
        onChange={(e) => update({ search: e.target.value })}
      />

      <div className="filter-menus">
        <Menu {...menu("type", "Type", filters.types.length)}>
          <CheckboxList
            options={CREATURE_TYPES}
            selected={filters.types}
            onToggle={(v) => update({ types: toggle(filters.types, v) })}
          />
        </Menu>

        <Menu {...menu("cr", "CR", filters.crMin !== null || filters.crMax !== null ? 1 : 0)}>
          <div className="cr-range">
            <CrSelect id="cr-min" text="Min" value={filters.crMin} onChange={setCrMin} />
            <CrSelect id="cr-max" text="Max" value={filters.crMax} onChange={setCrMax} />
          </div>
        </Menu>

        <Menu {...menu("size", "Size", filters.sizes.length)}>
          <CheckboxList
            options={SIZES}
            selected={filters.sizes}
            onToggle={(v) => update({ sizes: toggle(filters.sizes, v) })}
          />
        </Menu>

        <Menu {...menu("environment", "Environment", filters.environments.length)}>
          <CheckboxList
            options={ENVIRONMENTS}
            selected={filters.environments}
            onToggle={(v) => update({ environments: toggle(filters.environments, v) })}
          />
        </Menu>

        <Menu {...menu("role", "Role", filters.roles.length)}>
          <CheckboxList
            options={ROLES}
            selected={filters.roles}
            onToggle={(v) => update({ roles: toggle(filters.roles, v) })}
          />
        </Menu>

        <Menu {...menu("damage", "Damage", filters.damageThemes.length)}>
          <CheckboxList
            options={DAMAGE_THEMES}
            selected={filters.damageThemes}
            onToggle={(v) => update({ damageThemes: toggle(filters.damageThemes, v) })}
          />
        </Menu>

        <Menu {...menu("features", "Features (all)", filters.features.length)}>
          <CheckboxList
            options={FEATURES}
            selected={filters.features}
            onToggle={(v) => update({ features: toggle(filters.features, v) })}
            getLabel={(feature) => FEATURE_LABELS[feature]}
          />
        </Menu>
      </div>

      {/* aria-disabled, not disabled: pressing this clears the filters and would otherwise disable the
          button while it has keyboard focus. With nothing to clear, pressing it does nothing. */}
      <button
        type="button"
        className="link-button"
        aria-disabled={activeCount === 0}
        onClick={() => {
          if (activeCount > 0) onClear();
        }}
      >
        Clear all{activeCount > 0 ? ` (${activeCount})` : ""}
      </button>
    </section>
  );
}

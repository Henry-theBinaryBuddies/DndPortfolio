# Adventurer Anvil: requirements

A D&D character creator that aims for the simplicity of Roll20's Charactermancer: guided steps, legal choices only, a finished sheet at the end. It is an original design and does not copy Roll20's look or text.

Agreed 8 Nov 2026. The prototype is **Milestone 1** below, complete on 24 Nov 2026 (see §10 for the decisions made
while building it). Everything else is planned and must not be blocked by M1's design.

## 1. Guiding principle: modular systems

The prototype supports **only the 2014 D&D 5e rules**, but every layer stays system-agnostic so other systems can be added later as modules (D&D 2024, Pathfinder, Cyberpunk, Kids on Bikes, ...).

- **Core** knows nothing about D&D. It knows: a *system* module, *content packs*, a *character* document, *build steps*, *choices*, *derived values*, *validation results* and *overrides*.
- **A system module** (first: `dnd5e-2014`) supplies its own build steps, its rules engine (derived stats, legality checks, level-up), sheet layout, dice expressions, optional rules and exporters.
- **Content packs** are data only (JSON, validated against a schema the system module publishes). Rules logic never lives in content, and content never lives in code.
- **Character files** record the system and version, the packs (id and version) they use, and the choices made. Derived values are recomputed, not stored.
- Litmus test for every M1 design decision: *could a Kids on Bikes module plug in without changing core?*

## 2. Rules and content

| Item | Decision |
|---|---|
| Ruleset | 2014 5e (PHB rules) |
| Built-in content | **SRD 5.1** (CC-BY-4.0), with attribution on the page and in exports |
| Levels | Create at any level 1-20; **level up** saved characters later |
| Multiclassing | Yes, with ability score prerequisites, multiclass proficiencies and the multiclass spell slot table |
| Rule strictness | Enforced by default; a per-character **DM override** unlocks any choice and marks it on the sheet |
| Optional rules (toggleable per character, or set by a campaign) | Feats instead of ASIs and Variant Human; HP rolled or average per level (rolls logged); variant encumbrance; custom lineage/origin (Tasha's-style moved bonuses, for packs you own) |

### Own content packs (book content you own)

- Uploaded to your account and **private: readable only by the account that uploaded them. No sharing**, campaigns included.
- Validated against the published pack schema on upload.
- Packs hold **mechanics** (numbers, choices, prerequisites) plus a description in your own words or a page reference, not copied rules text.
- Sheets store the *results* of choices (e.g. "Darkvision 60 ft"), so a DM viewing your sheet sees the character, not the pack.
- Each player who owns a book imports their own pack.
- Before anyone else can upload: a terms checkbox ("I own the rights to what I upload"), a takedown contact, and a DMCA agent registration.
- **Homebrew editor:** later. M1 defines and documents the schema only: [`PACK-FORMAT.md`](PACK-FORMAT.md).

## 3. The builder (guided steps)

Order: **Rules → Race → Abilities → Class → Background → Equipment → Spells → Details → Review → Sheet**. Any step can be revisited; choices made invalid by a later change are flagged where they were made and listed on Review. A live summary of the character stays visible beside the steps.

- **Abilities:** point buy (27), standard array, rolled 4d6-drop-lowest (in-app roller, the roll log kept with the character). No manual entry.
- **Equipment:** class and background kit choices ("(a) or (b)"); or starting gold and a shop of SRD items; a full inventory editor (weight, coin, attunement, encumbrance); the equipped armour and shield set AC, and equipped weapons make attack rows.
- **Spells:** search and filter the class list (level, school, ritual, concentration) with full descriptions; correct known/prepared/cantrip counts per class, including the wizard's spellbook; slots tracked, including multiclass and Pact Magic; printable spell cards.
- **Details:** personality traits, ideals, bonds, flaws (with the background's roll tables), alignment, backstory; appearance (age, height, weight, eyes, skin, hair, with random suggestions from the species); a name generator flavoured by species; allies, organisations, notes and a session journal.
- **Rules:** the optional rules above, each a switch with a default, so the step is always done (a new character opens at Race).
- **Portrait:** upload an image, or sculpt one in **Effigy Engine** (opened with the race preset) and bring the token PNG back.

## 4. The character sheet

- An on-screen sheet, printable.
- **At the table:** HP, temp HP and death saves; click to roll checks, saves, attacks and damage, with a roll log; short and long rests restore slots, hit dice and class resources (Ki, Rage, ...); conditions and exhaustion, with their effects shown.
- Works well on a **phone**, the play sheet especially.

## 5. Output

- JSON save file (the app's own versioned format), to reopen and level up.
- Fillable PDF character sheet.
- VTT exports: **Foundry VTT** (dnd5e actor; Creature Cauldron's exporter is a starting point), **Roll20** (by a Pro API Mod script that reads the export in the game), **Fantasy Grounds** (XML), and **Owlbear Rodeo** (token and stats bundle).

## 6. Accounts, campaigns and the other apps

- **Sign-in:** OAuth with Google and Discord. Characters are saved to the account and reachable from any device.
- **Campaigns:** a DM creates one and invites by link; players attach characters; the DM sees every party sheet; the DM sets allowed content and optional rules (feats, multiclassing, ...). Campaign rules never expose anyone's private packs.
- **Creature Cauldron:** pull familiars, companions, wild shape and summon stat blocks.
- **Chronomancer:** link a campaign to its group and sessions.

## 7. Platform

| Item | Decision |
|---|---|
| Frontend | Vite + React + TypeScript (as Creature Cauldron) |
| Backend | Python, in the style of Chronomancer (FastAPI, SQLAlchemy, Alembic; it already has Discord OAuth) |
| Hosting | **anvil.creaturecauldron.com**: frontend on Cloudflare Pages (live since 25 Nov 2026; see [`DEPLOYMENT.md`](DEPLOYMENT.md)); API on the home server beside Creature Cauldron's service, behind a Cloudflare Tunnel (with Milestone 2, now on hold) |
| Look | Matches Effigy Engine: dark, iron and forge |
| Devices | Desktop and phone, responsive throughout |
| Accessibility | WCAG 2.2 AA: keyboard-only use, screen-reader labels, contrast, reduced motion; automated checks in tests |
| Repo | Branch `claude/anvil`, folder `adventurer-anvil/`, merged to master by PR |

## 8. Milestones

1. **M1, the prototype (core builder):** the system-agnostic core, the `dnd5e-2014` module, SRD 5.1 as a pack, the pack schema (documented), all builder steps for levels 1-20 including multiclassing and optional rules, the DM override, the on-screen sheet, JSON save and open. Browser only: characters kept in localStorage and JSON files, with the data layer shaped for accounts.
2. **M2, accounts:** OAuth sign-in, cloud saves, level-up of saved characters across devices, private pack upload with the terms, takedown and DMCA steps.
   **On hold (25 Nov 2026):** Tome & Tile will have accounts and a server, so this waits until folding Anvil into
   Tome & Tile is designed, rather than building a separate backend for Anvil.
3. **M3, play sheet:** moved to Tome & Tile (decided 24 Nov 2026). Anvil will be folded into Tome & Tile, the team's
   virtual tabletop, which already owns play: HP, dice, rests and conditions. Anvil's part is the **Tome & Tile export**:
   a character as Tome & Tile's `Creature` contract (Protobuf JSON), as its ADR 0010 plans. Built 24 Nov 2026.
4. **M4, outputs:** fillable PDF, spell cards, Foundry, Fantasy Grounds, Owlbear, then Roll20. The PDF and spell
   cards stay Anvil's; the other virtual-table exports matter less now that Tome & Tile is the team's table.
5. **M5, campaigns:** invites, party view, campaign content rules. **Moving to Tome & Tile**, which has campaigns.
6. **M6, the other apps:** Effigy Engine portraits (still Anvil's), Creature Cauldron companions and Chronomancer
   links (Tome & Tile's, through its importers).
7. **Later:** homebrew editor; more system modules.

## 9. Resolved questions

- **Roll20 export:** through the Roll20 Pro API (the owner has a Pro account). A Mod (API) script in the game reads an Adventurer Anvil export and builds the character on the sheet.
- **Storage before M2:** characters stay local in M1: in the browser (localStorage), plus JSON save and open.
- **Where the API runs:** on the home server, beside Creature Cauldron's service, behind a Cloudflare Tunnel.

## 10. Decisions made while building Milestone 1

- **Step order:** Abilities come before Class (not after, as first written), so class prerequisites, multiclassing and
  prepared spell counts are right the first time they're shown. Every step can still be revisited. Rules is a step of
  its own, first, and the Sheet comes after Review.
- **Equipment:** the inventory editor changes what's carried, adds items free, holds your own items, attunement (at
  most three, a DM can allow more) and money as a list of changes. SRD 5.1's magic items aren't in the pinned source
  files, so attunement matters for your own items and packs until they're imported.
- **The sheet:** laid out by the system and drawn by the app. It prints black on white; feature and spell text and the
  session journal print only when "Print full text" is ticked, so the sheet stays about two pages. Printable spell cards
  stay in M4.
  **Restyled (27 Nov 2026):** the classic paper sheet's three-column layout, in our own lettering and boxes (the
  official sheet's artwork isn't in the SRD, so it isn't copied): a band with the name and facts; abilities standing
  beside saves and skills; combat in the middle with boxes to fill in by hand (current and temporary hit points, hit
  dice, death saves) and an attacks table; personality and features on the right, with a box to tick per use. Then
  everything carried (below), the story and portrait, and, for spellcasters only, the spells by level with their slots
  to tick. Serif type already on the computer, so nothing is downloaded.
  Page 1 keeps a small box that can't overflow (the coins, the total weight, and the armour and shield worn); everything
  carried has its own page after it: boxes for each coin (CP, SP, EP, GP, PP), the total weight and carrying capacity,
  then two columns of how many, the item and its weight (a pack's contents under its name), about 70 lines in all, and
  a box for treasure and notes. Money keeps its coins: gold stays gold, found silver stays silver, and
  shopping is paid as a shopkeeper would take it, smallest coins first with the change in smaller coins.
- **SRD gaps the community files leave:** filled from the SRD's text: Grappler, the Circle of the Land's choice of land,
  bonus cantrip and circle spells, and starting gold where no dice are given (the DM's figure is asked for).
- **Custom origin:** moves the race's fixed ability increases, each to a different score. Swapping languages and
  proficiencies isn't required and isn't built.

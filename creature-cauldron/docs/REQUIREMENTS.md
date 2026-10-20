# Creature Cauldron: Requirements

Artifact 3 of the D&D portfolio. A 2014-rules (5e) monster library and generator that doubles as an all-in-one tool for the author's own D&D party.

Status: **draft for review.** Priorities use MoSCoW (Must / Should / Could / Won't for now).

## 1. Purpose

Let a DM filter a large library of original or openly licensed monsters, build encounters sized to their party, and, when the library has nothing suitable, generate a new valid monster with AI and cache it for everyone. It is both a portfolio showcase (full-stack, OOP Python, React + TypeScript) and a tool the party uses and maintains indefinitely.

## 2. Users

| User | Needs |
|---|---|
| **DM** | Find or create creatures fast, balance encounters, export stat blocks to a VTT or print. |
| **Player** | Look up creatures. Meta-gaming is explicitly acceptable. |
| **Recruiter / reviewer** | A polished live demo that never looks broken, plus readable code and documentation. |

## 3. Scope decisions already made

- Rules edition: **2014**. Difficulty tiers are easy / medium / hard / deadly from the 2014 DMG encounter method.
- Content: **SRD 5.1 (CC-BY 4.0, with attribution) plus original AI-generated monsters.** No Monster Manual or other copyrighted content.
- Access: **fully open.** No accounts, sign-in, or passcode.
- Generator input: **structured options only.** No user-typed prompts.
- Hosting: static front end on GitHub Pages; a small Python API on the author's home server for generation and caching only.
- Stack: React + TypeScript + Vite (front end); Python, FastAPI, Pydantic, SQLite (back end); Claude Haiku for generation.
- Delivery: **front end first**, against sample data and a stubbed generator. Back end follows, built test-first.

## 4. Functional requirements

### 4.1 Library and filtering

| ID | Requirement | Priority |
|---|---|---|
| F-1 | Browse and search a library of monsters loaded from static JSON. | Must |
| F-2 | Filter by creature type (2014 types), CR (single value or range), size, environment, role, damage theme, and features. Filters combine with AND; multi-value filters use OR within the filter, except features, which use AND (a monster must have every picked feature). | Must |
| F-3 | Sort results by name, CR, and type. | Should |
| F-4 | Show a source badge on each monster (SRD, curated, AI, reskin) and a validated/unvalidated badge. | Must |
| F-5 | Library target: **1,000+ monsters** at launch. | Should |
| F-6 | Show the required CC-BY attribution for SRD content. | Must |

### 4.2 Stat block

| ID | Requirement | Priority |
|---|---|---|
| F-7 | Render a complete 2014-style stat block: AC, HP and dice, speeds, ability scores, saves, skills, resistances, senses, languages, CR and XP, traits, actions, bonus actions, reactions, legendary actions, spellcasting. | Must |
| F-8 | Action text is **rendered from structured data** (attack, save, multiattack) so displayed numbers always match the dice and bonuses. Free-text for traits. | Must |
| F-9 | A print-friendly stat block view (print CSS, one monster per page option). | Must |

### 4.3 Party and difficulty

| ID | Requirement | Priority |
|---|---|---|
| F-10 | Enter party size and each member's level (or a single level for the whole party). | Must |
| F-11 | Choose easy / medium / hard / deadly; the app converts it to a CR band for filtering. | Must |
| F-12 | Party is saved locally in the browser. | Should |

### 4.4 Encounter builder and favorites

| ID | Requirement | Priority |
|---|---|---|
| F-13 | Add monsters (with counts) to an encounter; show total XP, adjusted XP (2014 multiplier by monster count and party size), and a live easy/medium/hard/deadly rating. | Must |
| F-14 | Favorite monsters; favorites persist locally. | Must |
| F-15 | Save, name, and reload multiple encounters locally. | Should |
| F-16 | Shareable encounter link (encounter encoded in the URL). | Could |

### 4.5 Generation and reskin (needs the back end)

| ID | Requirement | Priority |
|---|---|---|
| F-17 | When a filter set returns too few results, offer to generate a monster. Users can also request "generate another." | Must |
| F-18 | Generation takes only the structured filters; the server fills unspecified dimensions randomly for variety. | Must |
| F-19 | Reskin: pick a base monster and a theme from fixed options, optionally a damage-type swap or template (elite, swarm). Code adjusts the numbers; AI writes only names and flavor text. | Must |
| F-20 | Every generated monster passes a deterministic validator before it is stored or shown as valid (section 6). | Must |
| F-21 | Generated monsters are cached server-side and appear in the library for all users. | Must |
| F-22 | A reviewed export of good cached monsters can be promoted into the seed data in the repo. | Should |
| F-23 | When the API is unreachable or capped, generation controls show a clear offline/resting state; everything else keeps working. | Must |

### 4.6 Export

| ID | Requirement | Priority |
|---|---|---|
| F-24 | Export a monster or encounter as JSON. | Must |
| F-25 | Export a monster as Foundry VTT dnd5e actor JSON, targeting one specific system version (to be chosen). | Must |
| F-26 | ~~Roll20 export~~ Dropped: the available import routes need third-party scripts or browser extensions that can put a user's Roll20 account at risk, and we do not want to carry that. | Won't |

## 5. Non-functional requirements

| ID | Requirement |
|---|---|
| N-1 | **Open access.** No sign-in. Abuse protection is technical only: cache-first generation, per-IP rate limit, global daily generation cap, and a monthly spend limit configured in the Anthropic console. |
| N-2 | **Graceful degradation.** The Pages site is fully usable with the API offline. |
| N-3 | **Cost bounded.** The worst-case daily spend is capped in code, independent of traffic. |
| N-4 | **No user text reaches the model.** All inputs come from fixed option lists. |
| N-5 | **Originality.** A blocklist of product-identity monster names is enforced on all generated and imported content. |
| N-6 | **Performance.** Initial library load stays small enough for fast first paint (static JSON, gzip; split into chunks if needed). Filtering feels instant. |
| N-7 | **Accessibility and responsiveness.** Keyboard navigable, readable contrast, works at phone width. |
| N-8 | **Security.** API restricts CORS to the Pages origin; the home server is reached through a tunnel, with no open inbound port. |
| N-9 | **Testability.** Rules and validator logic have automated unit tests; the generator is swappable for a fake so tests spend no money. |
| N-10 | **Maintainability.** The monster schema is versioned (`schema_version`); front-end types are derived from, or checked against, the back-end schema once the API exists. |

## 6. Validation rules (back end)

| Check | Rule | Outcome |
|---|---|---|
| Schema | Types, ranges (ability scores 1 to 30), text length limits | Reject |
| Name | Not on blocklist; not a duplicate | Reject |
| Derived fields | Proficiency bonus and XP from CR; ability modifiers | Auto-correct |
| Hit points | Die type follows size; average matches dice and Constitution modifier | Auto-correct |
| Attack bonus | Proficiency + stated ability modifier | Auto-correct |
| Save DC | 8 + proficiency + ability modifier | Auto-correct |
| CR consistency | Recomputed CR within 1 step of claimed CR | Retry model (max 2), then discard |
| Legendary actions | Sensible count and costs | Auto-correct or reject |
| Features | Feature tags derived from the stat block | Auto-correct |
| Attribution | SRD monsters carry the exact CC-BY statement | Reject |

Notes on how these are built (backend/src/cauldron/validator.py):

- Attack bonuses, save DCs and spell numbers may sit 0 to 3 above the plain rule, because magic and the elite template add a little. Only larger gaps are corrected. A save DC does not say which ability it uses, so any ability that reaches it is accepted.
- Official SRD monsters are never "corrected". Differences are reported as notes and the printed numbers stay.
- **CR consistency is not built yet.** The usual way to estimate CR uses the Dungeon Master's Guide's "Monster Statistics by Challenge Rating" table, which is not in the SRD 5.1 (checked), so it is not used. The estimator will be calibrated from SRD monsters during the seed pipeline instead.
- Names are checked against a deliberately cautious blocklist (backend/src/cauldron/blocklist.py): Wizards product-identity monsters, iconic named characters and settings.

## 7. Data model summary

The full schema lives in `docs/` once the front-end types exist. Key points:

- Identity and provenance: `id`, `schema_version`, `name`, `source`, `validated`, `parent_id`, `generator`, `attribution`.
- Core stat block fields per the 2014 format.
- **Hybrid actions:** typed `attack`, `save`, and `multiattack`; free-text `text`. Unparseable imported lines degrade to `text`.
- Discovery tags: `environments`, `role`, `damage_themes`, `features`. `features` are derived by code, never trusted from the AI.

## 8. Milestones

**Phase 1: Front end (no back end).**

1. Scaffold the Vite + React + TypeScript app; define types; load ~15 original sample monsters.
2. Stat block component and print CSS.
3. Filter bar and results list.
4. Party and difficulty selection (CR band).
5. Encounter builder, favorites, local persistence.
6. JSON and Foundry export.
7. Generate and Reskin controls wired to a stub that shows the offline state. (Done. A `?generator=demo` switch returns made-up monsters so the flow can be clicked through; the reskin offers a damage swap and an elite template.)

**Phase 2: Back end (test-first).**

1. Python domain models and the action class hierarchy.
2. Rules engine: CR calculator, encounter budget, validator.
3. Seed pipeline: SRD import, tagging, validation. (Done: 333 SRD 5.1 monsters from a community copy of the data, cross-checked against the official document, with the exact CC-BY attribution on each. Environments and roles are rule-based guesses. Most SRD saving throws and many attack riders stay as word-for-word text because the typed forms cannot reproduce the SRD's wording exactly.)
4. FastAPI service, SQLite cache, Haiku generator, rate limiting and daily cap.
5. Replace the front-end stub with the real API.

**Phase 3: Launch.**

1. Home-server deployment through a tunnel; CORS locked to the Pages origin.
2. Pages build and deploy path; link from the portfolio home page.
3. Reach the 1,000+ monster target through the seed pipeline.
4. Gallery content and documentation for the portfolio.

Each phase ends with something the author can run and test.

## 9. Out of scope for now

- Accounts, shared party state, and server-side favorites.
- Free-text prompts.
- AI-generated artwork.
- Semantic or embedding search.
- 2024 rules.

## 10. Open questions

1. ~~Which Foundry dnd5e system version do we target?~~ Answered: dnd5e 5.3.3 (see EXPORTS.md).
2. How does the built front end reach GitHub Pages (separate workflow, committed build, or the existing root webpack copy step)?
3. Which SRD data source do we import (open5e or 5e-bits), pending a license check?
4. Tailscale Funnel or Cloudflare Tunnel for the home server?
5. What threshold counts as "too few results" to offer generation?

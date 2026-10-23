# Creature Cauldron: technical document

The maintenance manual for Creature Cauldron, written for someone who did not build it. It explains what the system is, how a request travels through it, why the
important decisions were made, how to run, deploy and repair it, and where the sharp edges are. It sits on top of the topic documents, which go deeper on one subject
each and are linked where they matter:

| Document | Subject |
|---|---|
| [REQUIREMENTS.md](REQUIREMENTS.md) | The plan: scope, requirements, validation rules, milestones |
| [REMIX.md](REMIX.md) | Remix, Reflavor and Polymorph in detail |
| [A5E.md](A5E.md) | The A5E monster import and why the estimator ignores it |
| [EXPORTS.md](EXPORTS.md) | JSON, Foundry VTT and 5etools exports |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Server setup, Cloudflare, key safety, launch checklist, day-to-day |
| [CODE_REVIEW.md](CODE_REVIEW.md), [CODE_REVIEW_2.md](CODE_REVIEW_2.md) | The two reviews and what was done about each finding |
| [ART.md](ART.md) | The banner picture |
| [../LICENSES.md](../LICENSES.md) | Every licence and credit |

Facts that can go stale (counts, caps, versions) are written as they stood at launch, 22 October 2026. The code is the authority; the tests prove the rest.

---

## 1. What it is

Creature Cauldron is a monster library and generator for the 2014 rules of the world's best-known fantasy tabletop role-playing game. A Dungeon Master can:

- browse and filter **939 monsters** (20 hand-written samples, 333 from the System Reference Document 5.1, 586 from the A5E Monstrous Menagerie), and read each as a 2014-style stat block;
- enter a party and pick a difficulty, which narrows the list to monsters of that difficulty, and build encounters with a live difficulty rating;
- **generate** a new, valid monster from structured filters (no typed prompts);
- **reskin** any monster three ways: **Reflavor** (a new name and description, numbers untouched), **Remix** (a new damage theme, a signature move, a level up) and **Polymorph** (borrow features from a second creature);
- export a monster or an encounter as JSON, as a Foundry VTT actor, or as a 5etools homebrew file; print a stat block.

It is live at **https://creaturecauldron.com**. It is open to everyone: no accounts, no sign-in, no cookies.

### The one idea that shapes everything

**The AI writes words; code does every number.** Claude Haiku is asked for names, descriptions and the occasional structured draft, and everything it returns is checked by
plain deterministic code (the validator) before anyone sees it. For reskins, the AI never sees or sets a hit point, damage die, DC or bonus at all. Everything else in the
design (the cache, the caps, the retry loop, the estimator) follows from not trusting a language model with arithmetic or with the owner's money.

---

## 2. The system at a glance

```
visitor's browser
   ├── https://creaturecauldron.com        Cloudflare Pages: the React page (static files)
   │        └── library JSON (939 monsters) is read from the same place
   └── https://api.creaturecauldron.com    Cloudflare (proxy, rate rule) ──► Cloudflare Tunnel (outbound only)
                                              └─► the owner's Ubuntu 24.04 server: FastAPI on 127.0.0.1:8000 (systemd service)
                                                     ├── SQLite file: generated monsters, remembered reskins, daily usage
                                                     └── Anthropic API (Claude Haiku), only when a request needs words

the owner, from anywhere ──► Tailscale (private VPN) ──► SSH (keys only) into the same server
```

| Part | Technology | Where it runs | Where the code is |
|---|---|---|---|
| Front end | React 19, TypeScript 7, Vite 8, Vitest 5 | Cloudflare Pages | `frontend/` |
| Back end | Python 3.12+, FastAPI, Pydantic 2, SQLite, the Anthropic SDK | Home server (systemd) | `backend/` |
| Model | Claude Haiku (`claude-haiku-5-5`, setting `CAULDRON_MODEL`) | Anthropic | `backend/src/cauldron/service/haiku.py` |
| Edge | Cloudflare DNS, proxy, Tunnel (`cloudflared`), one rate-limit rule | Cloudflare | dashboard (see DEPLOYMENT.md) |
| Admin access | Tailscale (WireGuard mesh VPN), OpenSSH with keys only | Server and laptop | `deploy/setup-ssh.sh` |
| Deployment files | systemd units, backup script | `/etc/systemd/system`, `/opt/DndPortfolio` | `deploy/` |

Two properties are worth stating plainly:

1. **The page works without the server.** The library, filters, party, encounters and exports are all in the browser. Only Generate, Reskin, Reflavor and Polymorph need the
   server; if it is unreachable the page says so and everything else carries on.
2. **Nothing a visitor types reaches the model.** Visitors choose from fixed lists. The only free text in any prompt is the validator's own feedback from the previous attempt,
   and that is shortened, put on one line and limited in number first (`service/prompts.py`).

---

## 3. Repository layout

```
creature-cauldron/
├── README.md                 status and quick start
├── LICENSE, LICENSES.md      MIT for the code; the monster data's licences and credits
├── docs/                     this document and its companions
├── frontend/                 the page
│   ├── src/App.tsx           the one-page layout and all the state
│   ├── src/components/       panels, filter bar, stat block, reskin panel, dialogs
│   ├── src/lib/              all logic that is not drawing: filters, encounters, exports, generator clients, storage
│   ├── src/types/monster.ts  the monster schema as TypeScript types
│   └── public/               data/*.json (the library), legal/ (licences page, OGL text), images/, _headers
├── backend/
│   ├── src/cauldron/         the Python package (see section 5)
│   ├── data/                 SRD source data, A5E source data, import reports
│   └── tests/                the back-end tests (41 files)
└── deploy/                   systemd service and timer, backup script, SSH helper, secrets template
```

The portfolio site that links to it lives one level up (the repository root: `index.html`, `content/`, `assets/`, `js/`).

---

## 4. The monster model

One schema describes every monster in both languages: Pydantic models in `backend/src/cauldron/monster.py` and `actions.py`, and matching types in
`frontend/src/types/monster.ts`. Every model forbids unknown fields (`base.py`), so a typo or an invented field is an error, not a silent addition.

**Identity and provenance.** `id`, `schema_version`, `name`, `source` (`sample`, `srd`, `a5e`, `ai`, `reskin`), `validated`, `parent_id` (what a reskin came from),
`generator` (the model's name), `attribution` (the exact credit text), `changes` (the plain-words "What changed" list of a reskin).

**The stat block.** Size, type, subtypes, alignment, armor class (with its note), hit points (average and dice), speeds, six ability scores (1 to 40; see the cap note below),
saves, skills, vulnerabilities, resistances, immunities, condition immunities, senses, languages, challenge (`cr`, `cr_value`, `xp`, `proficiency_bonus`), traits, actions,
bonus actions, reactions, legendary actions, spellcasting.

**Actions are a class hierarchy, not strings.** `actions.py` defines an abstract `Action` with four subclasses, each writing its own stat-block prose:

| Class | Holds | Why typed |
|---|---|---|
| `AttackAction` | melee or ranged, to-hit bonus, reach or range, damage dice and type(s) | The displayed numbers always match the stored dice and bonus |
| `SaveAction` | ability, DC, damage on a failure, half or none on success, area, recharge | Same |
| `MultiattackAction` | the attacks and how many of each | The CR measure prices the monster from it |
| `TextAction` | free text (and, if present, structured damage for pricing) | Anything unusual; unparseable imports degrade to this |

The page and the server render action text with the *same wording*. `tests/fixtures/rendered-actions.json` is written by the front end's `crossLanguage.test.ts` and read by
a Python test, so if the two ever disagree, a test fails. After an intentional wording change, regenerate with `npx vitest run -u` in `frontend/`, then run the back-end tests.

**Spellcasting is data**, not just text: cantrips, slots per level, at-will and per-day lists, and the intro sentence. The stat-block sentence and the 5etools export are both
built from it.

**Discovery tags** (`environments`, `role`, `damage_themes`, `features`) power the filters. The `features` are *derived by code* (`features.py`) from the stat block and never
trusted from the AI.

**The ability score cap.** The schema allows 1 to 40 because some published creatures pass 30. A monster the *forge* makes is corrected down to 30 (`AbilityScoreCheck` in the
validator); published monsters keep theirs.

**Option lists** (sizes, types, environments, roles, damage types and themes, features) are enums in `options.py`, mirrored in `frontend/src/lib/options.ts`. The two must match; tests check the cases that matter (for example `test_menu_matches_frontend.py` for Remix moves).

---

## 5. The back end, module by module

All code is in `backend/src/cauldron/`. It was built test-first; the back-end suite has 905 tests at launch.

### 5.1 Rules and validation

| Module | Job |
|---|---|
| `rules.py` | SRD 5.1 tables only: XP and proficiency bonus by CR, hit die by size, the CR ladder (`CR_LABELS`: 0, 1/8, 1/4, 1/2, 1 ... 30), and the exact credit texts (`SRD_ATTRIBUTION`, `A5E_ATTRIBUTION`, `combined_credit`) |
| `dice.py` | Parse dice expressions, averages, ability modifiers, signed formatting |
| `blocklist.py` | A deliberately cautious list of names that are not ours to use (publisher product-identity monsters, famous named characters and places). Applied to every generated or imported name |
| `features.py` | Derives the feature tags from the stat block |
| `validator.py` | The validator (below) |
| `templates.py` | `swap_damage_type`, `LevelUpTemplate`, `retarget_name` (rewrite the old name inside text to the new name) |

**The validator** is an abstract `Check` class with one subclass per rule, and a `Validator` that runs the list over a *copy* of the monster. Checks never mutate their input;
each returns a corrected copy and findings. Outcomes: `CORRECTED` (a number was fixed), `NOTED` (a difference left as printed, used for official monsters), `RETRY` (the numbers
disagree with the claimed CR; the generator should try again), `REJECT`. The checks:

| Check | Rule |
|---|---|
| `NameCheck` | Not on the blocklist; not a duplicate |
| `DerivedFieldsCheck` | Proficiency bonus and XP from the CR; ability modifiers |
| `AbilityScoreCheck` | Scores above 30 corrected on a made monster |
| `HitPointsCheck` | Die type follows size; average matches dice and Constitution modifier |
| `AttackBonusCheck` | Proficiency + the stated ability; 0 to 3 above is tolerated (magic, level-up) |
| `SaveDcCheck` | 8 + proficiency + ability; the same tolerance; any ability that reaches the DC is accepted |
| `SpellcastingCheck` | Spell numbers |
| `LegendaryCheck` | Count and costs are sensible (at most 3 a round) |
| `FeaturesCheck` | Tags match what the stat block contains |
| `CrConsistencyCheck` | The estimated CR is within a per-band tolerance of the claimed CR; outside it, `RETRY` |
| `AttributionCheck` | An SRD or A5E monster carries its exact credit; a derived monster may carry either or both |

Official SRD and A5E monsters are never "corrected": differences are reported as notes and the printed numbers stay. Reskins use a validator with the CR check removed
(`GenerationService._reskin_validator`), because in a reskin the AI changes no number, so a doubt about the base monster's CR is not its fault.

### 5.2 The challenge-rating estimator (`cr/`)

The usual way to check a monster's CR uses the Dungeon Master's Guide table "Monster Statistics by Challenge Rating", which is not in the SRD 5.1 (checked), so it is not used.
Instead the estimator is calibrated from the 333 SRD monsters themselves:

1. `measure.py` measures each monster: effective hit points, armor class, damage per round, offensive bonus (best attack bonus or save DC). It is the measure that "prices" a
   monster, so how Multiattack is typed matters (see A5E.md).
2. `curves.py` fits a never-decreasing (isotonic) curve for each measure across the CR ladder.
3. `calibrate.py` (`python -m cauldron.cr.calibrate`) writes `calibration_table.py`, including leave-one-out accuracy.
4. `estimator.py` reads a monster back against the curves: it finds where its effective hit points and its damage fall on the ladder (armor class and offensive bonus act as
   adjustments), averages the two positions and rounds.

Measured accuracy (each SRD monster estimated from curves built without it): mean error 0.85 steps; within 1 step 83%, within 2 steps 92%. It is sharp at low CR (CR 0 to 4: 97%
within 1 step) and weak in the middle (CR 5 to 10: 55%; CR 11 to 17: 58%). So the validator's tolerance is **per band**, chosen so about 90% of SRD monsters fall inside it: 1 step
up to CR 4, 4 steps for CR 5 to 17, 3 for CR 18+. The SRD has almost nothing above CR 17, so above that the estimate is extrapolation and the check only leaves a note; this is
one reason generation is capped at CR 17. It ignores spells, flight, auras and other traits that change real CR. **It is a sanity check, not a rating authority.**

**Why it stays SRD-only.** Experiments with smoother curves, with Black Flag SRD data and with the A5E monsters did not beat the plain SRD isotonic fit by more than noise (table in
A5E.md). A5E uses its own CR scale and the SRD-calibrated estimator agrees with A5E's CRs within one step only 70% of the time, so mixing them was not worth it. A5E monsters
are labelled as following A5E's numbers.

### 5.3 The remix package (`remix/`)

Full detail is in [REMIX.md](REMIX.md); the shape is:

| Module | Job |
|---|---|
| `theme.py` | `apply_theme`: change the main damage type, trade or add the matching resistance, add a vulnerability from a fixed table (10 themes) |
| `moves.py` | The 18 signature moves, each a `Move` subclass that builds typed actions from the monster's own numbers (`Context`: DC, attack bonus, damage budget = 75% of its best attack) |
| `engine.py` | `remix()` composes theme, move and level up; `resolve()` turns "surprise" into a definite choice using a random generator that is passed in |
| `reflavor.py` | Decides which AI-proposed ability renames are applied (only abilities the monster really has, 40 characters at most, not blocklisted, no collisions); keeps Multiattack and legendary text in step |
| `graft.py` | Polymorph: `borrowable()` lists what a donor could lend (keys such as `speed:fly`, `sense:darkvision`, `damage`, `trait:<name>`, `attack:<name>`); `graft()` applies the chosen keys and fits borrowed numbers to the base; builds or borrows legendary actions |

Invariants that tests enforce across the whole library: a remix or polymorph produces a valid monster, adds no new validator complaint, and stays within one CR step of the base
by the estimator (two for the Purple Worm). The remix sweep runs every move on all 353 original monsters (6,038 remixes); the graft test runs 2,500 random pairs.

### 5.4 The seed pipeline (`seed/`)

Builds the static library from source data. Run with `python -m cauldron.seed` (SRD) and `python -m cauldron.seed.a5e` (A5E).

- **SRD:** the 333 monsters come from a community copy of the SRD data (5e-bits, MIT; provenance in `data/srd-2014/SOURCE.md`), cross-checked against the official document. `importer.py`
  converts each, `action_parser.py` and `spells.py` turn text into typed actions and spellcasting data, `damage.py` handles damage lines, `tagger.py` guesses environments and roles with
  rules, `corrections.py` holds known fixes, and `report.py` writes `data/srd-import-report.md`. Most SRD saving-throw actions and many attack riders stay word-for-word text, because the
  typed forms cannot reproduce the SRD's wording exactly.
- **A5E:** `seed/a5e.py` slims and converts 586 Open5e records into the SRD data shape and reuses the same importer. Details, the Multiattack rule (174 typed, 101 left as prose),
  naming ("Name (A5E)" for 292 clashes) and the text repairs are in A5E.md.
- Output goes to `frontend/public/data/` (`srd-monsters.json`, `a5e-monsters.json`, with `sample-monsters.json` hand-written). The **server loads the same files**, so every
  library monster can be reskinned, polymorphed and used as a donor.

### 5.5 The service (`service/`)

| Module | Job |
|---|---|
| `settings.py` | All settings from `CAULDRON_*` environment variables, validated at start (a bad value stops the server with a message naming the variable). The API key is deliberately not here |
| `models.py` | Request and response messages: `GenerateRequest`, `ReskinRequest` (theme, damage_only, move, level_up, reflavor, donor_id, borrow, forge_chooses, legendary), `GraftOptionsRequest`, failure shape; `cache_key` and `has_surprise` |
| `matching.py`, `store.py` | Find stored monsters that fit a request; the SQLite store |
| `brief.py` | Fills every gap in a generate request at random (from fixed lists) so repeated requests vary; `effective_bounds` caps the CR |
| `prompts.py`, `draft.py` | What the model is asked and what it is allowed to fill in (`MonsterDraft`, `NameDraft` and variants) |
| `generators.py`, `haiku.py` | The abstract `MonsterGenerator` (and a scripted fake used by tests) and the real Haiku generator |
| `limits.py` | `RateLimiter` (sliding window per visitor), `DailyCap` (database-backed), `client_address` (finding who is asking) |
| `service.py` | `GenerationService`: cache first, then the AI with a retry loop |
| `app.py` | FastAPI endpoints, CORS, error shapes |
| `main.py`, `__main__.py` | Build the app from the environment and run it with uvicorn |
| `smoke.py` | A real-key check (below) |

#### The API

All under `/api/v1`:

| Endpoint | In | Out | Cost |
|---|---|---|---|
| `GET /health` | | `{"status": "ok" or "resting"}` | free |
| `GET /library` | | every monster the forge has generated | free (limited like other free answers) |
| `POST /generate` | filters (CR bounds, types, sizes, environments, roles, damage themes, features, `excludeIds`) | a monster or a failure | cache hit free; otherwise 1 to 3 AI calls |
| `POST /reskin` | `baseId` plus a reflavor, or a theme/move/levelUp (remix), or a donor plus `borrow` or `forgeChooses` (polymorph) | a monster or a failure | cache hit free; otherwise 1 to 3 AI calls |
| `POST /graft/options` | `baseId`, `donorId` | what the donor could lend | free (no AI) |

Request bodies are limited to 64,000 bytes and must declare their length (411/413 otherwise).

**Failures always have one shape:** `{"ok": false, "reason": ..., "message": ...}`. The HTTP status says the same thing for anything else that reads it:

| Reason | Status | Meaning |
|---|---|---|
| `invalid` | 422 | The request was not valid, or asked for something impossible |
| `rate-limited` | 429 | Slow down (`Retry-After` header set) |
| `resting` / `offline` | 503 | The daily allowance is used up, or the forge is switched off |
| `error` | **424** | The AI could not be reached, or gave up after its retries. Also 500 for an unexpected crash |

**Why 424 and not 502.** Cloudflare sits in front of the server and replaces any 502 or 504 from the origin with its own plain error page. That page carries no CORS headers, so the
browser hides it and the visitor would see "can't reach the server" instead of the real message. A status Cloudflare passes through (424) keeps the server's message intact. The page
also reads the message from the body whatever the status. This was found on launch day and is covered by tests.

#### The request flow (generate)

1. **Limit.** `cache_limiter` (30 requests a minute per visitor) applies to everything.
2. **Cache.** `lookup` finds stored monsters that fit the filters and that this visitor does not already have (`excludeIds`) and returns a random one. Free.
3. **Resting?** If the day's allowance is used up, answer 503.
4. **AI limit.** `ai_limiter` (3 a minute, 10 an hour per visitor) applies only to requests that will spend money.
5. **Brief.** Fill the gaps at random; cap the CR (default 17).
6. **Attempt loop** (`_attempts`): each attempt first takes one call from the daily cap, then asks Haiku. The reply is parsed against the schema, run through the validator, and checked
   that it actually fits what was asked (`matching.mismatches`). If anything complains, the complaints go back to the model as feedback and it tries again, up to `max_retries`
   (2) more times: three attempts at most. Every reply is billed whether or not it was usable, so tokens are recorded even for failures.
7. **Store.** An accepted monster is added to SQLite (names unique ignoring case and spacing) and becomes part of the shared library.

Reskins follow the same loop with a different draft: code shapes the numbers first (`_shape`), a preview supplies the new CR and the change list to the prompt, the model returns
a name and description (plus a move name, ability renames, polymorph picks or legendary names where asked), code rebuilds with the real names, retargets mentions of the old name,
validates, stores, and remembers the answer under a cache key.

#### How the model is called (`haiku.py`)

- One user message; the model must answer by **calling a tool** whose input schema is the draft (`submit_monster` or `submit_name`). `tool_choice` forces the call, so the reply is
  data, not prose.
- The reply is validated with Pydantic. Anything wrong becomes `BadOutput` with a short reason (at most 4 reasons, 160 characters each), which is sent back on the next attempt.
  A `refusal` or `max_tokens` stop reason is handled the same way.
- Not sent, on purpose: temperature, top_p, top_k, thinking settings, assistant prefill (Haiku 5.5 refuses them).
- The SDK retries connection errors and 429/5xx twice on its own, with a 90-second timeout so a stuck call cannot hold a worker thread forever.
- A failed call logs only the *type* of failure and the request id; visitors get a fixed generic message. The key is read by the SDK from `ANTHROPIC_API_KEY` and is never stored,
  logged or placed in a setting. If no key is set, the server starts anyway and answers "the forge could not be reached" for anything needing the AI.

**Observed at launch (smoke test 1):** the first attempt was rejected with `actions.N: Unable to extract tag using discriminator 'kind'`: the model left out the `kind` label
that tells the schema whether an action is an attack, a save, a multiattack or text. The retry fixed it, so that generation cost two calls (about $0.003) instead of one. This is
the retry loop working as designed, but it is also the most likely early improvement: a clearer instruction in the prompt about the `kind` field would save a call per occurrence.
The smoke tests for Remix, Reflavor and Polymorph each succeeded on the first call (about $0.0002 each).

#### Spend protection, in layers

| Layer | Setting | Default / launch value |
|---|---|---|
| Cache first | | free answers for any request already made |
| Cloudflare rate rule | one rule on `/api/v1/` | block an address over 20 requests in 10 seconds |
| Per-visitor AI limit | `CAULDRON_IP_PER_MINUTE`, `CAULDRON_IP_PER_HOUR` | 3 and 10 |
| Per-visitor free limit | `CAULDRON_CACHE_PER_MINUTE` | 30 |
| Daily cap on AI calls | `CAULDRON_DAILY_CAP` | code default 150; **the service file sets 100** (under 20 cents a day at worst, retries included). Resets at midnight UTC. Stored in the database, so it survives restarts |
| Retries | `CAULDRON_MAX_RETRIES` | 2 |
| Highest CR generated | `CAULDRON_MAX_CR` | 17 |
| Output length | `CAULDRON_MAX_OUTPUT_TOKENS` | 4000 |
| Request size | | 64,000 bytes |
| Console monthly spend limit | Anthropic Console | set by the owner; the hard stop |

Typical real cost (launch smoke tests): a generated monster about $0.003; a remix, reflavor or polymorph about $0.0002.

Who is "a visitor": `client_address` in `limits.py`. Behind the tunnel every request arrives from the tunnel program, so the service believes the `CF-Connecting-IP` header, but only
because `CAULDRON_TRUSTED_PROXY_HEADER=CF-Connecting-IP` is set and the app listens on `127.0.0.1` only. An IPv6 visitor is counted by their **/64 prefix** (one home connection owns
billions of addresses); an IPv4-mapped IPv6 address is counted by its IPv4 address. Limiter memory is bounded (`max_keys`) and is cleared on restart.

#### The database

SQLite, one file (`/var/lib/cauldron/cauldron.sqlite3` on the server), WAL mode, one connection guarded by a re-entrant lock, foreign keys on, 5-second busy timeout, every
value passed through `?` placeholders, every change inside a transaction.

| Table | Holds |
|---|---|
| `monsters` | `id`, `name_key` (unique), the monster as JSON, and indexed `cr_value`, `type`, `size`, `role` for narrowing searches |
| `ai_usage` | per UTC day: `calls`, `input_tokens`, `output_tokens` |
| `reskins` | `key` to `monster_id`: remembered reskins. A reflavor has no choices, so a monster's reflavors are numbered variants under `reflavor:<base id>:<n>` |

Rules about what is remembered: the same explicit choices give the same monster (free). A **Surprise me** is settled by the server *before* the lookup, so the decided outcome is
cached but every visitor does not get the same surprise. A **forge chooses** polymorph is never cached. A monster keeps at most **3 reflavors** (`MAX_REFLAVORS`); until then each
press is a new AI call, after that a press returns one of the three at random for free.

---

## 6. The front end

A single-page React app. On a desktop it fits one page with no scrolling: party and difficulty across the top, a filter bar, then boxes for results, the encounter and saved
encounters. On phones it stacks and scrolls. It has a dark "witch's cauldron" look (fonts: Cinzel, Cinzel Decorative, Alegreya, MedievalSharp, Pirata One, installed as npm packages
so nothing loads from a font service), with a light/dark theme toggle.

| Area | Files | Notes |
|---|---|---|
| State and layout | `App.tsx` | Holds the library, filters, party, encounters; everything else is props |
| Filtering | `lib/filters.ts`, `components/FilterBar.tsx` | AND across filters; OR within a multi-value filter; **features use AND**; includes the Source filter |
| Difficulty | `lib/party.ts`, `lib/encounter.ts` | 2014 DMG encounter method: XP thresholds, count multipliers, party-size adjustment; a monster is rated alone for the CR band |
| Stat block | `components/StatBlock.tsx`, `StatBlock.css`, `StatBlockDialog.tsx` | Renders from structured data; print CSS; the dialog shows the Reskin panel and the "What changed" list |
| Reskin panel | `components/ReskinPanel.tsx`, `lib/remixMoves.ts` | Reflavor button; Remix tab; Polymorph tab with the donor's borrow list |
| Generator access | `lib/generatorApi.ts` (the contract), `liveGenerator.ts` (talks to the server), `demoGenerator.ts` (stand-in), `sharedLibrary.ts` | See below |
| Exports | `lib/exportJson.ts`, `foundry*.ts`, `fiveTools*.ts`, `exportCommon.ts`, `download.ts` | See EXPORTS.md |
| Storage | `lib/storage.ts`, `usePersistentState.ts`, `generatedStore.ts` | `localStorage` keys `creature-cauldron:party`, `:favorites`, `:encounter`, `:saved-encounters`, `:generated`, `:theme` |
| Credits | `lib/attribution.ts`, `lib/sourceLabel.ts`, footer in `App.tsx` | SRD and A5E credits, source labels |

**Three generator modes, one contract.** The page only ever talks to the interface in `generatorApi.ts`:

- **Live** (`VITE_API_URL` set at build time): `liveGenerator.ts` calls the Python service. The address is baked into the build, never read from the page's own address.
  `frontend/.env.production` sets `https://api.creaturecauldron.com`; `.env.development` sets `http://127.0.0.1:8000` (the numeric address on purpose: some browsers turn
  `localhost` into the IPv6 address while the service listens on the IPv4 one). The live client de-duplicates and caps what it sends (one donor per name, at most 10 borrow ticks, at
  most 100 options read) and shows the server's own `message` for any failure whatever the status.
- **Offline** (no address): the buttons answer "Generator offline: the library still works."
- **Demo** (`?generator=demo`): returns renamed copies of library monsters and applies only the damage swap, so the whole flow can be clicked through with no server and no cost.

If the server cannot be reached, the page falls back to the built-in monsters and says so in a small note. Generated and reskinned monsters are marked *unvalidated* in the page and
kept in the browser; a monster the server stored comes back in its shared library and is shown to every visitor.

**Security headers** (`frontend/public/_headers`, sent by Cloudflare Pages): a strict Content-Security-Policy (own files only; `connect-src` allows `self` and
`https://api.creaturecauldron.com` and nothing else; no frames, no objects), `nosniff`, a strict referrer policy, and camera, microphone, geolocation and payment switched off. The
CSP was checked against the built page with no violations. Any new third-party script, font or API host needs a CSP change.

**Build and test.** `npm run dev` (port 5199, strict, because the server's CORS list names the page address), `npm run build` (type-checks, then builds to `dist`), `npm test`
(653 tests at launch).

---

## 7. Licences and credits

Summarised here; the authority is `LICENSES.md` and `frontend/public/legal/`.

- **Code:** MIT.
- **SRD 5.1 monsters:** Creative Commons Attribution 4.0. The exact credit text (`SRD_ATTRIBUTION`) travels with every SRD monster, is shown in the page footer and under each stat
  block, is exported (the 5etools file carries it as fluff), and is required by `AttributionCheck`. Misquoting it is a rejection.
- **A5E Monstrous Menagerie monsters:** used under the Open Game License v1.0a (Open5e labels the book OGL 1.0a only). The A5E credit (`A5E_ATTRIBUTION`) works the same way, the
  OGL text and a Section 15 notice are in `frontend/public/legal/`, and `test_legal.py` keeps the credits identical in code and in the legal page, keeps the licence text whole and
  Section 15 complete. No art, logos or lore text are included. A monster derived from both an SRD base and an A5E donor carries both credits (`combined_credit`).
- **Monsters Creature Cauldron makes** carry the credits of whatever they derive from; fully generated monsters are original and checked against the name blocklist.
- **Test fixtures** copied from other projects (Foundry's dnd5e system data, 5etools data) are CC-BY-4.0 and carry their own provenance notes.
- **Not included, deliberately:** Tome of Beasts, Creature Codex and similar third-party monster books (their licences and the liability of including them were weighed and rejected);
  Black Flag (it added no independent data); anything from the Monster Manual or other non-SRD books; Roll20 export (every import route depends on third-party scripts that can
  endanger a user's account).

---

## 8. Running it locally

Back end (Python 3.12 or newer):

```bash
cd backend
python -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"     # Windows: .venv\Scripts\python
.venv/bin/python -m pytest -q                   # 905 pass, 2 skipped at launch
.venv/bin/python -m cauldron.service            # the server on http://127.0.0.1:8000
```

Front end (Node 22):

```bash
cd frontend
npm install
npm run dev        # http://localhost:5199
npm test
npm run build
```

Without `ANTHROPIC_API_KEY` the server starts and everything that does not need the model works. To spend real (tiny) money on a check:

```bash
export ANTHROPIC_API_KEY=...   # in this terminal only; never write it to a file in the project
.venv/bin/python -m cauldron.service.smoke --yes              # one real generation
.venv/bin/python -m cauldron.service.smoke --yes --remix      # options --base, --theme, --move
.venv/bin/python -m cauldron.service.smoke --yes --reflavor
.venv/bin/python -m cauldron.service.smoke --yes --polymorph  # option --donor (default srd-giant-eagle)
```

`smoke.py` refuses to run without `--yes`, uses a throwaway in-memory database, prints what it spent, and prints any rejected attempts as `[log]` lines.

---

## 9. The production server

Everything here is described step by step in [DEPLOYMENT.md](DEPLOYMENT.md); this is the map.

**Where things are on the server (Ubuntu 24.04, host `plexserver`):**

| What | Path |
|---|---|
| Repository | `/opt/DndPortfolio` |
| Python environment | `/opt/DndPortfolio/creature-cauldron/backend/.venv` |
| Database | `/var/lib/cauldron/cauldron.sqlite3` |
| Backups | `/var/lib/cauldron/backups` (a copy every night at 03:00; the newest 14 are kept) |
| Secrets (the API key) | `/etc/cauldron/secrets.env` (root-only) |
| Service units | `/etc/systemd/system/creature-cauldron.service`, `cauldron-backup.service`, `cauldron-backup.timer` |
| Tunnel | the `cloudflared` systemd service (installed with a token from the Cloudflare dashboard) |
| SSH backups made before hardening | `/etc/ssh.backup`, `~/.ssh/authorized_keys.backup` |

**The service** (`deploy/creature-cauldron.service`) runs as an unprivileged `cauldron` user, listens on `127.0.0.1:8000` only, restarts itself after 5 seconds, logs to the
journal, and is locked down: `NoNewPrivileges`, `PrivateTmp`, `PrivateDevices`, `ProtectSystem=strict` (read-only system), `ProtectHome`, kernel and control-group protection, only
network address families, `MemoryMax=1G`, and `/var/lib/cauldron` as the only writable place. Production settings (allowed origin, trusted proxy header, daily cap, database path)
are in the unit; the secrets file is read afterwards by systemd, as root, so the app's own user can never open it, and it may override any of them.

**The backup** (`deploy/backup_db.py`) uses SQLite's own backup call, so the copy is consistent while the app is writing. It finds the database the server uses (it honours
`CAULDRON_DATABASE`). Copy the backup folder somewhere that is not the server once in a while.

**Remote access.** The owner reaches the server by SSH over Tailscale (a private WireGuard network), with keys only: `deploy/setup-ssh.sh` installs the key and, with `--lock`,
turns passwords off (it refuses unless a usable key exists, so it cannot lock the owner out; `--unlock` reverses it). On Ubuntu 24.04 SSH is started by a socket
(`ssh.socket` enabled, `ssh.service` showing disabled is normal).

**Cloudflare:** Pages for the page (root directory `creature-cauldron/frontend`, build `npm ci && npm run build`, output `dist`, `NODE_VERSION` 22; every push rebuilds); the
`creaturecauldron.com` zone with Always Use HTTPS, minimum TLS 1.2, a redirect from `www`, one rate-limit rule on `/api/v1/`; the Tunnel with the public hostname
`api.creaturecauldron.com` pointing at `http://127.0.0.1:8000` (use the numbers, not `localhost`). The server's CORS list allows only `https://creaturecauldron.com`, so Pages
preview addresses can show the library but cannot call the server. That is intended.

**Uptime:** a monitor watches `https://api.creaturecauldron.com/api/v1/health` and emails the owner if it stops answering.

---

## 10. Runbook

### Update the server after a push

```bash
cd /opt/DndPortfolio && sudo git pull
cd creature-cauldron/backend && sudo .venv/bin/python -m pip install -e .
sudo systemctl restart creature-cauldron
```

New monster files arrive with the pull; the app reads them at start, so the restart is required. Page changes need only a push (Cloudflare rebuilds).

### Check health

```bash
systemctl status creature-cauldron cloudflared --no-pager
journalctl -u creature-cauldron -n 50
curl http://127.0.0.1:8000/api/v1/health         # on the server: {"status":"ok"}
```

From any browser: `https://api.creaturecauldron.com/api/v1/health`.

### Rotate or replace the API key

1. Create a new key in the Anthropic Console workspace that has the spend limit.
2. `sudo nano /etc/cauldron/secrets.env`; set `ANTHROPIC_API_KEY=` to the new key (no quotes, no spaces); save.
3. `sudo systemctl restart creature-cauldron`.
4. Revoke the old key in the Console.

Never paste a key into a chat, a ticket, the repository or a screenshot. If one leaks, revoke it first and replace it second. The service tolerates a quoted key and a stray
byte-order mark, and logs a warning (never the key) if the value does not start with `sk-ant-`.

### Take generation offline at once

`sudo systemctl stop cloudflared` (the page keeps working from Cloudflare Pages, without generation), or `sudo systemctl stop creature-cauldron`.

### Costs look wrong

Lower `CAULDRON_DAILY_CAP` in the secrets file and restart; the Console limit remains the hard stop. Per-day usage is in the `ai_usage` table.

### Restore the database

Stop the service, copy a file from `/var/lib/cauldron/backups` over `/var/lib/cauldron/cauldron.sqlite3` (keep the old one aside first), make sure it is owned by `cauldron`, start the
service. A deleted database is not a disaster: the library is static; only the monsters the forge made are lost. A flawed old reskin persists until the database is deleted (stop
the server first).

### Add a signature move

Add a `Move` subclass in `remix/moves.py` and append it to `MOVES`; add its row to `frontend/src/lib/remixMoves.ts` (same key, label, group, blurb, flags); run the back-end
tests. The menu test and the all-monsters sweep will name anything that breaks.

### Add or refresh monster data

`python -m cauldron.seed` (SRD) and `python -m cauldron.seed.a5e` (A5E) rewrite the JSON files in `frontend/public/data/` and the import reports. After changing the data, regenerate
the CR calibration only if the *trusted* set changed (`python -m cauldron.cr.calibrate`), and run both test suites.

### Change a stat-block sentence

Edit the renderer on both sides (`actions.py` and `lib/renderAction.ts`), then `npx vitest run -u` in `frontend/`, then the back-end tests.

---

## 11. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Page says "Can't reach the generator server just now" | The service is down, the tunnel is down, or the page was built without `VITE_API_URL` | On the server `curl http://127.0.0.1:8000/api/v1/health`; if that works check `systemctl status cloudflared` and the tunnel in Zero Trust |
| The page shows Cloudflare's own error page text, or a CORS error in the console, for an AI failure | An origin 502 or 504 was replaced by Cloudflare | The server now answers 424 for this; if it recurs, check no new code returns 502/504 |
| Everyone is told to "slow down" | The visitor-address header is not arriving, so all visitors share one bucket | The app must be reached only through the tunnel, and the unit must set `CAULDRON_TRUSTED_PROXY_HEADER=CF-Connecting-IP` |
| "The forge is resting, back tomorrow" | The daily cap is used up | It resets at midnight UTC; the library keeps working. Raise `CAULDRON_DAILY_CAP` only if the Console limit allows |
| Generate always fails with "could not be reached" | No key, a wrong key (401), or the Anthropic API is down | `journalctl -u creature-cauldron` shows `Anthropic call failed: <type>`; check the secrets file and its warning |
| Generate sometimes takes twice as long and costs two calls | The first attempt failed the schema or the validator; the retry loop fixed it (see the `kind` note in section 5.5) | Normal; the journal shows `generate attempt 1 of 3 was not accepted: ...`. Frequent failures mean the prompt needs work |
| A reskin "does nothing" after an update | The old server process is still running (it rejects new request fields with 422) | `sudo systemctl restart creature-cauldron` |
| Reflavor returns the same few names | A monster keeps at most 3 reflavors; after that it hands one back | By design (free for the visitor, free for the owner) |
| Dev page cannot reach a local server | Page not on port 5199 or 5173, or `VITE_API_URL` uses `localhost` | Use `http://127.0.0.1:8000`; check `CAULDRON_ALLOWED_ORIGINS` |
| App will not start | A mistyped setting | `journalctl -u creature-cauldron -n 50`; the message names the variable |
| Cannot SSH in from outside | Tailscale offline, SSH socket down, firewall | Tailscale app and `tailscale status`; `systemctl status ssh.socket`; `sudo ufw status` (if the firewall is on) |
| Backups missing | The timer is not enabled | `systemctl list-timers cauldron-backup.timer`; `sudo systemctl start cauldron-backup`; look in `/var/lib/cauldron/backups` |

---

## 12. Decisions and the reasons for them

| Decision | Reason |
|---|---|
| AI writes words, code writes numbers | Language models are unreliable at arithmetic and balance; the validator can check numbers deterministically, and a reskin the AI cannot affect numerically cannot unbalance the game |
| Structured filters only; no typed prompts | No visitor text can reach the model, so no prompt injection from visitors, and every request is cacheable |
| Cache first, forever | The cheapest AI call is the one never made; every generated monster becomes shared library content |
| A daily cap stored in the database | A hard ceiling on spend that survives restarts and cannot be beaten by many visitors at once |
| A tool call with a schema, not free text | The reply is data that can be validated; there is nothing else for the model to say |
| Retry with the complaints as feedback | Most failures are small (a missing label, a number out of tolerance) and one more attempt fixes them cheaply |
| An estimator calibrated on the SRD | The official CR table is not in the SRD; the SRD monsters are the only trusted, freely usable data. It is explicitly a rough check with per-band tolerances |
| The estimator stays SRD-only | Experiments adding Black Flag, A5E or smoothing did not help beyond noise |
| A5E labelled and kept out of calibration | Its CR scale differs; mixing scales would blur the estimator |
| Tunnel plus loopback-only app | No inbound port is open at home; the home address is never exposed; the header trust is safe because there is no other door |
| Tailscale and key-only SSH | A true VPN for the owner without opening anything on the router |
| 424 for "the forge failed" | Cloudflare replaces 502/504 and hides the message |
| /64 counting for IPv6 | One home connection owns billions of addresses |
| Home Ubuntu server instead of a cloud VM | Free to run, under the owner's control; the cost is a single point of failure (see below) |
| Roll20 export dropped | Every route needs third-party scripts or extensions that can put a user's account at risk |
| The code is MIT; the data is credited under CC BY 4.0 and the OGL | Each source's own licence; credits are enforced by tests so they cannot drift |

---

## 13. Known limits and accepted risks

- **One server is one point of failure** (power, network, a bad update, disk). Mitigations: nightly backups, an uninterruptible power supply, `Restart=always`, an uptime monitor. The
  BIOS setting "restore on AC power loss" was not set at launch.
- **Spend ceiling for two paths.** A "let the forge choose" polymorph, and a reflavor of a monster with fewer than three reflavors, are never reused, so each press is a fresh AI call.
  The per-visitor limits, the daily cap and the Console limit are the ceiling; a handful of visitors can use up the day's allowance and put the forge in "resting" (the library keeps
  working).
- **The rate limit is per address** (per /64 for IPv6), so visitors on a shared network share a bucket. Limits reset on restart; the daily cap does not.
- **The estimator is a sanity check**, weak in the middle of the CR range and above CR 17; the validator's tolerance there is wide on purpose.
- **101 A5E Multiattacks stay prose** because a wrong count would price the creature wrongly, so the CR measure prices only the best single action for those.
- **A5E text** from Open5e lost most apostrophes ("the aboleths allies"); only the stock "spellcasting ability" phrase was restored. One immunity qualifier (the A5E Archmage's
  "psychic (with mind blank)") was dropped.
- **Several visitors pressing Reflavor at the same instant** can leave a monster with a fourth variant (harmless).
- **A donor made by the forge but missing from the database** (for example after the database is deleted) is still offered in the page until it refreshes; the server then says it does not
  know it.
- **The A5E Section 15 line** (copyright years of the printed book) should be matched against the printed book; the owner confirmed it before launch.
- **Python package versions are not locked.** The server runs `anthropic` 2.1.0 and `fastapi` 0.161.1, verified with the full test suite; `pyproject.toml` states minimums only. A lock
  file would make a rebuild reproducible.
- **Foundry export** is confirmed for D&D 5e system 5.3.3 on Foundry core 14.369; other versions may need the notes in EXPORTS.md.
- **Home-network hygiene noted at launch:** remote desktop was briefly forwarded to the internet and was removed (the log showed only failed attempts, the password was changed and the
  service disabled); a torrent client's web interface listens on all interfaces; the server firewall (ufw) was deliberately left off at launch. None of these is part of the app, but
  all are exposure on the same machine and are worth tidying.

---

## 14. How it was built (short history)

Built between 18 and 22 October 2026 as Artifact 3 of a D&D portfolio, in a fully agentic workflow with Claude Code: requirements first, then a front end against sample data and a
stubbed generator, then the Python rules engine and validator test-first, the SRD import, the web service with a scripted generator, the real Haiku generator, Remix, Reflavor,
Polymorph, the A5E import, two code reviews (the first on 21 October, the second with a security focus just before launch), the Linux deployment tooling and, on 22 October, the
launch itself. The portfolio's dev log has the day-by-day account; the code reviews record what each pass found and what was changed.

## 15. Where to start when changing something

| I want to... | Start in |
|---|---|
| Change what a generated monster looks like | `service/prompts.py`, `service/draft.py` |
| Change how strict validation is | `validator.py` (and the tolerance in `cr/estimator.py`) |
| Add a damage theme, move or borrowable feature | `remix/theme.py`, `remix/moves.py`, `remix/graft.py` (then the front-end copies) |
| Add a filter | `frontend/src/lib/filters.ts`, `components/FilterBar.tsx`, `options.ts` (and `cauldron/options.py` if it is a new list) |
| Add an export format | `frontend/src/lib/` (see how `fiveTools.ts` is built and tested with fixtures) |
| Change limits or the cap | `deploy/creature-cauldron.service` or the secrets file, then restart |
| Change the model | `CAULDRON_MODEL` (check the new model accepts the request shape in `haiku.py`) |
| Add a source of monsters | A new importer in `seed/`, a new `Source`, a credit in `rules.py` and the legal page, tests like `test_legal.py` |

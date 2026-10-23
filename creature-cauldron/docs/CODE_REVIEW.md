# Code review, 21 October 2026

A multi-agent review of the whole code base (about 23,000 lines, 14 areas plus 4 areas a critic added). Two independent
reviewers read each area; every finding was then checked by a skeptic who tried to disprove it (suspected bugs by two).
Low-severity style findings were listed but not individually verified.

- Reported: 311. Confirmed: 169. Confirmed and worth doing: 107.
- Rejected by the skeptics: 9. Unverified low-severity notes: 133 (last section).
- "Worth doing" means the fix is a net simplification or a real repair that keeps behaviour otherwise unchanged.

## Worth doing

### core-models

**Blocklist normalisation turns accented letters into spaces, so the canonical spelling "Faerûn" slips through (and all the work is redone per call)**  
`backend/src/cauldron/blocklist.py:64` · logic-error · medium

- Evidence: `_words` does `re.sub(r'[^a-z0-9&]+', ' ', text.lower())`, so `û` becomes a space. Verified: `blocked_term("Faerûn Guard")` returns None while `blocked_term("Faerun Guard")` returns "faerun" (the list only has the ASCII spelling). Separately, `blocked_term` re-sorts the whole frozenset and recomputes `_words(term)` for every term on every call (about 53 microseconds per name), although the terms never change.
- Fix: Fold accents first: `text = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))` at the top of `_words`. Precompute once at import: `_BLOCKED = tuple((term, _words(term)) for term in sorted(PRODUCT_IDENTITY_TERMS))` and make `blocked_term` loop over it. Add "Faerûn Guard" to the blocked-name test parameters.

### cr-estimator

**Unmatched multiattack names fall back to the best action of any kind, including a recharge breath weapon**  
`backend/src/cauldron/cr/measure.py:74` · logic-error · medium

- Evidence: `total = sum(by_name.get(entry.action.lower(), best_single) * entry.count ...)` where `best_single = max(by_name.values())` includes SaveAction and breath-weapon TextAction damage. Probed on the SRD: the Dragon Turtle's multiattack entry is 'Claws' x2 but the action is 'Claw', so the lookup misses and dpr = 26 (Bite) + 2 x 52 (Steam Breath) = 130 instead of 26 + 2 x 16 = 58, and it is estimated as CR 22 against a claimed CR 17. Vampire (Vampire Form) misses on 'Unarmed Strike (Vampire Form Only…
- Fix: Normalise names on both sides with one helper, for example `_key(name) = re.sub(r'\s*\(.*\)', '', name).lower().removesuffix('s')`, and use it for the `by_name` keys and the lookup. Make the fallback the best AttackAction damage (not best_single), so a missed name can never be priced as a once-per-few-rounds breath. Add a test using a monster whose multiattack says 'Claws'.

### gap-3

**_text_weights mis-counts when a bare mention precedes an amount-bearing one**  
`backend/src/cauldron/remix/theme.py:55` · logic-error · medium

- Evidence: `counted` is the number of amount matches, then `for kind in mentions[counted:]` skips the FIRST `counted` bare mentions, assuming amount matches come first. Ran: 'Fire damage is common. It deals 7 (2d6) cold damage.' returns {cold: 8.0} (cold double counted as 7+1, fire dropped).
- Fix: Do one pass with a single combined regex, e.g. re.compile(r"(?:(\d+) \([^)]*\) )?([a-z]+) damage"), and for each finditer match add int(amount) if present else 1. This removes the second regex, the `counted` offset and the two-pass logic.

### remix

**_text_weights drops or mis-credits damage when a bare mention comes before an amount**  
`backend/src/cauldron/remix/theme.py:55` · logic-error · medium

- Evidence: The code counts amount matches, then skips that many mentions: `for amount, kind in _AMOUNT_AND_TYPE.findall(lowered): ... counted += 1`, `mentions = [m for m in _TYPE_ONLY.findall(lowered) if m in _TYPES]`, `for kind in mentions[counted:]`. This assumes the amount-matches are the FIRST `counted` mentions in the text, which is false for 'Hit: 1 piercing damage plus 7 (3d4) poison damage.' I ran it on the SRD: Flying Snake gives {poison: 8.0} but should be {piercing: 1, poison: 7}. Poisonous Sna…
- Fix: Count each 'X damage' mention exactly once with a single regex that has an optional amount: `_DAMAGE_MENTION = re.compile(r"(?:(\d+) \([^)]*\) )?\b([a-z]+) damage\b")`, then `for amount, kind in _DAMAGE_MENTION.findall((text or '').lower()): if kind in _TYPES: weights[_TYPES[kind]] += int(amount) if amount else 1`. Delete `counted`, `mentions`, `_TYPE_ONLY` and `_AMOUNT_AND_TYPE`. I checked that this gives Flying Snake {piercing: 1, poison: 7}. Add a regression test with the Flying Snake bite text.

### seed

**Typed-save parsing matches zero SRD actions: about 50 lines, a regex, two lookup tables and two tests that never fire on real data**  
`backend/src/cauldron/seed/action_parser.py:144` · bloat · medium

- Evidence: I ran _SAVE.fullmatch over all 192 SRD actions and reactions that mention "saving throw" and none matched. No SRD action even starts with "Each creature in a" or "The target must make". The real wording is "The dragon exhales fire in a 60-foot cone. Each creature in that area must make..." or "Melee Spell Attack: ... The target must succeed on a DC 18...". The importer test pins this: test_importer.py:142 asserts `saves == 0`, with the comment "our typed save cannot reproduce exactly". The code…
- Fix: Delete `_try_save`, `_SAVE`, `_SHAPES`, `_ABILITY_BY_NAME` and the now-unused imports. In parse_action, drop the `_try_save` call and keep `typed = _try_attack(...)` only. Delete the two synthetic save tests, but keep test_a_save_with_a_lead_in_sentence_stays_text, which still checks that recharge survives on a TextAction. Remove the `saves == 0` assertion and the "Saves (typed)" report row, and change the docstring to say attacks are typed and everything else stays text. The SaveAction model stays, because the generator, remix and CR code use it. If typed SRD saves are wanted later, write a …

### service-core

**Cache lookup only ever serves the 50 oldest matching monsters**  
`backend/src/cauldron/service/service.py:97` · logic-error · medium

- Evidence: `found = self._store.find(request, frozenset(request.exclude_ids), limit=50); return self._rng.choice(found) if found else None`. store.find's docstring says it returns matches 'oldest first', so the limit cuts off the newest ones before the random pick.
- Fix: Pick at random inside SQL (ORDER BY RANDOM() LIMIT 1) or drop the limit and choose from the full list. Give the constant a name if it stays.

**create() and create_reskin() each carry a copy of the same ~20-line reserve/call/retry loop**  
`backend/src/cauldron/service/service.py:108` · redundancy · medium

- Evidence: Both do: `attempts = 1 + self._settings.max_retries`; `for attempt in range(1, attempts + 1): if not self._cap.reserve(): return _failure(FailureReason.RESTING, _RESTING)`; `try: ... except GeneratorUnavailable: return _failure(FailureReason.ERROR, _COULD_NOT_REACH)`; `except BadOutput as problem: feedback = [str(problem)]; _log_failed_attempt(...); continue`; `self._cap.record_tokens(...)`; then accept, `feedback = outcome`, log, and finally `return _failure(FailureReason.ERROR, _GAVE_UP)`. On…
- Fix: Extract one private method, e.g. `_attempt_loop(self, kind, ask, accept) -> Result`, where `ask(feedback)` returns an object with input_tokens/output_tokens (GeneratedMonster or GeneratedName) and `accept(answer)` returns GenerateSuccess or a list of problems (the reskin accept closure also holds the `move_name` check). create() and create_reskin() shrink to building their inputs and calling it. Add a small `_find_base(base_id)` for the duplicated lookup.

**A surprise theme plus a named move that does not fit crashes with HTTP 500 instead of a clean 422**  
`backend/src/cauldron/service/service.py:159` · logic-error · medium

- Evidence: settle() passes BOTH choices to resolve() whenever either one is "surprise": `theme, move = resolve(base, request.theme, request.move, self._rng)`. resolve() raises `ValueError(f"The move {chosen_move.label} does not fit this monster.")` for a named move that does not apply, and settle() does not catch it. I ran it: POST /api/v1/reskin {"baseId":"srd-frog","theme":"surprise","move":"burst"} returns 500 'Something went wrong on the server.' with a logged traceback, while the same move without th…
- Fix: Make settle() decide only what is actually a surprise and leave named choices to create_reskin's existing check. For example: `update = {}`; `if request.theme == SURPRISE: update["theme"] = theme.value`; `if request.move == SURPRISE: update["move"] = move.key if move else None`; and call `resolve(base, request.theme if request.theme == SURPRISE else None, request.move if request.move == SURPRISE else None, self._rng)`. Add one test for surprise theme + frog + burst expecting INVALID (service) and 422 (API).

**Two test names promise coverage that is not there: roles and damage themes are never asserted anywhere**  
`backend/tests/service/test_matching.py:23` · logic-error · medium

- Evidence: `test_type_size_and_role_are_one_of` only asserts `types=` and `sizes=`; there is no `roles=`. `test_environments_and_damage_themes_need_any_one_of_the_picks` only asserts `environments=`; there is no `damageThemes=`. A grep for damageThemes/damage_themes across tests/service shows no other use against matches()/mismatches()/store.find. So the `request.roles` and `request.damage_themes` branches (in both matching.py functions) can be broken with every test still green. The last environments ass…
- Fix: Add `roles=[drake.role.value]` / a non-matching role, and `damageThemes=[drake.damage_themes[0].value]` / a theme not in `drake.damage_themes` assertions, and replace the conditional request with a fixed environment the drake demonstrably lacks (assert it first, or pick `next(e for e in Environment if e not in drake.environments)`). Rename the tests to match what they check.

**The damage-swap assertion is padded so it can never fail**  
`backend/tests/service/test_service.py:280` · logic-error · medium

- Evidence: `assert DamageType.COLD in {r.type for a in monster.actions if hasattr(a, "damage") for r in a.damage} | {DamageType.COLD}`. The set is unioned with {DamageType.COLD}, so the check is always true. I ran the real swap: the drake's actions only deal piercing and slashing, so without the padding the assertion would be False; the swap actually lands in `monster.immunities` ([COLD]).
- Fix: Replace the line with the check that is true and meaningful: `assert DamageType.COLD in monster.immunities` (the line above already asserts lightning is gone). Drop the hasattr/union expression.

### service-infra

**413 and 500 failure bodies carry no CORS headers, so the web page cannot read them**  
`backend/src/cauldron/service/app.py:86` · logic-error · medium

- Evidence: app.add_middleware(CORSMiddleware, ...) is registered at line 86, BEFORE @app.middleware("http") refuse_huge_bodies (line 97); the later-added middleware is outermost, and @app.exception_handler(Exception) (line 112) runs in Starlette's ServerErrorMiddleware, which is outermost of all. Probe with an Origin header: 422 -> access-control-allow-origin present; 413 (100 KB body) -> None; 500 (service.lookup raising) -> None. The module docstring promises 'Failures always have the same body ... whic…
- Fix: Register refuse_huge_bodies first and call app.add_middleware(CORSMiddleware, ...) last so CORS is outermost. Delete the @app.exception_handler(Exception) function and instead wrap the call in that same http middleware: try: return await call_next(request) / except Exception: log.exception(...); return the 500 failure JSONResponse. I verified in a scratch FastAPI app that both 413 and 500 then carry access-control-allow-origin, and nothing is re-raised, so the raise_server_exceptions=False flag in the test fixture (test_api.py lines 36, 43, 153) can be removed. Add an Origin header to those t…

**The 64 KB body limit trusts Content-Length, so a chunked upload skips it**  
`backend/src/cauldron/service/app.py:99` · logic-error · medium

- Evidence: `length = request.headers.get("content-length"); if length and length.isdigit() and int(length) > MAX_BODY_BYTES:` does nothing when the header is missing or non-numeric. Probe: POST /api/v1/reskin with a generator body (Transfer-Encoding: chunked, no Content-Length, about 100 KB) was read in full and reached validation (422 'baseId: Field required'). FastAPI parses the whole body into memory before any endpoint code (and therefore before either rate limiter) runs, so the guard does not hold ag…
- Fix: Require a length on the two POST endpoints: `length = request.headers.get("content-length", "")` then `if request.method == "POST" and not length.isdigit(): return 411`, followed by the existing 413 check. h11/uvicorn enforce Content-Length framing, so a client cannot lie about it. Browser fetch always sends it for string bodies. About 2 added lines, and it closes the hole. Add a test using content=<generator>.

**X-Forwarded-For: the FIRST entry is the client-controlled one, so limits can be dodged**  
`backend/src/cauldron/service/limits.py:122` · logic-error · medium

- Evidence: first = value.split(",")[0].strip() ... and test_a_forwarded_for_list_uses_its_first_address pins it with "9.9.9.9, 10.0.0.1". A proxy appends the real peer to the END of X-Forwarded-For; anything before it is whatever the visitor sent.
- Fix: Take the last entry (value.split(",")[-1]) for a proxy that appends, or document that only single-value headers are supported and drop the list-splitting code and its test. Either way the test must stop endorsing the first-entry rule.

**Two tests cannot fail on the behaviour they are named for**  
`backend/tests/service/test_limits.py:79` · logic-error · medium

- Evidence: test_idle_addresses_are_forgotten_so_memory_stays_bounded asserts only `limiter.tracked <= 100`, but the last-resort eviction alone already guarantees that. I replaced _forget_idle with only the oldest-drop loop; the test still passes with tracked == 100, while the real code gives 1, so the clock.now += 120 idle step proves nothing. test_the_day_is_the_utc_day (line 120) passes a clock that is already UTC, so DailyCap._today's `.astimezone(UTC)` could be deleted and it would still pass. A probe…
- Fix: Idle test: after the clock advance assert `limiter.tracked == 1`, and add a separate flood test (150 addresses, max_keys=100, no clock move) asserting `tracked == 100`. UTC test: use `datetime(2026, 10, 20, 22, tzinfo=timezone(timedelta(hours=-5)))` and assert `store.usage("2026-10-21").calls == 1`.

### validator-templates

**CrConsistencyCheck accepts a low CR claim whose numbers look far too strong, and the note says something false**  
`backend/src/cauldron/validator.py:334` · logic-error · medium

- Evidence: `if not estimated.reliable or claimed > CR_LABELS.index(RELIABLE_UP_TO):` returns only the note "CR {claimed} is above what the SRD data covers well". `estimated.reliable` is False when the ESTIMATE is above CR 21, not when the claim is. I ran it: Stormhide Drake (CR 4) with hit_points.average=1500 and cr="5" estimates as CR 22 (reliable=False). The check returns `noted: CR 5 is above what the SRD data covers well...` and Validator().validate() gives status `corrected` (accepted), not `retry`. …
- Fix: Skip only when the claim is above the covered range: `if claimed > CR_LABELS.index(RELIABLE_UP_TO): return NOTED`. Drop `not estimated.reliable` from the condition and let an unreliable estimate fall through to the gap test (`estimated.index` is already clamped to 0..33, so the gap is valid). The note then only ever appears for high claims, where its wording is true. Add a test that a CR 5 claim with huge hit points returns RETRY. Then `CrEstimate.reliable` is read by nothing in src. Delete it and its estimator test, or keep it only for the estimator.

### web-components

**Escape on an open DropMenu also closes the whole stat block dialog**  
`frontend/src/components/DropMenu.tsx:49` · logic-error · medium

- Evidence: onKeyDown does `if (event.key !== "Escape") return; setOpen(false); button.current?.focus();` and never calls event.preventDefault(). All three DropMenus (Export, Foundry help, Reskin) live inside the modal <dialog> in StatBlockDialog, and a modal dialog treats an un-cancelled Escape keydown as its own close request. I checked in Chrome 152: a document keydown handler that closes a menu without preventDefault ran AND the dialog closed (open=false); with preventDefault() the dialog stayed open. …
- Fix: Add `event.preventDefault();` right after the Escape check in onKeyDown. The handler is only attached while the menu is open, so a second Escape then closes the dialog as normal. One line.

### web-domain

**An attack with neither reach nor range prints "to hit, , one target" (and the Python mirror does not)**  
`frontend/src/lib/renderAction.ts:77` · logic-error · medium

- Evidence: `const lead = ` ${sign}${Math.abs(to_hit)} to hit, ${distances.join(" or ")}, ${targets}. `;` always emits the comma pair. I ran it on { mode: "ranged_spell", to_hit: 4, targets: "one target" } with no reach or range and got "Ranged Spell Attack: +4 to hit, , one target. Hit: ...". The back end handles this case: backend/src/cauldron/actions.py has `where = f", {' or '.join(distances)}" if distances else ""`. AttackDetails (actions.py:99-105) and the TS type both allow reach and range to be abs…
- Fix: Build the clause only when there is something to say: `const where = distances.length > 0 ? `, ${distances.join(" or ")}` : "";` then `const lead = ` ${formatSigned(to_hit)} to hit${where}, ${targets}. `;`. This also deletes the hand-rolled `sign`/`Math.abs` on line 69, which repeats formatSigned from dice.ts. Add one no-distance attack to the cross-language golden or to renderAction.test.ts so both languages are pinned.

### web-export

**Foundry export turns a conditional vulnerability into a blanket one (Rakshasa)**  
`frontend/src/lib/foundry.ts:50` · logic-error · medium

- Evidence: damageTrait() returns `{ value: [...values], bypasses, custom }`. For a part Foundry cannot express, foundryDamageTrait() puts the wording in `custom`, but the type stays in `value`. I ran exportFoundryActor on the SRD Rakshasa: `dv = {"value":["piercing"],"bypasses":[],"custom":"piercing from magic weapons wielded by good creatures"}`. In dnd5e `custom` is only a label, so the Rakshasa takes double damage from ALL piercing. No note is pushed. docs/EXPORTS.md says 'other qualifiers go in the cu…
- Fix: Have foundryDamageTrait also return the damage types named only in the parts it sends to `custom` (typesIn(part) for each custom part, minus types that appear in a plain or expressible part). In damageTrait, write `value: values.filter(t => !onlyCustom.has(t))`, and push a note like 'Foundry cannot model "<text>"; it is written as text only.' Add a Rakshasa assertion to foundry.test.ts.

### web-generator

**Generator is rebuilt whenever the library loads, so the live server is asked for /library and /health twice on every page load**  
`frontend/src/lib/demoGenerator.ts:134` · logic-error · medium

- Evidence: createGenerator(search, library, serverUrl) takes the curated library, but only the demo generator needs it. App.tsx:122 does `useMemo(() => createGenerator(window.location.search, monsters, API_URL), [monsters])` and App.tsx:126-144 runs `useEffect(() => { ... fetchSharedLibrary(API_URL) ... generator.status?.() ... }, [generator])` under the comment 'ask the server once'. `monsters` starts as [] (App.tsx:70) and is replaced when loadMonsters() resolves, so createLiveGenerator() returns a new …
- Fix: Quick fix: make the live and offline generators independent of the library. Give createDemoGenerator a getter (`getLibrary: () => Monster[]`) so it reads the monsters at call time, change createGenerator to `(search, getLibrary, serverUrl)`, and build the generator once in App (`useMemo(..., [])` with the getter reading a ref). Then the effect really runs once. Smaller fallback: keep the signature and make the effect depend on `generator.mode`, since live generators hold no state.

### core-models

**The same field constraints and the same validator are written several times, and the aliases live in the wrong modules**  
`backend/src/cauldron/actions.py:24` · redundancy · low

- Evidence: `Name = Annotated[str, Field(min_length=1, max_length=100)]` (actions.py:24) is identical to `Short = ...` (monster.py:29); the same constraint is typed inline a third time at actions.py:106 (`targets`) and a fourth at monster.py:197 (`id`). `_dice_must_be_readable` is copied verbatim at actions.py:48-54 and monster.py:141-145. Constraints repeat inside classes: `Field(default=None, ge=0, le=500)` five times in Speeds, `ge=0, le=1000` four times in Senses, `Annotated[str, Field(max_length=300)]…
- Fix: Put the shared aliases in base.py (or a small `types.py`): `Short`, `Prose`, `Dice` (an Annotated str with an AfterValidator that calls parse_dice, used by both DamageRoll and HitPoints), `Speed = Annotated[int, Field(ge=0, le=500)]`, `SenseRange = Annotated[int, Field(ge=0, le=1000)]`, `Change = Annotated[str, Field(min_length=1, max_length=200)]`. Delete `Name`. Fields become `walk: Speed | None = None`, and `changes: Annotated[list[Change], Field(max_length=20)] | None = None`. Removes both copies of the validator and about ten repeated constraints.

**DamageRoll.dice validator is looser than its contract, so malformed damage text can be stored and printed**  
`backend/src/cauldron/actions.py:48` · logic-error · low

- Evidence: `dice: str # for example "2d6"` but the validator only calls `parse_dice(value)` (which accepts a bonus, spaces and any size) and returns the raw string. Verified: `DamageRoll(dice="2d6+3", bonus=2, type="fire").text()` gives `12 (2d6+3 + 2) fire damage`; `dice=" 2d6 "` gives `7 ( 2d6 ) fire damage`; `dice="0d0"` and `dice="99999d99999"` are accepted (average 4,999,950,000). The AI tool schema (draft.py MonsterDraft.actions: list[AnyAction]) has no pattern or range for it, so Haiku can send any…
- Fix: In dice.py add a stricter check used only for damage dice: require `parse_dice(value).bonus == 0` (flat bonus belongs in `bonus`), return `value.strip()` so stored text is normalised, and bound count and sides (for example 1-100 each) in `parse_dice` or the validator. Raise ValueError with a plain message such as "put the flat bonus in 'bonus', not in 'dice'". Add parametrized cases for "2d6+3", " 2d6 " and "0d6" to test_actions.py (the current list only has lots, empty, 2d and 1d6+1d4).

**Multiattack tag is missed when the SRD importer could not type the Multiattack action**  
`backend/src/cauldron/features.py:25` · logic-error · low

- Evidence: derive_features tests `any(isinstance(action, MultiattackAction) for action in monster.actions)`. But seed/action_parser.parse_action falls back to `TextAction(name=name, text=desc)` when a Multiattack has no parseable sequence. I loaded frontend/public/data/srd-monsters.json: Hydra and Violet Fungus both have a TextAction named 'Multiattack' and `Feature.MULTIATTACK in m.features` is False for both. FeaturesCheck uses the same function, so it would never correct this either.
- Fix: Treat the name as part of the definition: add `_is_multiattack(action)` = `isinstance(action, MultiattackAction) or action.name.lower().startswith('multiattack')` (the same style `regeneration` already uses for traits) and use it on line 25. Re-run the seed importer to refresh the two SRD records, and add a test with a TextAction named Multiattack.

**Abilities has no accessor, so callers look scores up with getattr and a string; modifier code is repeated**  
`backend/src/cauldron/monster.py:157` · structure · low

- Evidence: `getattr(abilities, ability.value)` followed by `ability_modifier(...)` appears in validator.py:102 (`_modifier`), seed/action_parser.py:111, seed/spells.py:99, and remix/moves.py:66, which also keeps its own `_ABILITIES = ('str','dex','con','int','wis','cha')` tuple (moves.py:22) that duplicates the Ability enum and indexes with raw strings (`mods['dex']`, `mods[ability.value]`). Tests repeat it (test_moves.py:135, test_templates.py:150). A typo in the string is a runtime AttributeError that m…
- Fix: Give Abilities `def score(self, ability: Ability) -> int: return getattr(self, ability.value)` and `def modifier(self, ability: Ability) -> int: return ability_modifier(self.score(ability))`. Delete validator._modifier and moves._ABILITIES. moves.make_context becomes `mods = {a: monster.abilities.modifier(a) for a in Ability}`. The getattr then lives in one typed place.

**saves and skills are the only numeric/text fields with no range or length limits**  
`backend/src/cauldron/monster.py:217` · logic-error · low

- Evidence: `saves: dict[Ability, int]` and `skills: dict[str, int]` carry no constraints, while every neighbouring number has `ge/le` and every string has `max_length`. Verified: `Monster.model_validate({**sample, "skills": {"x"*5000: 999999}, "saves": {"str": -50000}})` is accepted. validator.py has no check on saves or skills, and draft.py:41-42 repeats the same unbounded types in the schema sent to the AI. The module docstring claims a Monster that exists is always well formed.
- Fix: Add aliases next to `Score`: `Bonus = Annotated[int, Field(ge=-5, le=30)]` and use `saves: dict[Ability, Bonus]`, `skills: dict[Short, Bonus]`; use the same types in draft.py. One line each, and the generator schema then tells the model the limits.

**Several tests cannot fail: they assert the implementation against itself or against a type guarantee**  
`backend/tests/test_monster.py:133` · logic-error · low

- Evidence: (1) test_monster.py:133-136 compares `[a.display_name for a in monster.all_actions()]` with `[a.display_name for a in [*monster.actions, *monster.bonus_actions, *monster.reactions]]`, which is literally the body of `all_actions`. (2) test_monster.py:79-81 asserts `trait.kind == "text"`, but `traits: list[TextAction]` and `kind` is a Literal default, so it is always true (and SAMPLES[0] has just one trait). (3) test_monster.py:84-88 asserts `kinds <= {four class names}` (the union admits nothing…
- Fix: Delete (2), (3) and the last line of (4). Rewrite (1) with a literal expectation: build or pick a monster with one action, one bonus action and one reaction and assert the exact name list `["Bite", "Dash", "Parry"]` so a wrong order would fail. If a class-per-kind check on a Monster is wanted, use a sample that has attack, save, multiattack and text actions and assert the set equals all four.

**Tautological assertion: the two collections compared are the same object's keys**  
`backend/tests/test_rules.py:44` · logic-error · low

- Evidence: rules.py:58 defines `CR_LABELS: list[str] = list(XP_BY_CR)`, so `assert set(XP_BY_CR) == set(CR_LABELS)` at test_rules.py:44 can never fail. The test name says 'xp table matches the SRD', but the five spot checks above it are the only real guard. Separately, the unit's only direct test of `format_dice` (the inverse of parse_dice) lives in test_validator.py:60, not in test_dice.py, which does not import it.
- Fix: Delete line 44. If you want to guard the table, assert `len(XP_BY_CR) == 34` (already covered by the label-count test) or compare against a literal list of all 34 XP values copied from SRD p.258. Move `test_format_dice` into test_dice.py and add a `parse_dice`-then-`format_dice` round trip there.

### cr-estimator

**reliable_index's docstring says 'at it or at any step below' but the code only counts the step itself**  
`backend/src/cauldron/cr/calibrate.py:71` · logic-error · low

- Evidence: Docstring: 'The highest ladder step that has at least RELIABLE_MIN_MONSTERS SRD monsters at it or at any step below.' Code: `if counts[step] >= RELIABLE_MIN_MONSTERS: best = step`, which looks only at that step's own count. Probed counts: CR 18 has 0 monsters, CR 19 has 1 and CR 20 has 3, yet 'reliable up to CR 21' is chosen because CR 21 alone has 4. Read literally, the docstring (a cumulative count) would make step 33 reliable. The function also uses a defaultdict(int), and reading `counts[st…
- Fix: Replace the body with `counts = Counter(p.index for p in points); return max((s for s, n in counts.items() if n >= RELIABLE_MIN_MONSTERS), default=0)` and correct the docstring to 'the highest step that itself has at least N SRD monsters; thinner steps below it are not checked'. Do not change the behaviour: switching to a contiguous rule would cut the reliable range to about CR 12.

**invert writes the 'middle of the flat stretch' rule three times and ends in an unreachable assertion**  
`backend/src/cauldron/cr/curves.py:55` · redundancy · low

- Evidence: The start branch (`end = max(i for i, v in enumerate(curve) if v == curve[0])`, `end / 2`), the end branch (`start = min(...)`, `(start + len(curve) - 1) / 2`) and the interior `flat = [i for ...]; (flat[0] + flat[-1]) / 2` are the same rule with different bounds. The start and end branches also build `end` or `start` even when `value` is outside the curve and the result is discarded, and the final loop is followed by `raise AssertionError('unreachable ...') # pragma: no cover`.
- Fix: Use bisect on the never-decreasing curve: `lo = bisect_left(curve, value); hi = bisect_right(curve, value); if lo < hi: return (lo + hi - 1) / 2; if lo == 0: return 0.0; if lo == len(curve): return float(len(curve) - 1); low, high = curve[lo - 1], curve[lo]; return lo - 1 + (value - low) / (high - low)`. This is about 8 lines instead of 20, has no unreachable branch, and is O(log n). I checked it against the current invert on the four committed curves plus three plateau curves with about 14,000 probe values, with 0 mismatches. The existing test_curves.py tests cover every case.

**test_leave_one_out only checks key and list counts, never an error value**  
`backend/tests/cr/test_calibrate.py:57` · logic-error · low

- Evidence: `assert set(errors) == {...}` and `assert all(len(v) == 30 ...)`. Estimating everything from the wrong point, dropping the held-out monster from nothing, or returning index-minus-index sign-flipped would all pass. The docstring promises signed errors from curves built without the monster.
- Fix: Build a tiny dataset where the answer is known (for example three monsters on a straight line) and assert the exact signed errors. Also assert that the held-out monster is excluded: give one monster an outlier HP and check its own error is large.

**invert's flat-start and flat-end branches have no test**  
`backend/tests/cr/test_curves.py:63` · logic-error · low

- Evidence: Every invert test uses a curve that is strictly rising at both ends (`[0,10,20,30]`, `[10,20,30]`), so `value == curve[0]` yields end/2 = 0 and `value == curve[-1]` yields (3+3)/2 = 3, the same as the unflattened answer. The 'middle of a flat start/tail' lines (`end / 2`, `(start + len(curve) - 1) / 2`) are never exercised with a real plateau, although the committed curves have long flat tails.
- Fix: Add `assert invert([5,5,5,9], 5) == 1.0` and `assert invert([1,9,9,9], 9) == 2.0`, plus a below-start and above-end check on those flat curves.

**test_the_tolerance_grows_with_the_challenge_rating asserts almost nothing and its name is false; the table check hard-codes 333**  
`backend/tests/cr/test_estimator.py:115` · logic-error · low

- Evidence: `assert 1 <= low <= mid` and `assert high >= 1`. The committed bands are {7: 1, 13: 4, 20: 4, 33: 3}, so CR 25 (3) is below CR 8 (4): tolerance does not grow, and `high >= 1` can never fail. Line 109 `assert table.SAMPLE_SIZE == len(SRD) == 333` already guards a stale table with `== len(SRD)`; the literal 333 only adds a second place to edit whenever the SRD data changes.
- Fix: Rename it to what it checks and assert the real lookup: `for last_step, steps in table.TOLERANCE_BANDS.items(): assert tolerance_steps(last_step) == steps`, plus one assertion that the step after a band boundary takes the next band's value. Drop `== 333` and keep `== len(SRD)`.

**test_multiattack_adds_up_the_attacks_it_names cannot fail if multiattack handling is deleted, and duplicates another test**  
`backend/tests/cr/test_measure.py:31` · logic-error · low

- Evidence: The comment says 'Bite 19 + 7, two claws of 15 ... 56. Fire Breath alone is 63.' and the assertion is `assert m.dpr == 63`. The multiattack sum (56) loses to the breath (63) in `max(best_round, total)`, so the result is 63 with or without the multiattack code. The same dragon and the same `measure(...).dpr == 63` assertion is repeated in test_a_save_action_written_as_text_counts_its_damage (line 49). Separately, test_every_srd_monster_can_be_measured loops over RAW with a hard-coded `if index =…
- Fix: Delete test_multiattack_adds_up_the_attacks_it_names. test_a_multiattack_beats_a_single_attack (bandit captain, 17 vs 6) already exercises the summing path. Replace the loop in test_every_srd_monster_can_be_measured with `import_all(RAW_LIST).monsters` (as test_estimator.py already does) so the special case and the second SRD-loading style both go away.

**The all-SRD measure test silently skips a monster that measures fine**  
`backend/tests/cr/test_measure.py:87` · logic-error · low

- Evidence: `if index == "half-red-dragon-veteran": continue` with no reason given. Measuring it works today and gives Measures(effective_hp=65.0, ac=18, dpr=36.0, offense_bonus=7). The skip is stale, so a future regression for that monster would never be caught. The loop also uses an assert-in-loop with only `dpr >= 0` and `hp > 0`.
- Fix: Delete the skip and the `if` so every SRD monster is checked. If one ever does need an exception, use a named constant with a comment saying why.

### cross-language

**AttackAction.conditions is a dead field in both languages**  
`backend/src/cauldron/actions.py:116` · bloat · low

- Evidence: `conditions: list[str] | None = None` in actions.py and `conditions?: string[];` in types/monster.ts. A grep of backend/src and frontend/src finds no reader or writer outside those two declarations (the other 'conditions' hits are foundryItems hp and condition_immunities). describe() and renderAttack ignore it.
- Fix: Delete the field from AttackAction and from the TypeScript AttackAction interface. extra=forbid will then reject any data that carries it, so check the sample and SRD JSON first (a grep found none).

**The 'mirrors options.ts' contract has no test, and five Python enums have no TypeScript list to mirror**  
`backend/src/cauldron/options.py:1` · logic-error · low

- Evidence: options.py line 1: 'They mirror frontend/src/lib/options.ts, so both sides agree on every allowed value.' No test reads either file for this: backend/tests has only the remixMoves.ts parser (test_menu_matches_frontend.py) and the prose golden, and no frontend test reads a .py file (grep for readFileSync and '.py' in frontend/src is empty). My throwaway diff shows SIZES, CREATURE_TYPES, DAMAGE_TYPES, DAMAGE_THEMES, ROLES, ENVIRONMENTS and FEATURES match today, so nothing enforces it. Ability, So…
- Fix: Move the five inline unions into options.ts as `as const` arrays (ABILITIES, SOURCES, ATTACK_MODES, AREA_SHAPES, SAVE_SUCCESS) and ABILITY_NAMES next to them. Add backend/tests/test_options_match_frontend.py modelled on test_menu_matches_frontend.py: regex out each `export const NAME = [...]` array and assert it equals `[e.value for e in Enum]` in order (about 20 lines). Reword the two stale comments to say both sides are hand-kept and the test guards them.

**damage_dealt_by reads text case-insensitively but swap_damage_type replaces it case-sensitively**  
`backend/src/cauldron/templates.py:31` · logic-error · low

- Evidence: `_types_named_in` lowercases first (`_DAMAGE_WORD.findall((text or "").lower())`, line 95), but `phrase = re.compile(r"\b" + re.escape(old.value) + r" damage\b")` (line 31) and the damage_text `line` regex (line 73) have no IGNORECASE. I ran a TextAction "Fire damage from this burst ignores resistance. Each creature takes 10 fire damage." through swap_damage_type(FIRE -> COLD): the result reads "Fire damage from this burst ... takes 10 cold damage.", and damage_dealt_by(swapped) still returns […
- Fix: Compile `phrase` with re.IGNORECASE and keep the capital, e.g. `phrase.sub(lambda m: (new.value.capitalize() if m.group(0)[0].isupper() else new.value) + " damage", text)`. retarget_name (lines 138-143) already has the same capital-preserving idea, so extract one small `_replace_word(pattern, new, text)` helper for both.

**Level-up raises the Perception skill but leaves passive Perception stale**  
`backend/src/cauldron/templates.py:221` · logic-error · low

- Evidence: LevelUpTemplate.apply adds the proficiency gain to skills (`"skills": {skill: bonus + pb_gain for skill, bonus in monster.skills.items()}`, line 221) but never touches `senses`. Nothing downstream repairs it: validator.py has no passive-Perception check, remix/engine.py only renames the result, and grep for 'passive' outside seed/ and monster.py finds nothing. I ran a throwaway probe over the 20 samples plus 333 SRD monsters: 349 satisfy passive == 10 + (Perception skill or WIS mod) before leve…
- Fix: In apply(), add one update: `"senses": monster.senses.model_copy(update={"passive_perception": monster.senses.passive_perception + (pb_gain if "Perception" in monster.skills else 0)})`. Add one test that levels up a monster whose proficiency bonus rises and asserts passive_perception == 10 + skills['Perception'].

**all_actions test restates the implementation, so it cannot fail on a real bug**  
`backend/tests/test_monster.py:133` · logic-error · low

- Evidence: `names = [a.display_name for a in monster.all_actions()]` is asserted equal to `[a.display_name for a in [*monster.actions, *monster.bonus_actions, *monster.reactions]]`, which is the body of all_actions() copied into the test, and the Cinderkite is not shown to have bonus actions or reactions. The test name promises 'stat block order' but does not check it against known data.
- Fix: Build a Monster whose three sections each hold one distinctly named action and assert the literal list `['Bite', 'Quick Step', 'Parry']`, or delete the test and rely on the cross-language and theme tests that exercise all_actions.

**TypeScript attack prose prints a stray ", ," when an attack has no reach and no range; Python omits it**  
`frontend/src/lib/renderAction.ts:77` · logic-error · low

- Evidence: TS: `const lead = ` ${sign}${Math.abs(to_hit)} to hit, ${distances.join(" or ")}, ${targets}. `;` with an empty `distances` gives " +5 to hit, , one target. " (checked in node). Python actions.py:131-132 handles the empty case: `where = f", {' or '.join(distances)}" if distances else ""`, giving "+5 to hit, one target." Both Pydantic (`reach` and `range` both default None) and the TS type allow such an attack, and nothing in validator.py or seed requires one of them. The golden file written by …
- Fix: Mirror Python: `const where = distances.length > 0 ? `, ${distances.join(" or ")}` : "";` and `const lead = ` ${sign}${Math.abs(to_hit)} to hit${where}, ${targets}. `;`. Add one attack with neither field to the shared prose cases (a synthetic monster in the golden, or one case in both renderAction.test.ts and test_actions.py).

### css

**The 'display face' rule is silently overridden by later `font: inherit`, so buttons never get Cinzel**  
`frontend/src/styles.css:95` · logic-error · low

- Evidence: Lines 94-103: "/* Buttons and small labels speak in the display face... */ .action-button, .print-button, .menu-button, .pill, .difficulty legend, .theme-toggle { font-family: var(--font-display); ... }". Same specificity, but .print-button (line 161), .action-button (line 175) and .menu-button (line 820) each declare `font: inherit;` LATER, and the `font` shorthand resets font-family to inherit (body font, Alegreya). Only .pill and .difficulty legend still get Cinzel. `.theme-toggle` matches n…
- Fix: Decide the intent. If buttons should be Cinzel, change `font: inherit` to `font-size: inherit` in those three rules (font-family then comes from the group rule). If Alegreya buttons are fine, delete .action-button, .print-button and .menu-button from the group. Either way delete the dead `.theme-toggle` selector and fix the comment.

**.error is styled with the accent (green) colour, so errors look like headings**  
`frontend/src/styles.css:118` · logic-error · low

- Evidence: `.error { color: var(--accent); font-weight: bold; }` while `--accent` is `#2d5a1c` (light) and `#86e05a` (dark), the same green as h1/h2, buttons and the 'hard/deadly' rating (`.rating-hard, .rating-deadly { color: var(--accent); }`). App.tsx renders `<p className="error">{error}</p>`.
- Fix: Add one `--danger` token to both theme blocks (a red or orange) and use it for `.error` and `.rating-deadly`.

**Leftover `<details>` styles for XP budgets: `.budgets summary` is dead and `.budgets ul` fights `.dropmenu__items`**  
`frontend/src/styles.css:774` · logic-error · low

- Evidence: No `<summary>` or `<details>` exists in any .tsx (grep), yet lines 774-777 style `.budgets summary`. PartyPanel.tsx now renders `<DropMenu panelClassName="budgets"><ul className="dropmenu__items">`. `.budgets ul { margin: 0.25rem 0 0; padding-left: 1.1rem; }` (line 779, specificity 0,1,1) beats `.dropmenu__items { margin: 0; padding: 0; list-style: none; }` (line 1195, 0,1,0). The XP list therefore gets a bullet-sized indent and a top margin but no bullets. `.budgets` is also listed in the text…
- Fix: Delete `.budgets summary` and `.budgets ul`, drop `.budgets` from the text-shadow selector list, and keep only `.budgets { font-size: 0.85rem }`. The unused `budgets-button` class on the PartyPanel.tsx button has no rule either and can go.

**Phone pop-out uses `100vh`, which is taller than the visible screen on mobile browsers**  
`frontend/src/styles.css:1266` · logic-error · low

- Evidence: Lines 1266-1274: `.statblock-dialog { width:100vw; max-width:100vw; height:100vh; max-height:100vh; }`. On iOS Safari and Android Chrome, `100vh` is the viewport with the address bar collapsed, so with the bar showing the bottom of the modal sits under the browser chrome. The scroll area then ends behind the toolbar and the last lines (flavour text, attribution) can be hard to reach. The same file already uses `inset:0` for the brewing overlay.
- Fix: Use `height: 100dvh; max-height: 100dvh;` (with the current `100vh` as the line above for old browsers), or drop the explicit height and let the dialog's own inset sizing apply.

**Reskin and Export-help panels are styled in three stacked layers; two layers' declarations are dead**  
`frontend/src/styles.css:1337` · redundancy · low

- Evidence: ReskinPanel and ExportButtons are rendered only inside `.dialog-header` (StatBlockDialog.tsx), so the final rule at 1578-1586 `.dialog-header .dropmenu__panel.reskin-panel, .dialog-header .dropmenu__panel.export-help { top:auto; right:auto; left:0.5rem; margin-top; width:min(26rem, calc(100% - 1rem)); max-width:none }` always wins (specificity 0,3,0). That makes the following dead: `width: min(26rem, 92vw)` on line 1342, `width: min(22rem, 86vw)` on line 1247, and the `.dropmenu__panel.reskin-p…
- Fix: Keep one definition: `.reskin-panel, .export-help` get the header-aligned positioning and width once, with `.dropmenu:has(> .reskin-panel, > .export-help) { position: static }`. Delete the two dead widths, the two dead phone selectors and the generic `[hidden]` rule, and make the reskin display rule `.reskin-panel:not([hidden]) { display:flex }` so no second `[hidden]` rule is needed.

### dead-code

**_text_weights skips the wrong mentions, so damage types are dropped and double-counted**  
`backend/src/cauldron/remix/theme.py:63` · logic-error · low

- Evidence: `counted` is the number of "N (dice) type damage" matches, then `mentions = [m for m in _TYPE_ONLY.findall(lowered) if m in _TYPES]; for kind in mentions[counted:]: weights[...] += 1` skips the first `counted` mentions. That assumes the amount-bearing mentions come first, which is not true. I ran it on the SRD Spider. Its Bite text is 'Hit: 1 piercing damage, and ... take 2 (1d4) poison damage'. damage_weights returns {poison: 3.0}: poison is counted twice (2 + 1) and piercing is lost. template…
- Fix: Scan the text once with a single alternation regex, so no mention is ever looked at twice: `_MENTION = re.compile(r"(\d+) \([^)]*\) ([a-z]+) damage|\b([a-z]+) damage\b")`. For each match, add int(amount) when the first form matched and 1 when the bare form matched, and ignore words that are not DamageType values. This replaces the two-regex plus slice logic and needs no `counted` bookkeeping. I re-ran primary_damage with this scanner over all 353 library monsters and nothing changed, so the fix does not alter any existing result. Add a test for the Spider-style text.

**matches() repeats every rule of mismatches() line for line**  
`backend/src/cauldron/service/matching.py:32` · redundancy · low

- Evidence: mismatches() (lines 8-29) and matches() (32-48) both check, in the same order: cr_min, cr_max, types, sizes, roles, environments (any), damage_themes (any), features (all). I compared the two and they are logically identical. matches() is the one used for cached lookups in store.find, and mismatches() is the one used to validate a freshly generated monster in service._accept. If one is edited and the other is not, the shared cache and the generator quietly stop agreeing on what 'fits the reques…
- Fix: Keep one rule list and derive the other: `def matches(monster, request): return not mismatches(monster, request)`. The messages cost almost nothing next to the Monster.model_validate_json call that store.find already does per row. That removes 17 lines and the drift risk. The module header says the page's filters.ts is a deliberate third copy, so leave that one.

**settle() lets a ValueError escape, so a surprise request with a move that does not fit returns HTTP 500**  
`backend/src/cauldron/service/service.py:159` · logic-error · low

- Evidence: settle() does `theme, move = resolve(base, request.theme, request.move, self._rng)` with no try/except. resolve() raises `ValueError("The move Pull does not fit this monster.")` when a named move does not apply. settle() only returns early when `not request.has_surprise`, so `{theme:'surprise', move:'pull'}` on a Tiny monster reaches resolve(). I ran resolve(tiny_srd_monster,'surprise','pull',rng) and it raises. app.reskin() calls service.settle(body) directly, so the generic Exception handler …
- Fix: Catch ValueError in settle() and return the request unchanged (create_reskin already refuses it with INVALID), or move the applies_to check into settle and return a GenerateFailure. Add a test for surprise theme plus an unfit named move.

**damage_dealt_by (and _types_named_in, _DAMAGE_WORD, _DAMAGE_NAMES) is never called by the server**  
`backend/src/cauldron/templates.py:98` · bloat · low

- Evidence: `grep damage_dealt_by backend/src` finds only its definition. The only callers are 8 uses in tests/test_templates.py (lines 41-84). The page uses its own TypeScript `damageDealtBy` (demoGenerator.ts:54), which has separate tests in generatorApi.test.ts:104 and srdData.test.ts:56-64. No cross-language test ties the two together, so this Python copy is an unguarded twin. It also re-implements the action walk that remix/theme.py `damage_weights` already does (attack rolls, save rolls, text of acti…
- Fix: Delete lines 89-118 from templates.py. In test_templates.py, replace the two `damage_dealt_by` assertions in the swap tests (lines 83-84) with the existing `rolls()` helper. Drop or fold the five damage_dealt_by tests (40-77): the TS tests cover the same cases, including the zombie that is immune to poison but deals only bludgeoning. If you want a Python reference for that rule, use `sorted(damage_weights(m))` from theme.py. After fixing the _text_weights bug above, the two give the same answer on all 353 library monsters.

**The hit-point formula (dice count, hit die, Con bonus, rounded average) exists in two places**  
`backend/src/cauldron/validator.py:172` · redundancy · low

- Evidence: HitPointsCheck.run: `bonus = count * _modifier(monster, Ability.CON)`, `dice = format_dice(count, sides, bonus)`, `average = max(1, (count * (sides + 1) + 2 * bonus) // 2)`. LevelUpTemplate._hit_points in templates.py computes `bonus = count * con`, `average = max(1, (count * (sides + 1) + 2 * bonus) // 2)` and `format_dice(count, sides, bonus)` identically. If one is changed (for example how a negative Con bonus rounds) the level-up result will silently disagree with what the validator then 'c…
- Fix: Add one helper such as `rules.hit_points_for(count, size, con_mod) -> HitPoints` (or a `HitPoints.for_dice(...)` classmethod) and use it from both HitPointsCheck and LevelUpTemplate._hit_points.

**The same 'apply a function to actions, bonus actions and reactions' block is written five times**  
`backend/src/cauldron/validator.py:204` · redundancy · low

- Evidence: AttackBonusCheck (validator.py:204-213) and SaveDcCheck (236-245) each define an identical `fix_all(actions)` and then the same three-key model_copy: `update={"actions": fix_all(monster.actions), "bonus_actions": fix_all(monster.bonus_actions), "reactions": fix_all(monster.reactions)}`. templates.py repeats the three-key list in swap_damage_type (the `dealt` dict, lines 61-67), in retarget_name (157-165) and in LevelUpTemplate.apply (230-232). Monster.all_actions() is the read-side helper for t…
- Fix: Add one method on Monster: `def map_actions(self, fn: Callable[[AnyAction], AnyAction]) -> "Monster": return self.model_copy(update={"actions": [fn(a) for a in self.actions], "bonus_actions": [fn(a) for a in self.bonus_actions], "reactions": [fn(a) for a in self.reactions]})`. Then the two checks become `updated = monster.map_actions(lambda a: fix(a) if isinstance(a, AttackAction) else a)` (or the SaveAction version). Both `fix_all` helpers disappear. The three template functions chain `.map_actions(action)` and add only their extra keys (traits, legendary, spellcasting). That removes roughly…

**test_the_tolerance_grows_with_the_challenge_rating cannot fail for the high band and contradicts the data**  
`backend/tests/cr/test_estimator.py:115` · logic-error · low

- Evidence: The test asserts `1 <= low <= mid` and then only `assert high >= 1`. `high` (CR 25) is never compared with `mid`. The committed table is `TOLERANCE_BANDS = {7: 1, 13: 4, 20: 4, 33: 3}`. Running tolerance_steps gives CR 2 -> 1, CR 8 -> 4, CR 25 -> 3, so the tolerance does not grow all the way up and the name is false. `high >= 1` holds for any table without a zero. The neighbouring test at line 108 hard-codes `table.SAMPLE_SIZE == len(SRD) == 333`. SAMPLE_SIZE, MEAN_ABS_ERROR and WITHIN (calibra…
- Fix: Rename it to what it checks (for example 'the tolerance is tighter at low CRs than in the middle') and assert `low < mid`. Replace `high >= 1` with a real expectation, or drop it. Change `== 333` to `== len(SRD)` so the freshness check survives a data change. Optionally stop emitting the three write-only constants from calibrate.py and keep them only in the header comment.

**The generator is rebuilt whenever the library loads, so /library and /health are fetched twice at startup**  
`frontend/src/App.tsx:122` · complexity-time · low

- Evidence: `const generator = useMemo(() => createGenerator(window.location.search, monsters, API_URL), [monsters]);` For a live generator, createGenerator ignores `monsters` and returns a new createLiveGenerator(url) object each time. The next effect depends on `[generator]`, so it runs once with monsters=[] and again after loadMonsters() calls setMonsters(list). Each run issues fetchSharedLibrary (a request that can return up to 5000 monsters) plus generator.status().
- Fix: Only depend on the library for the demo generator, for example memoize on `[]` and give createDemoGenerator a getter/ref to the current list, or have createGenerator take the library lazily. The live and offline generators then stay the same object and the effect runs once.

**parseSpellcastingText and its helpers are used only by tests (about two thirds of the file)**  
`frontend/src/lib/spellcastingText.ts:78` · bloat · low

- Evidence: grep over frontend/src finds no production caller of `parseSpellcastingText`, `splitSpellList` or `spellRef`. Only fiveToolsSpells.test.ts (line 15, used as a fixture builder) and spellcastingText.test.ts import them. `LIST_LINE` and the `Base` type exist only for them. The file's own header says the parser is 'how prose (for example an imported stat block) becomes structure', but exportJson.ts states 'No import feature exists yet'. The real text-to-data parser is the Python seed/spells.py, whi…
- Fix: Move `parseSpellcastingText`, `splitSpellList`, `spellRef`, `LIST_LINE` and `Base` into `frontend/src/lib/testing/parseSpellcasting.ts`. That folder already holds test-only helpers whose header says 'The app never imports this file'. Point the two test files at it. Every test keeps running and spellcastingText.ts shrinks to the code the app uses. Do not delete the tests: the round-trip test at spellcastingText.test.ts:49 guards real behaviour.

### gap-1

**Level clamp written twice (storage.ts and party.ts)**  
`frontend/src/lib/storage.ts:62` · redundancy · low

- Evidence: storage.ts: `.map((level) => Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level))))`; party.ts:92: `THRESHOLDS_BY_LEVEL[Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level)) - 1]`. Count clamping already has a named helper (clampCount) but level clamping does not, and storage.ts imports MIN_LEVEL/MAX_LEVEL only for this.
- Fix: Add `export function clampLevel(level: number): number` in party.ts (round + min/max), use it in partyThresholds and parseParty, and drop the MIN_LEVEL/MAX_LEVEL imports from storage.ts.

**Id-validity check written four times, and the limit constant is duplicated in generatedStore**  
`frontend/src/lib/storage.ts:143` · redundancy · low

- Evidence: `item.length >= 1 && item.length <= MAX_ID_LENGTH` (line 77), `monsterId.length < 1 || monsterId.length > MAX_ID_LENGTH` (99), `typeof id === "string" && id.length >= 1 && id.length <= MAX_ID_LENGTH` (143 and 166). generatedStore.ts line 11 also declares its own `const MAX_ID_LENGTH = 100;` and re-checks `value.id === "" || value.id.length > MAX_ID_LENGTH`.
- Fix: Add one `export function isValidId(value: unknown): value is string` next to MAX_ID_LENGTH and call it in all four storage.ts places. Have generatedStore.ts import MAX_ID_LENGTH or isValidId instead of redeclaring it, so the two stores cannot drift apart. Lines 143-148 then simplify to `let finalId = isValidId(id) && !usedIds.has(id) ? id : legacyId()`.

### gap-2

**Assertions that cannot fail**  
`frontend/src/lib/foundry.test.ts:196` · logic-error · low

- Evidence: Line 196 `expect(itemNamed(actor, "Legendary Actions")).toBeDefined();` always passes, because itemNamed already throws when the item is missing. Line 80 `expect(FOUNDRY_TARGET.systemVersion).toBe("5.3.3")` only checks a constant against its own literal and sits inside the 'stamps the actor' test. The 'safe damage bonus text' test (line 315) overlaps the weapon test (line 243), which already fails on NaN when a bonus is malformed.
- Fix: Delete the `toBeDefined` line, since the call itself is the assertion. Move or drop the constant check. Fold the bonus-regex check into the weapon test's loop, or keep it only for the save and spell-attack parts it uniquely covers.

**Contrived or vacuous assertions in the HTML-escaping and legendary tests**  
`frontend/src/lib/foundry.test.ts:425` · logic-error · low

- Evidence: Line 425: `expect(html).not.toContain("<b>Bold</b>".replace("<b>Bold</b>", "<b>Bold</b></p>"))` is a roundabout way of writing the string "<b>Bold</b></p>", which is also not what the escaped output could contain by accident. It does not prove that the name is escaped. Line 196: `expect(itemNamed(actor, "Legendary Actions")).toBeDefined()` can never fail, because itemNamed throws when the item is missing. The test at line 191 also never checks the real header item.
- Fix: In the escape test, assert positively: the description value of the "<b>Bold</b>" trait item equals "<p>5 &lt; 6 &amp; 7 &gt; 3</p>" (already done) and the item name or identifier does not contain a raw `<b>`, with a plain string literal. Remove the `.replace` line and the toBeDefined line, or replace the latter with a check on the header item's description text.

**`known` set is filled but never read**  
`frontend/src/lib/foundry.ts:92` · bloat · low

- Evidence: `const known = new Set<string>();` ... `known.add(skill.id);` Nothing else in exportFoundryActor reads `known`.
- Fix: Delete the `known` declaration and the `known.add(skill.id)` line. The if/else then only needs to set entry.value and bonuses.check.

**Item id and wrapper object rebuilt by hand in four builders instead of using itemShell**  
`frontend/src/lib/foundryItems.ts:267` · redundancy · low

- Evidence: weaponItem (line 241), spellAttackItem (267) and saveItem (298) each compute `stableId(`${ctx.monster.id}|${section}|${index}|${action.name}`)` and return `{ _id: id, name, type, system, effects: [], flags: {}, _stats: {...STATS_STAMP} }`. textItem (309, 322) computes the same id and then calls itemShell, which computes it a second time. The legendary loop (363) repeats it again. itemShell builds the identical object.
- Fix: Add a small itemId(ctx, section, index, name) helper. Let itemShell take the precomputed id, or return it from itemShell so the builders can read item._id for activityId. Then end each builder with `return itemShell(ctx, section, index, name, type, system)`, which removes the four hand-written wrapper literals and the repeated id string.

**Recharge consumption block copy-pasted between saveItem and textItem**  
`frontend/src/lib/foundryItems.ts:288` · redundancy · low

- Evidence: saveItem lines 288-294 and textItem lines 312-318 both assign `activity.consumption = { targets: [{ type: "itemUses", target: "", value: "1", scaling: {...} }], scaling: { allowed: false, max: "" }, spellSlot: true }`. Each is next to its own `action.recharge ? rechargeUses(...) : plainUses()` line.
- Fix: Add a `rechargeConsumption()` helper next to rechargeUses, or make one `applyRecharge(activity, recharge)` that sets both consumption and returns the uses object. Both callers shrink to one line.

**Skills template (18 identical blocks, ~235 lines) is almost entirely overwritten by foundry.ts**  
`frontend/src/lib/foundryTemplates.ts:195` · bloat · low

- Evidence: Each skill is { value, ability, bonuses:{check:"",passive:""}, roll:{min:null,max:null,mode:0} }. foundry.ts lines 93-108 loop over SKILLS and set entry.ability, bonuses.check, bonuses.passive and entry.value for every skill. Only the constant `roll` object comes from the template. The same applies to the abilities block (lines 7-62): foundry.ts lines 73-88 set value, max, proficient and bonuses for all six.
- Fix: Drop the skills and abilities literals from the template. In foundry.ts, build each entry directly in the existing loops: { value, ability, bonuses:{check,passive}, roll:{min:null,max:null,mode:0} }. This removes about 300 lines and the child() lookups. The key-path test against real fixtures still guards the shape.

### gap-3

**Move lookup and 'does not fit' check duplicated in resolve and remix**  
`backend/src/cauldron/remix/engine.py:56` · redundancy · low

- Evidence: resolve: `chosen_move = _find(move); if not chosen_move.applies_to(monster): raise ValueError(f"The move {chosen_move.label} does not fit this monster.")` and remix: `move = _find(move_key)...; if move is not None and not move.applies_to(monster): raise ValueError(f"The move {move.label} does not fit this monster.")`. The same check runs twice per request.
- Fix: Extract `_checked_move(key, monster) -> Move` (find + applies_to + raise) and call it in both places.

**Docstring says the damage cap is tested on every SRD monster, but the test covers four, and the sweep does not check it**  
`backend/src/cauldron/remix/moves.py:10` · logic-error · low

- Evidence: Module docstring: 'no move's damage may exceed the monster's best single attack (the tests check this on every SRD monster)'. test_moves.py::test_no_move_deals_more_than_the_monsters_best_attack loops over `("Ogre", "Goblin", "Adult Red Dragon", "Commoner")` only. test_engine's sweep over everyone checks validity, validator complaints and CR drift, but not this cap. It also checks each item alone, so rider text damage added to an attack is never summed. The test file also defines its own `best_…
- Fix: Move the cap assertion into the existing sweep, which already builds every move for every monster. Delete the four-monster test along with the duplicate test helper (import `best_attack` from cauldron.remix.moves). Or soften the docstring to match what is tested.

**_edit_line returns an empty string instead of None when every entry is removed**  
`backend/src/cauldron/remix/theme.py:101` · logic-error · low

- Evidence: `return "; ".join(parts)` after filtering. Ran _edit_line('cold', {COLD}, []) -> ''. Happens in apply_theme when a vulnerability equals the new theme (e.g. vulnerable to cold, remixed to cold) and that was the only item; the exact-printed line then becomes '' rather than None.
- Fix: End with `return "; ".join(parts) or None`.

### gap-4

**Surprise note shows in Quick mode from hidden Remix state**  
`frontend/src/components/ReskinPanel.tsx:153` · logic-error · low

- Evidence: const surprising = theme === SURPRISE || move === SURPRISE; ... message || (!hasChange ? hint : surprising ? "Surprise choices are made fresh each time..." : "")
- Fix: surprising ignores `kind`. Pick Surprise me in Remix, switch to Quick and tick Level up, and the status says surprise choices apply although the quick request sends none. Compute `const surprising = kind === "remix" && (theme === SURPRISE || move === SURPRISE);`.

**XP range filtering (xpRange parameter) has no test, and tests are tied to sample data**  
`frontend/src/lib/filters.test.ts:15` · logic-error · low

- Evidence: No test passes the third argument of filterMonsters/matchesFilters; the min-inclusive/max-exclusive/null-max rule at filters.ts line 71 is unguarded. Tests also hard-code names like "Dune Leviathan" as CR 12 and expect exact result lists.
- Fix: Add one test with a band like {min: 50, max: 450} and {min: 450, max: null} checking the boundary monsters (xp == min included, xp == max excluded). Build a few tiny Monster objects inline for the range and sort tests instead of relying on the shared sample JSON, so editing the sample file does not break unrelated filter tests.

**Coverage test omits damage themes despite comment, and sort tests compare with the code's own comparator**  
`frontend/src/lib/filters.test.ts:157` · logic-error · low

- Evidence: Comment says "keep every filter option demonstrable" but the coverage test checks types, sizes, roles, environments, features and never DAMAGE_THEMES; sort tests assert `toEqual([...asc].sort((a, b) => a.localeCompare(b)))`, restating the implementation.
- Fix: Add `expect(has(DAMAGE_THEMES, monsters.flatMap((m) => m.damage_themes))).toEqual([])`. For sorts, assert against a hard-coded expected order on a small inline list so the test would fail if the comparator were wrong in the same way.

### remix

**resolve() refuses an unfit explicit move with a ValueError that settle() lets escape as a generic 500**  
`backend/src/cauldron/remix/engine.py:72` · logic-error · low

- Evidence: `resolve` checks explicit choices as well as deciding surprises: `chosen_move = _find(move); if not chosen_move.applies_to(monster): raise ValueError(...)`. Its only caller, `GenerationService.settle`, runs for any request with a surprise, for example theme 'surprise' plus move 'burst' on a Frog. `app.reskin` calls `service.settle(body)` with no try/except, and the only handler is `@app.exception_handler(Exception)`, which returns 'Something went wrong on the server.' with status 500. The same …
- Fix: Make `resolve` only decide surprises and pass explicit choices through untouched: surprise gives `rng.choice(...)`, anything else is returned as given. Leave the single user-facing refusal in `create_reskin` and the engine guard in `remix`. That deletes both raise blocks and the `_THEMES` lookup from `resolve`, so `resolve` shrinks to about 6 lines. `settle` can then store the strings directly.

**Context.pb and Context.best are filled in but never read**  
`backend/src/cauldron/remix/moves.py:32` · bloat · low

- Evidence: Context declares `pb: int` and `best: float`, and make_context sets `pb=monster.challenge.proficiency_bonus` and `best=best`. A grep of src and tests finds no `ctx.pb`, `ctx.best` or `.pb`/`.best` read anywhere. Only `budget`, `dc`, `attack_bonus`, `attack_ability`, `theme`, `name` and `monster` are used.
- Fix: Delete the two fields and their two keyword arguments in make_context. `best` stays a local variable used to compute `budget`, and `pb` stays a local used for `dc` and `attack_bonus`. Update the Context docstring ('the numbers') accordingly.

**apply_theme re-derives 'the monster's old theme' with the same rule as engine.current_theme**  
`backend/src/cauldron/remix/theme.py:131` · redundancy · low

- Evidence: theme.py: `if source is not None and source.value in _THEMES: old_theme = source else: old_theme = DamageType(monster.damage_themes[0].value) if monster.damage_themes else None`. engine.py current_theme: `main = primary_damage(monster); if main is not None and main.value in _THEMES: return _THEMES[main.value]; return monster.damage_themes[0] if monster.damage_themes else _DEFAULT_THEME[...]`. These are the same rule (elemental main damage, else first theme tag), but one is in theme.py and the o…
- Fix: Move current_theme (without the creature-type default) into theme.py as `old_theme(monster) -> DamageTheme | None`. Have apply_theme use it, and have engine.current_theme be `old_theme(monster) or _DEFAULT_THEME[monster.type]`. The 'is it elemental' rule then lives in one place.

**Several remix tests cannot fail, are mislabelled, or are brittle**  
`backend/tests/remix/test_engine.py:30` · logic-error · low

- Evidence: (1) test_engine.py:30 `assert result.monster.actions == [a for a in result.monster.actions]` compares a list to a copy of itself. (2) test_moves.py:34 `assert [m.key for m in MOVES.values()] == list(MOVES)` is true by construction, because MOVES is built keyed on `move.key`. (3) test_engine.py:123 `test_surprise_with_no_move_that_fits_gives_no_move` asserts `move is not None`, the opposite of its name, and its comment admits the None case is 'impossible'. (4) test_moves.py:100 `build(...).trait…
- Fix: Delete (1) and (2). Rename (3) to 'a surprise move is always one that fits' and drop its stale comment. Change (4) to `assert 'the ogre dies' in text`. Use `len(MOVES)` in place of 18. Import `best_attack` from moves in test_moves.py, or keep the copy but say it is an independent oracle. Delete the test_theme duplicate, or make it the only one and make the engine one use a different scenario. Replace the `> 4000` guard with `> len(everyone)`.

**The 'names the monster in lower case' test contorts its input so it can hardly fail, and two determinism tests repeat each other**  
`backend/tests/remix/test_moves.py:96` · logic-error · low

- Evidence: `assert "the ogre dies" in build(MOVES["death_burst"], ogre).traits[0].text.replace("When the ogre dies", "the ogre dies")` rewrites the text it is checking, so the assert only proves the text contains 'When the ogre dies'. Separately, test_the_same_inputs_always_build_the_same_move (test_moves.py) and test_the_same_inputs_give_the_same_result (test_engine.py) both only assert that a pure function called twice returns equal values. Neither guards a source of randomness, because the engine takes…
- Fix: Assert `"When the ogre dies" in text` directly, and drop the replace(). Delete the two determinism tests, or keep the engine one only. Write `checked = 0` and compute `failures = len(problems)` where it is used.

### seed

**The importer writes a note on every legendary monster and the report then filters it out by matching English text**  
`backend/src/cauldron/seed/importer.py:174` · structure · low

- Evidence: importer.py:174 does `notes.append(f"Legendary actions per round set to {LEGENDARY_PER_ROUND}: ...")` for every legendary monster. report.py:36 then hides them with `if not all("legendary actions per round" in n.lower() for n in notes)`. I ran the import: 32 of the 41 monsters in import_notes carry only this note, so 78% of the collected notes are discarded at render time. The two files are coupled through the wording of a message, so rewording it in importer.py silently changes the report. No …
- Fix: Delete the `notes.append(...)` at importer.py:174. The comment on LEGENDARY_PER_ROUND (l.39) already documents the assumption. In report.py, simplify l.36 to `[f"- **{name}**: " + " ".join(notes) for name, notes in sorted(result.import_notes.items())] or ["None."]`. The report output is unchanged: the same 9 real entries.

**The round-trip `expected` expression is a 220-character one-liner that runs the regex a second time and is re-typed in the test**  
`backend/src/cauldron/seed/spells.py:114` · readability · low

- Evidence: l.114: `expected = " ".join(intro_parts + [re.sub(r"^-\s*", "", line) if line.endswith(".") else re.sub(r"^-\s*", "", line) + "." for line in lines if _LIST_LINE.match(line)] + footer_parts)`. Both branches of the conditional run the same `re.sub`. `_LIST_LINE.match(line)` already ran in the loop at l.79, so it runs twice per line. The same logic is copied as `normalised()` in test_spells.py:22-26, so the production check and its test oracle can drift apart.
- Fix: Build the sentences while looping, where the match is already in hand. Before the loop add `bullet_sentences: list[str] = []`. After `seen_list = True` add `text = line.removeprefix("-").lstrip(); bullet_sentences.append(text if text.endswith(".") else text + ".")`. Then use `expected = " ".join([*intro_parts, *bullet_sentences, *footer_parts])`. That removes the second regex pass and the duplicated re.sub. Optionally drop `normalised()` from the test, since the mage and djinni tests already compare the exact printed text.

**Abilities-from-raw is rebuilt in the tests three more times**  
`backend/tests/seed/test_action_parser.py:206` · redundancy · low

- Evidence: The same `Abilities(str=monster["strength"], dex=monster["dexterity"], ...)` appears at test_action_parser.py:206 and :225 and in test_spells.abilities_of. The importer (import_monster) builds it as well.
- Fix: Add an `abilities_of(raw_monster)` helper to tests/seed/conftest.py, or better a `Abilities.from_srd(raw)` classmethod shared with the importer, and use it in every place above.

**Whole-data parser and spell tests assert things that are true by construction, so they cannot fail**  
`backend/tests/seed/test_action_parser.py:216` · logic-error · low

- Evidence: (1) test_action_parser.py:216-217 asserts `action.describe(monster["name"]) == entry["desc"]` for typed Attack/Save actions. parse_action only returns a typed action when `typed.describe(monster_name) == desc` (action_parser.py:225), so this line can never fail. The only real assertion left is `typed > 500`, and `typed` also counts multiattacks. importer test l.142 already guards the same counts with `attacks > 400 ... texts > 200`. (2) test_real_monsters_parse (l.222-230) does `assert parse_ac…
- Fix: Delete test_real_monsters_parse and the `describe == desc` assertion. Delete the whole-data test in test_action_parser, since the importer's `everything` fixture runs the same parser on the same data and has the count guard. In test_spells, remove the parametrize and the `normalised` equality loop. Pin what can actually change: `skipped_names == {"Dust Mephit", "Ice Mephit", "Lamia", "Magma Mephit", "Steam Mephit"}` (I confirmed these are the five that fall back to text today) and `parsed >= 30`. The mage and djinni tests already check exact text for two real cases.

**test_real_monsters_parse asserts only that an object is truthy, and the whole-data test already covers these monsters**  
`backend/tests/seed/test_action_parser.py:222` · logic-error · low

- Evidence: `for entry in monster.get("actions", []): assert parse_action(entry, ...)`. parse_action always returns an Action, which is always truthy, so this can never fail. The four parametrized monsters are also covered by test_every_srd_action_parses_and_typed_ones_reproduce_their_text.
- Fix: Delete test_real_monsters_parse. If a spot check is wanted, assert a concrete result, for example that the Aboleth's Tentacle is an AttackAction and the Adult Red Dragon's Fire Breath is a TextAction with recharge 5.

**Weakened or brittle assertions in the importer tests**  
`backend/tests/seed/test_importer.py:63` · logic-error · low

- Evidence: Line 63: `assert "nonmagical" in m.damage_text.immunities or "nonmagical" in (m.damage_text.resistances or "")` is an either/or that passes if the text lands in the wrong field. Line 174: `assert "333" in report and "Half-Red Dragon Veteran".lower().replace(" ", "-") in report` matches any "333" anywhere in the report text, and the second part is an obfuscated spelling of "half-red-dragon-veteran".
- Fix: Assert the exact field: `assert "nonmagical" in m.damage_text.immunities` (the werewolf's text is in immunities). Replace the report check with the literal slug and `f"Monsters imported: **{len(everything.monsters)}**" in report`.

**Three tagger tests are vacuous and a fourth duplicates an importer test**  
`backend/tests/seed/test_tagger.py:87` · logic-error · low

- Evidence: test_weapon_damage_is_never_a_theme (l.87-89) asserts `t.value not in {"slashing","piercing","bludgeoning"}`. DamageTheme (options.py:52-64) has only ten elemental members and `_ELEMENTS` is built from that enum, so this is true by construction. test_every_monster_gets_a_valid_role (l.70-72, `role in set(Role)`) and test_tags_are_all_valid_enum_members (l.98-102, `isinstance(e, Environment)`) check things the Tags types already guarantee, because tag() builds every value from enum constants. te…
- Fix: Delete test_weapon_damage_is_never_a_theme, test_every_monster_gets_a_valid_role and test_tags_are_all_valid_enum_members. Drop `and m.role in set(Role)` from the importer test, and keep the 1-to-3 bound in only one of the two files. Replace them with tests that can fail. Roles ARTILLERY, LURKER, LEADER, SKIRMISHER and BRUTE have no test at all, so use `named(BASE, ...)` variants with a ranged attack, a Stealth +6 skill and so on. Build the "Nameless Thing" cases from BASE rather than from sample names where possible.

### service-core

**matches() is a hand-copied, early-exit version of mismatches(): the same seven rules written twice**  
`backend/src/cauldron/service/matching.py:32` · redundancy · low

- Evidence: mismatches() (lines 8-29) checks CR bounds, types, sizes, roles, environments, damage themes and features; matches() (lines 32-48) repeats every one of those conditions verbatim with `return False`. I compared the two on 52,520 random (monster, request) pairs from the sample library: 0 disagreements, so `matches(m, r) == (not mismatches(m, r))` today. Two copies can drift apart silently, and test_matching.py only exercises matches(), so a drift in mismatches() (what the AI is told) would not be…
- Fix: Delete the body of matches() and write `def matches(monster, request) -> bool: return not mismatches(monster, request)`. ~16 lines removed, one source of truth. (Cost is a few f-strings per non-matching row in store.find, over at most the SQL-narrowed rows.)

**Several assertions are vacuous or tautological**  
`backend/tests/service/test_draft_and_prompts.py:86` · logic-error · low

- Evidence: Line 86: `assert "submit_monster" in system or "tool" in system` passes if either word appears and 'tool' is a common word. Lines 65-66 call `json.dumps(schema)` twice, the second time with no assertion. In test_haiku.py:191, `assert set(NameDraft.model_fields) == {"name", "description"}` only restates the class definition.
- Fix: Assert `"submit_monster" in system` (the real contract), delete the bare second `json.dumps` call, and drop the NameDraft.model_fields line, since the schema-properties assert above it already covers the same thing.

**Environment assertion is a data-dependent ternary that can silently test nothing useful**  
`backend/tests/service/test_matching.py:35` · logic-error · low

- Evidence: `assert not matches(drake, req(environments=["arctic"]) if "arctic" not in [e.value for e in drake.environments] else req(environments=["underwater"]))`. The first positive case also builds `[drake.environments[0].value, "arctic"]` from the sample data.
- Fix: Use a fixed, known environment pair: `assert matches(drake, req(environments=["mountain", "arctic"]))` and `assert not matches(drake, req(environments=["underwater"]))`, with an assert in the test that the drake's environments are what the test assumes.

### service-infra

**Failure bodies are built six different ways, and the two endpoints repeat the same pipeline**  
`backend/src/cauldron/service/app.py:68` · redundancy · low

- Evidence: _failure_response (line 68) is bypassed by refuse_huge_bodies (lines 101-102), unexpected (115-117), http_error (121: a hand-written {"ok": False, "reason": "error", ...} dict) and too_many (129-131), each repeating JSONResponse(...model_dump(mode="json"), status_code=...). The sentence 'The forge is resting, back tomorrow. The library still works.' is written twice in app.py (lines 156 and 179) and again as _RESTING in service.py:40. Lines 163 and 186 repeat `_success_response(result) if isins…
- Fix: Give _failure_response an optional status (`status_code=status or _STATUS[failure.reason]`) and use it in all four places. Export one RESTING message from service.py (or a service.resting_failure()) and use it in app.py. Add `_answer(result)` for the success/failure dispatch. Optionally pull the shared sequence into one local helper `serve(request, cached, note, create)` so a future change to the order of checks cannot be made to only one endpoint. This removes about 25 lines and leaves one place for the response shape.

**At capacity, RateLimiter wipes the limit of the very visitor who is asking**  
`backend/src/cauldron/service/limits.py:54` · logic-error · low

- Evidence: allow() runs `if len(self._hits) >= self._max_keys: self._forget_idle(now)` even when `key` is already tracked; the last-resort loop `del self._hits[next(iter(self._hits))]` then deletes the oldest-inserted key, and `self._hits.setdefault(key, deque())` recreates it empty. Probe: RateLimiter([(60, 1)], max_keys=3); allow('a'), allow('b'), allow('c'); then allow('a') returned allowed=True (it should be refused). Under a flood of addresses (for example rotating IPv6 sources) the oldest real visit…
- Fix: Only make room for a new key: `if key not in self._hits and len(self._hits) >= self._max_keys:`. Simpler still, make _hits an OrderedDict, call move_to_end(key) on each use, and replace _forget_idle with `while len(self._hits) > self._max_keys: self._hits.popitem(last=False)` after inserting. That evicts the least recently used key in O(1), never the asker, and deletes the scan and list comprehension (about 8 lines).

**find() parses and matches every row, then slices to the limit**  
`backend/src/cauldron/service/store.py:139` · complexity-time · low

- Evidence: `rows = ...fetchall()` followed by `found = [m for m in (Monster.model_validate_json(row[0]) for row in rows) if matches(m, request)]` and `return found if limit is None else found[:limit]`. service.lookup always passes limit=50, yet every matching row is validated first. Probe with 353 rows and an empty filter: find(limit=50) took 31 ms; a lazy version returned the identical 50 monsters in 6.7 ms. The cost grows with the shared library, on the free cache path hit by every /generate call.
- Fix: Make the match lazy and stop at the limit: `matching = (m for m in (Monster.model_validate_json(r[0]) for r in rows) if matches(m, request)); return list(islice(matching, limit))` (from itertools import islice; islice(..., None) means no limit). This is faster and removes the `found if limit is None else found[:limit]` branch.

**test_the_day_is_the_utc_day cannot fail on a time-zone bug**  
`backend/tests/service/test_limits.py:120` · logic-error · low

- Evidence: cap = DailyCap(store, limit=5, clock=lambda: day(2026, 10, 20, 23)) where day() builds a datetime already in UTC, so DailyCap._today()'s .astimezone(UTC) is a no-op. The test passes even if the .astimezone(UTC) call is deleted.
- Fix: Feed a clock returning a non-UTC aware time, e.g. datetime(2026, 10, 20, 23, tzinfo=timezone(timedelta(hours=-7))), and assert the usage lands on "2026-10-21". Otherwise delete the test.

**test_find_applies_every_filter passes on an empty result**  
`backend/tests/service/test_store.py:66` · logic-error · low

- Evidence: result = store.find(req(crMin=2, crMax=4, features=["flying"]), ...); assert all(... for m in result). all() over an empty list is True; there is no check that anything matched (the sibling test does assert `found and`).
- Fix: Assert `result` is non-empty first, and also assert that a monster outside the filter (present in samples) is absent, so both directions are checked.

### validator-templates

**swap_damage_type is case-sensitive, but damage_dealt_by is not, so a capitalised "Fire damage" is offered for swapping and then left behind**  
`backend/src/cauldron/templates.py:31` · logic-error · low

- Evidence: `_types_named_in` lowercases the text (`_DAMAGE_WORD.findall((text or "").lower())`), but `phrase = re.compile(r"\b" + re.escape(old.value) + r" damage\b")` has no IGNORECASE. Run on a TextAction with text "Fire damage erupts. Each creature takes 63 (18d6) fire damage.": `damage_dealt_by` returns [FIRE]; after `swap_damage_type(..., FIRE, COLD)` the text reads "Fire damage erupts. Each creature takes 63 (18d6) cold damage." The stat block is now half fire and half cold. Haiku-written text often…
- Fix: Compile with re.IGNORECASE and keep the capital in the replacement: `phrase.sub(lambda m: (new.value.capitalize() if m.group(0)[0].isupper() else new.value) + " damage", text)`. Add one test with a sentence-initial "Fire damage".

**damage_text rewrite creates repeated types that the type lists avoid**  
`backend/src/cauldron/templates.py:73` · logic-error · low

- Evidence: `line = re.compile(r"\b" + re.escape(old.value) + r"\b")` then `line.sub(new.value, value)` over every DamageText field, while `types()` de-duplicates the list fields with `dict.fromkeys`. Swapping bludgeoning to piercing turns the printed line "bludgeoning, piercing, and slashing from nonmagical attacks" into "piercing, piercing, and slashing...", and "fire; bludgeoning from nonmagical weapons" swapped to bludgeoning gives "bludgeoning; bludgeoning from...". The tests only cover a swap to a ty…
- Fix: Rewrite damage_text from the already-swapped lists, or split on "; " and drop repeated parts the way remix/theme.py `_edit_line` does. Add a test that swaps to a type already present in the printed line.

**Template ABC, the _TEMPLATES registry and get_template have no production caller, and the only caller overwrites the identity fields the template sets**  
`backend/src/cauldron/templates.py:172` · bloat · low

- Evidence: `get_template` and `_TEMPLATES` (251-256) are used only by test_templates.py. The only production use is remix/engine.py:117, `LevelUpTemplate().apply(shaped)`, and the next statement overwrites six fields: `leveled.model_copy(update={"id": shaped.id, "name": shaped.name, "source": shaped.source, "validated": ..., "parent_id": ..., "generator": ...})`. So apply()'s `id: f"{monster.id}-level-up"`, `name: f"Leveled {monster.name}"`, `source: Source.RESKIN`, `validated`, `parent_id` and `generator…
- Fix: Make it `def level_up(monster: Monster) -> Monster:` that returns `monster.model_copy(update={...numbers only...})`. Delete the six identity lines, engine.py's re-assertion block (4 lines), `Template`, `_TEMPLATES`, `get_template`, and the tests that only guard them (`test_the_base_template_cannot_be_used_directly`, `test_templates_are_found_by_name`, `test_level_up_is_a_new_unvalidated_reskin_that_keeps_its_attribution`, `test_two_level_ups_of_different_monsters_get_different_ids`). Keep a one-line attribution-kept test. The OOP teaching value of ABCs is already carried by Action, Check, Mov…

**"cr_value + xp + proficiency_bonus for a CR label" is rebuilt in five places**  
`backend/src/cauldron/validator.py:150` · redundancy · low

- Evidence: DerivedFieldsCheck `wanted = {"cr_value": ..., "xp": xp_for_cr(label), "proficiency_bonus": proficiency_bonus(label)}` (150-154); LevelUpTemplate.apply `"cr_value": cr_value(new_cr), "xp": xp_for_cr(new_cr), "proficiency_bonus": proficiency_bonus(new_cr)` (222-229); service/draft.py:112 `Challenge(cr=draft.cr, cr_value=cr_value(draft.cr), xp=xp_for_cr(draft.cr), proficiency_bonus=proficiency_bonus(draft.cr))`; seed/importer.py:139-140; the test helper `with_cr` (test_validator.py:360-366), whic…
- Fix: Add `Challenge.for_cr(label: str) -> Challenge` in monster.py (it raises ValueError for an unknown label, as cr_value already does). DerivedFieldsCheck compares `Challenge.for_cr(label)` field by field (keep the getattr loop over the three names) and copies the result. LevelUp uses `Challenge.for_cr(new_cr)`, draft.py does the same, and the test `with_cr` becomes a one-liner or is deleted. The unused cr_value/xp_for_cr/proficiency_bonus imports go from templates.py.

**The hit-point dice-and-average formula is written in HitPointsCheck and again in LevelUpTemplate._hit_points (and a third time in dice.average_dice)**  
`backend/src/cauldron/validator.py:171` · redundancy · low

- Evidence: validator.py 172-175: `bonus = count * _modifier(...)`, `dice = format_dice(count, sides, bonus)`, `average = max(1, (count * (sides + 1) + 2 * bonus) // 2)`. templates.py 246-248: `bonus = count * con`, `average = max(1, (count * (sides + 1) + 2 * bonus) // 2)`, `format_dice(count, sides, bonus)`. `max(1, average_dice(dice))` gives the same number (I checked 4d8+8 -> 26 and 2d4-4 -> 1). If the rule changes (say a minimum average), it has to be changed twice, and the level-up test only passes b…
- Fix: Add `HitPoints.for_dice(count, sides, con_modifier) -> HitPoints` in monster.py: `dice = format_dice(count, sides, count * con_modifier); return HitPoints(dice=dice, average=max(1, average_dice(dice)))`. HitPointsCheck becomes `expected = HitPoints.for_dice(count, hit_die(monster.size), con)` and compares `.dice` and `.average` to the monster's. `_hit_points` ends with `return HitPoints.for_dice(count, sides, con)`. About 6 lines go and the rule lives in one place.

**"apply a function to actions, bonus_actions and reactions" is hand-written five times; AttackBonusCheck and SaveDcCheck are near clones**  
`backend/src/cauldron/validator.py:204` · redundancy · low

- Evidence: AttackBonusCheck.run (196-214) and SaveDcCheck.run (228-246) each define `fix_all(actions: list) -> list` and then the same `monster.model_copy(update={"actions": fix_all(monster.actions), "bonus_actions": fix_all(monster.bonus_actions), "reactions": fix_all(monster.reactions)})`. templates.py repeats the three-key dict in swap_damage_type (62-64), retarget_name (160-162) and LevelUpTemplate.apply (230-232). No sample has an attack or save in bonus_actions or reactions, so a typo in any one cop…
- Fix: Add one method on Monster (monster.py), `def map_actions(self, fn) -> dict: return {"actions": [fn(a) for a in self.actions], "bonus_actions": [fn(a) for a in self.bonus_actions], "reactions": [fn(a) for a in self.reactions]}`. Use it as `monster.model_copy(update=monster.map_actions(fix))` in all five places. The two `fix_all` helpers disappear (`fix` can take any Action and return it unchanged when it is not its kind). Add one test with an attack in reactions, so the three-list handling is covered once.

**Swap-to-itself test cannot fail meaningfully; other weak or duplicate tests in the same file**  
`backend/tests/test_templates.py:116` · logic-error · low

- Evidence: `test_swapping_a_type_for_itself_changes_nothing` swaps FIRE for FIRE on Stormhide Drake, which deals only lightning, piercing and slashing (I checked), so there is nothing to swap and the test passes no matter what the function does with fire text or defences. `test_the_cr_after_level_up_is_one_step_up_for_every_sample` (239-241) repeats `test_level_up_raises_challenge_rating_one_step_and_follows_it` (155-161) for more monsters. `test_level_up_raises_hit_points_by_about_half_with_matching_dice…
- Fix: Use `DamageType.LIGHTNING, DamageType.LIGHTNING` on the drake (it actually has lightning text and rolls). Fold the every-sample CR test into the parametrised validator test or delete the single-monster duplicate. Replace the hit-point test's formula with a plain bound, for example `1.3 * base.average <= result.average <= 1.7 * base.average` plus `dice == format_dice(...)` consistency. Remove the redundant inline imports.

### web-components

**The documented witch.png fallback never works, so the picture/png code is dead**  
`frontend/src/components/Illustrations.tsx:46` · logic-error · low

- Evidence: WitchArt renders `<picture><source srcSet="...witch.webp" type="image/webp"/><img src="...witch.png" onError={() => setMissing(true)}/></picture>`, and docs/ART.md says to save 'witch.webp (preferred) or witch.png'. A <picture> picks the source by its type attribute, not by whether the file exists. I tested in Chrome 152: with the webp 404ing, currentSrc stayed on the missing .webp, the error event fired, and the <img src> fallback was never tried. With only witch.png present, the page therefor…
- Fix: Replace the <picture> with one `<img className={`witch-art ${className}`} src={`${base}images/witch.webp`} alt="" onError={() => setMissing(true)} />`, matching CauldronArt just below it. Delete the png path and change the '(or witch.png)' wording in docs/ART.md and the WitchArt comment. Also delete `.theme-toggle` in styles.css line 100, a selector no markup uses (the class is theme-switch), and drop the unused `export` on WitchScene.

**Property's doc comment promises behaviour the component does not have**  
`frontend/src/components/StatBlock.tsx:45` · readability · low

- Evidence: `/** One "Label value" line, with the label in bold. Renders nothing for empty values. */ function Property(...) { return (<p ...><strong>{label}</strong> {children}</p>); }` It always renders. Callers guard themselves with `&&` (lines 171-188), and Languages and Senses always print even when empty.
- Fix: Delete the sentence 'Renders nothing for empty values.' Or make it true: `if (children === "" || children == null) return null;` and drop the repeated guards around the Property calls.

### web-domain

**The favorites tests depend on hard-coded sample ids and names, so they break when the sample file changes**  
`frontend/src/lib/favorites.test.ts:9` · logic-error · low

- Evidence: `new Set(["stormhide-drake-2f77", "cinderkite-3a1f"])` and `.toEqual(["Cinderkite", "Stormhide Drake"])`. These ids carry a hash suffix and come from public/data/sample-monsters.json. If the sample data is regenerated, renamed or reordered, the logic is unchanged but the tests fail. The same file is also loaded just to exercise a one-line filter.
- Fix: Build two or three minimal monsters inline, for example `{ id: "a" } as Monster`, and test against those. The tests then no longer read the JSON file and no longer break when the sample data is regenerated.

**A failed library file is swallowed with no signal to the user or console**  
`frontend/src/lib/loadMonsters.ts:17` · logic-error · low

- Evidence: `const results = await Promise.allSettled(...)`; `if (loaded.length === 0) { throw ... }` then `return loaded.flatMap((r) => r.value)`. If srd-monsters.json returns 404 or bad JSON, the app silently shows only the ~sample monsters. Saved encounters and favorites that reference SRD ids then show as 'missing' (they are dropped from the XP maths).
- Fix: Report the partial failure: console.error each rejected result at minimum, or return { monsters, failed: string[] } so App can show a one-line notice. Also `(await response.json()) as Monster[]` is unchecked, so a JSON object instead of an array makes flatMap spread characters or throw later. Add `if (!Array.isArray(data)) throw new Error(...)` in loadFile.

**The challenge-rating table is split across three places, and the code converts label to value to label and re-tests the XP band**  
`frontend/src/lib/party.ts:49` · redundancy · low

- Evidence: CR_LADDER (filters.ts:8) holds {label, value}. XP_BY_CR (party.ts:49-84) is a second 34-row table keyed by the same labels. crLabelsInBand (party.ts:155) returns labels, and generateRequest.ts:34 immediately looks the values back up: `crLabelsInBand(band).map((l) => CR_LADDER.find((c) => c.label === l)!.value)`, then does `Math.min(...values)` and `Math.max(...values)` on a list that is already ascending. generateRequest.ts:68 `crLabel(value)` is another find on the same table. The band test `x…
- Fix: Put the XP in the one table: `CR_LADDER: { label; value; xp }[]` in filters.ts, deleting XP_BY_CR, or deriving it with Object.fromEntries if tests want it. Export one `xpInBand(xp, band)` next to the XpRange type and use it in matchesFilters, in the band filter, and in the encounter test. Make crLabelsInBand return the rungs (rename it crRungsInBand). Then generateRequest uses `rungs[0].value` and `rungs[rungs.length - 1].value`, describeBand uses `rungs[0].label`, and the `!` assertion and the round trip disappear.

**parseSpellcastingText, splitSpellList, spellRef, LIST_LINE and Base are used only by tests, and the parser drops text between lists**  
`frontend/src/lib/spellcastingText.ts:77` · bloat · low

- Evidence: A repo-wide grep finds no production caller of parseSpellcastingText. Production code only calls spellcastingToText (StatBlock.tsx, fiveTools.ts, foundryItems.ts), casterLevel (foundry.ts), hasSpellLists (fiveToolsSpells.ts) and spellRefText. splitSpellList and spellRef are called only by the parser. The only users are spellcastingText.test.ts and fiveToolsSpells.test.ts, which use it to build fixtures. Importing SRD spellcasting is done in Python (backend/src/cauldron/seed/spells.py: split_spe…
- Fix: Move parseSpellcastingText, splitSpellList, spellRef, LIST_LINE and the Base type into the existing frontend/src/lib/testing/ folder (for example testing/parseSpellcasting.ts). Import them from there in the two test files. spellcastingText.ts then keeps only what ships: ORDINALS, spellRefText, listText, casterLevel, hasSpellLists and spellcastingToText, about 55 fewer lines. Fix the header comment so it stops promising an import feature that does not exist. If an import feature is built later, the parser can move back, and the lost-middle-text case should get a test.

### web-export

**The same exportFileName + toJsonText + downloadTextFile triple is repeated at five call sites, and the mimeType parameter is never used**  
`frontend/src/lib/download.ts:6` · redundancy · low

- Evidence: ExportButtons.tsx:18-19, 26-27, 34-35 and EncounterPanel.tsx:96-97, 123-124 all write `const filename = exportFileName(prefix, name); downloadTextFile(filename, toJsonText(x))`. Every call uses the default "application/json", so `mimeType = "application/json"` is speculative generality (download.test.ts only checks the default).
- Fix: Add `downloadJson(prefix: string, name: string, value: unknown)` in download.ts that does the three steps, and call it from the five sites. Drop the mimeType parameter. exportFileName and toJsonText then stay internal to the export code.

**Vacuous HTML-escaping assertion, plus duplicated assertions in two test files**  
`frontend/src/lib/foundry.test.ts:425` · logic-error · low

- Evidence: `expect(html).not.toContain("<b>Bold</b>".replace("<b>Bold</b>", "<b>Bold</b></p>"));` evaluates to not.toContain("<b>Bold</b></p>"). The trait name never goes into HTML (it is a raw `name` field, so the JSON does contain `<b>Bold</b>`, just never followed by `</p>`), so this passes whether or not escaping works. The real check is the later `description.value` assertion. Duplicates: foundryMaps.test.ts:124-126 ('agrees with the ability modifier table', `abilityModifier(27)` is 8) sits under des…
- Fix: Delete line 425 and assert on the places HTML is written: `for (const item of items(actor)) expect(obj(sys(item).description).value).not.toContain("<b>")` and `expect(obj(obj(sys(actor).details).biography).value).not.toContain("<img")`. Delete the abilityModifier test from foundryMaps.test.ts and the version assertion at foundry.test.ts:80. Optionally build `label` as `dnd5e ${version}` in foundryMaps.ts so 5.3.3 is written once (the comment says 'Everything that mentions it reads from here', but `label: "dnd5e 5.3.3"` repeats it).

**Dead `known` set, and the monster-skill lookup is written three ways**  
`frontend/src/lib/foundry.ts:92` · bloat · low

- Evidence: `const known = new Set<string>();` (l.92) and `known.add(skill.id)` (l.103) are never read (grep for `known` in foundry.ts finds only those two lines). The lookup `Object.entries(monster.skills).find(([name]) => skillFor(name)?.id === ...)?.[1]` is written at l.99 (inside the loop over 18 skills, so it rescans the skills 18 times) and again at l.149 for Perception, and a third loop at l.109-111 calls skillFor(name) again just to emit the 'Left out the skill' note. fiveTools.ts:144-148 does the …
- Fix: Add one helper in foundryMaps.ts, `skillTotals(skills: Record<string, number>): { byId: Map<string, number>; unknown: string[] }`, built in one pass. foundry.ts then does `const total = byId.get(skill.id)` in the loop, `byId.get('prc')` for passive Perception, and `unknown.forEach(name => notes.push(...))`. Delete `known` and the second scan. fiveTools.ts can reuse the same helper for its skill loop.

**Item id seed and item shell written six times; ACTIVATION is an identity map; section and activationType carry the same value**  
`frontend/src/lib/foundryItems.ts:102` · redundancy · low

- Evidence: The seed `stableId(`${ctx.monster.id}|${section}|${index}|${name}`)` appears in itemShell (l.104), weaponItem (l.190), spellAttackItem (l.251), saveItem (l.272), textItem (l.309, which then calls itemShell and recomputes the same id) and buildItems for legendary options (l.363). The activity id is derived from the locally computed id while the item `_id` is computed separately, so they stay consistent only because the strings are typed identically. The literal `{ _id: id, name: action.name, typ…
- Fix: Add `function itemId(ctx, section, index, name) { return stableId(`${ctx.monster.id}|${section}|${index}|${name}`); }` and change itemShell to `itemShell(id, name, type, system)`. Every builder then does `const id = itemId(...)` once and returns `itemShell(id, ...)`. Delete ACTIVATION and the `activationType` parameter: pass `section` (typed 'action'|'bonus'|'reaction') where activationType is used, and the literal 'legendary' at l.364. Removes about 30 lines and the chance of the two ids drifting apart.

**keyPaths treats any 16-letter key as a Foundry id, which forces a catch-all whitelist in the 5etools shape test**  
`frontend/src/lib/testing/foundryChecks.ts:5` · logic-error · low

- Evidence: `ID_KEY = /^([A-Za-z0-9]{16}|dnd5eactivity\d+)$/` is applied to every key, including 5etools data where ids never occur. The 5etools key `legendaryActions` is exactly 16 letters, so fiveTools.test.ts:117-118 has to whitelist `"monster[].*"`. That entry now lets ANY 16-character field the exporter might add pass the 'only writes fields that exist in real 5etools data' test, which weakens the schema guard it exists for. ID_KEY also repeats FOUNDRY_ID (line 43) with a second copy of the same 16-ch…
- Fix: Make id collapsing opt-in: `keyPaths(value, prefix = "", out = new Set(), collapseIds = false)`, and pass true only from foundry.test.ts. Delete the `monster[].*` entry and its comment from fiveTools.test.ts. Define FOUNDRY_ID once above and build ID_KEY from it (`new RegExp(`${FOUNDRY_ID.source.slice(1, -1)}|dnd5eactivity\\d+`)`) or just keep one literal.

### web-generator

**demoGenerator.ts is a grab bag: production damage helpers and the generator factory live in the demo module, and its tests live in generatorApi.test.ts**  
`frontend/src/lib/demoGenerator.ts:54` · structure · low

- Evidence: The module holds three unrelated jobs. (1) The demo generator, which is the only thing its name promises. (2) `damageDealtBy`, used by the real UI: ReskinPanel.tsx:2 (the swap buttons), remixMoves.ts:2 (`movesFor`) and srdData.test.ts. (3) `createGenerator`, which picks offline, demo or live and is imported by App.tsx:42. So remixMoves.ts, a production menu, depends on the demo module and transitively on filters, exportCommon and liveGenerator. There is no demoGenerator.test.ts. generatorApi.te…
- Fix: Move `damageDealtBy` and `typesNamedIn` to a small `damageDealt.ts`, and update ReskinPanel, remixMoves and srdData.test. Move `createGenerator` to `generator.ts`; it must not live in generatorApi.ts, which liveGenerator imports. Leave demoGenerator.ts with createDemoGenerator and swapDamageType only. Move the createGenerator, 'demo generate', 'damage swaps' and 'demo reskin' describes out of generatorApi.test.ts into matching test files. Imports change but no logic does.

**The timeout stops covering the request once the headers arrive, so a stalled response body hangs forever (and the Generate button stays disabled)**  
`frontend/src/lib/liveGenerator.ts:44` · logic-error · low

- Evidence: fetchWithTimeout does `try { return await fetchFn(...) } finally { clearTimeout(timer); }`, so the timer is cleared when the headers arrive. Every caller then reads the body outside any timeout: `data = await response.json()` in post() (line 96), in status() (line 121) and in sharedLibrary.ts:21. I ran a node server that sends headers plus half a body and then stalls, using this exact helper with a 200 ms timeout. The headers arrived after 27 ms and `response.json()` was still pending after 200…
- Fix: Replace fetchWithTimeout with one helper, `fetchJson(url, init, options): Promise<{ ok: boolean; status: number; retryAfter: string | null; data: unknown }>`. It reads `response.json().catch(() => null)` inside the try, so clearTimeout runs only after the body is read. It throws on unreachable or timeout. post() becomes try/catch around one call plus toResult. status() and fetchSharedLibrary shrink to a few lines. Name the 10_000 health timeout next to LIBRARY_TIMEOUT_MS while you are there. Add a test with a stalled body.

## Confirmed but not worth the change (or changes behaviour)

### remix

**damage_weights re-implements templates.damage_dealt_by: same walk, same regex, same type table**  
`backend/src/cauldron/remix/theme.py:68` · redundancy · medium

- Evidence: theme.py:25-29 and 55-85 (`_TYPES`, `_TYPE_ONLY`, `_text_weights`, `damage_weights`) walk all_actions() the same way as templates.py:89-118 (`_DAMAGE_NAMES`, `_DAMAGE_WORD = r"\b([a-z]+) damage\b"`, `_types_named_in`, `damage_dealt_by`). Both go through Attack damage and effects_text, Save on_fail and effects_text, other action text, and legendary option text. With the regex fix, `damage_dealt_by(m) == sorted(damage_weights(m))` for all 353 SRD and sample monsters (I checked). Today they differ…
- Fix: Keep one walk. Put `damage_weights` and the text regex in one small shared module (for example `cauldron/damage.py`; it cannot live in remix.theme because theme.py already imports templates). Then define `damage_dealt_by = lambda m: sorted(damage_weights(m))`. Delete `_types_named_in`, `_DAMAGE_WORD`, `_DAMAGE_NAMES` (templates.py) and the duplicate `_TYPES`/`_TYPE_ONLY` (theme.py). That removes about 25 lines and a whole class of drift.

### web-components

**FilterBar re-implements DropMenu: a second open/close-on-outside/Escape menu, with its own CSS**  
`frontend/src/components/FilterBar.tsx:125` · redundancy · medium

- Evidence: FilterBar's useEffect (lines 125-147) adds document pointerdown, focusin and keydown(Escape, refocus button) listeners, which is the same effect as DropMenu.tsx lines 40-64. Its `Menu` component (90-114) is a button plus a conditionally mounted panel with role=group and aria-expanded, which is DropMenu's markup. `openMenu` state, the `buttons` ref and the `menu()` prop helper exist only to do what DropMenu's OPENED_EVENT already does (one menu open at a time). styles.css carries two parallel ru…
- Fix: Render each filter group as `<DropMenu label={<>{title}{count > 0 && <span className="filter-count">{count}</span>} <span aria-hidden>▾</span></>} buttonClassName="menu-button" panelClassName="menu-panel" align={...}>`. Delete Menu, MenuProps, openMenu, buttons, the effect and menu(), about 70 lines of TSX. Fold `.menu-panel` into `.dropmenu__panel`, or keep only its size rules. `align` replaces the `:nth-last-child(-n+3)` right-alignment hack.

### core-models

**AttackAction accepts data that describe() prints as nonsense (empty damage, reversed range, no distance)**  
`backend/src/cauldron/actions.py:133` · logic-error · low

- Evidence: `damage: list[DamageRoll]` has no min_length, and describe always builds `f"Hit: {_damage_list(self.damage)}."`. I ran an AttackAction with `damage=[]` and got 'Hit: .'; with effects_text it becomes 'Hit: . The target ...'. SaveAction handles an empty `on_fail` (`if self.on_fail:`) but AttackAction does not. `Range(normal=120, long=20)` is accepted and prints 'range 120/20 ft.'. An AttackDetails with neither `reach` nor `range` prints 'Melee Weapon Attack: +4 to hit, one target.' with no distan…
- Fix: Add `Field(min_length=1)` to AttackAction.damage. Add a `model_validator` on Range (`long >= normal`). Add one validator on AttackDetails that requires `reach` for melee modes and `range` for ranged modes. This is about 8 lines and removes three silent failure modes. Mirror the empty-damage rule in frontend renderAction.ts or its types if they are shared.

**Whole-word match misses plurals and joined or apostrophe-free spellings of blocked names**  
`backend/src/cauldron/blocklist.py:74` · logic-error · low

- Evidence: `if _words(term) in haystack` only matches the exact padded word. I ran blocked_term on these names and all returned None: 'Swarm of Beholders', 'Mind Flayers', 'Spectators', 'Beholderkin', 'Mindflayer', 'Grazzt'. 'Beholder' and 'Githyanki Knight' are caught. The AI generator and reskin names are free text, and 'Swarm of Gauths' or 'Mind Flayers' are natural names. This is separate from the accent problem already reported.
- Fix: Build the matchers once at import time as a dict of compiled regexes. Give each term an optional plural, `re.compile(rf' {re.escape(words)}(?:e?s)? ')` against the padded haystack. For multi-word and apostrophe terms, also compare against the haystack with spaces removed, restricted to terms of 6 or more characters so 'gith' does not match inside other words. Add the plural and joined cases to test_validator's blocked-name parametrization.

**Average-hit-points arithmetic is retyped in the validator and the level-up template because dice.py has no count/sides/bonus form**  
`backend/src/cauldron/dice.py:43` · redundancy · low

- Evidence: average_dice does `(parsed.count * (parsed.sides + 1) + 2 * (parsed.bonus + extra_bonus)) // 2` and only takes a string. validator.py:171-175 (HitPointsCheck) and templates.py:240-248 (_hit_points) each rebuild the same thing: `bonus = count * con; average = max(1, (count * (sides + 1) + 2 * bonus) // 2); format_dice(count, sides, bonus)`. The same formula, the same `max(1, ...)` clamp and the same pairing with format_dice exist in two places outside dice.py. If the rounding rule changes, three…
- Fix: In dice.py add `average_of(count, sides, bonus=0)`, and have average_dice call it with the parsed parts. In monster.py add `HitPoints.for_dice(count, sides, con_modifier)`, returning `HitPoints(dice=format_dice(count, sides, count*con_modifier), average=max(1, average_of(...)))`. HitPointsCheck and LevelUpTemplate._hit_points then each call it once. This removes about 8 duplicated lines and puts the 'at least 1 HP' rule in one place.

**The Challenge block is rebuilt from a CR label by hand in five production sites and two tests**  
`backend/src/cauldron/monster.py:176` · redundancy · low

- Evidence: Challenge(cr, cr_value, xp, proficiency_bonus) is always derived from the label with the same three rules calls: validator.py:150-153 (`wanted = {'cr_value': cr_value(label), 'xp': xp_for_cr(label), 'proficiency_bonus': proficiency_bonus(label)}`), templates.py:222-227, service/draft.py:112 (`Challenge(cr=draft.cr, cr_value=cr_value(draft.cr), xp=xp_for_cr(draft.cr), proficiency_bonus=proficiency_bonus(draft.cr))`), seed/importer.py:209, and the tests at tests/service/test_service.py:66 and tes…
- Fix: Add `@classmethod def for_label(cls, label: str) -> 'Challenge'` to Challenge (monster.py may import rules.py; rules only imports options, so there is no cycle). Then: draft.py uses `Challenge.for_label(draft.cr)`; templates.py uses `monster.challenge = Challenge.for_label(new_cr)`; DerivedFieldsCheck compares `Challenge.for_label(label)` with `monster.challenge` field by field; the importer uses `Challenge.for_label(label)` and applies its CR 0 xp override with model_copy; the tests use it too. This removes about 20 lines and leaves one place that knows what 'derived' means.

### cr-estimator

**estimate_with computes the defence and offence halves with the same recipe copy-pasted**  
`backend/src/cauldron/cr/estimator.py:61` · redundancy · low

- Evidence: Defence: `hp_position = invert(hp_curve, hp)`; `ac_gap = ac - value_at(ac_curve, hp_position)`; `invert(hp_curve, hp * _scale(ac_weight, ac_gap))`. Offence: `dpr_position = invert(dpr_curve, dpr)`; `gap = ... offense_bonus - value_at(bonus_curve, dpr_position)`; `invert(dpr_curve, dpr * _scale(bonus_weight, gap))`. The two blocks differ only in which curve, value, adjuster and weight they use, and each has its own variable names for the gap.
- Fix: Extract `_position(curve, value, adjust_curve, adjust_value, weight)`: `position = invert(curve, value); gap = 0.0 if adjust_value is None else adjust_value - value_at(adjust_curve, position); return invert(curve, value * _scale(weight, gap))`. Then `defensive = _position(c.hp_curve, m.effective_hp, c.ac_curve, m.ac, c.ac_weight)` and `offensive = 0.0 if m.dpr <= 0 else _position(c.dpr_curve, m.dpr, c.bonus_curve, m.offense_bonus, c.bonus_weight)`. The None-bonus case is handled in one place, and the docstring comments become the helper's docstring. The existing hand-checkable SIMPLE tests co…

**The reliability and tolerance policy is split across Calibration, raw table constants and the validator**  
`backend/src/cauldron/cr/estimator.py:87` · structure · low

- Evidence: estimator.py imports the generated table lazily inside two functions (`from cauldron.cr import calibration_table as t` at lines 89 and 114), although validator.py:26 imports it at module level anyway. `RELIABLE_UP_TO` is stored as a label, so `CR_LABELS.index(...)` is done in estimator.py:99 and again in validator.py:334 (`not estimated.reliable or claimed > CR_LABELS.index(RELIABLE_UP_TO)`), while TOLERANCE_BANDS is stored as ladder indices. `estimate()` rebuilds a Calibration on every call. I…
- Fix: Make the table store `RELIABLE_UP_TO_STEP = 24` (an index, like the bands), so neither estimator nor validator converts labels. Add `reliable_up_to() -> int` beside `tolerance_steps` and have the validator use `estimated.reliable and claimed <= reliable_up_to()`, so it no longer imports the table. Import the table once at the top of estimator.py, cache `committed_calibration()` with `@functools.cache`, and make the end of tolerance_steps `return bands[-1][1]` or remove it.

### cross-language

**swap_damage_type and retarget_name each hand-write the same 'rewrite every prose field' walk**  
`backend/src/cauldron/templates.py:39` · redundancy · low

- Evidence: Both rebuild actions, bonus_actions, reactions, traits and legendary options with a text function. Legendary options: line 55 `legendary.model_copy(update={"options": [o.model_copy(update={"text": words(o.text)}) ...]})` and line 152 `... said(o.text) ...` are the same line. Traits: lines 50-51 and 159. Per-kind action dispatch: lines 39-48 and 145-148. In swap_damage_type the MultiattackAction branch (44-45) and the TextAction branch (46-47) are identical, and the Attack and Save branches diff…
- Fix: Add one private helper, `_map_text(monster, fn) -> dict`, that returns the update dict for actions, bonus_actions, reactions, traits and legendary_actions with `fn` applied to every effects_text/text. Then swap_damage_type is `{**_map_text(monster, words), <roll swaps>}` and retarget_name is `{**_map_text(monster, said), <spellcasting intro/footer>}`. The Multiattack/Text duplicate disappears, and about 25 lines go. A third text-rewriting need (for example Remix renames) then costs one call instead of a third copy.

**Sample and SRD loading is repeated in about 12 backend test files, with no shared root conftest**  
`backend/tests/remix/conftest.py:15` · redundancy · low

- Evidence: The `samples` fixture is character-for-character the same in tests/remix/conftest.py:15-17 and tests/service/conftest.py:13-15. The same path and load-and-validate line is also written as module-level code in tests/test_monster.py:14-15, test_templates.py:19-20, test_validator.py:37-38, test_cross_language.py:15, cr/test_measure.py:15 and seed/test_tagger.py:16. The SRD raw path is spelled out in remix/conftest.py:11, seed/conftest.py:8, cr/test_estimator.py:14-15 (which also runs import_all), …
- Fix: Add backend/tests/conftest.py with `SAMPLES_PATH` and `SRD_RAW_PATH` computed once, plus session fixtures `samples`, `sample` (a name lookup that fails with a clear message), `raw_monsters` and `srd`. Delete the two nested `samples` fixtures and the per-file loaders. For files that parametrize at import time, add `pythonpath = ["tests"]` to the pytest settings and import `SAMPLES` from a small shared sample_data.py. This removes about 60 lines and the five places a file move would break.

**Production logic (damageDealtBy, createGenerator) lives in the demo-generator file**  
`frontend/src/lib/demoGenerator.ts:54` · structure · low

- Evidence: ReskinPanel.tsx:2 and remixMoves.ts:2 import `damageDealtBy` from './demoGenerator', and App.tsx:42 imports `createGenerator` from the same file. Both are real-app code: damageDealtBy builds the reskin damage menu and the move menu, and createGenerator chooses the live, offline or demo generator. The file header says it is 'a stand-in generator ... only when the page is opened with ?generator=demo'. The only demo-only exports are createDemoGenerator and swapDamageType. Separately, `typesNamedIn…
- Fix: Move `typesNamedIn` and `damageDealtBy` into a new lib/damageDealt.ts, with its tests, and add the `\b` anchors to match Python. Move `createGenerator` to lib/createGenerator.ts or into liveGenerator.ts. demoGenerator.ts then holds only the demo and imports from the new file. A cross-language check is cheap: write damage_dealt_by for every sample into the golden JSON, like the prose golden.

**Demo reskin picks the alphabetically first damage type as the main one, from the un-swapped base**  
`frontend/src/lib/demoGenerator.ts:539` · logic-error · low

- Evidence: `const main = damageDealtBy(base)[0];` where damageDealtBy ends with `return [...found].sort();`, then `monster = swapDamageType(monster, main, themeChosen); changes.push(`Main damage: ${main} -> ${themeChosen}`)`. The list is sorted, so [0] is 'acid' before 'fire' regardless of which type the monster mostly deals. It is also read from `base` after a `damageSwap` may already have replaced that type in `monster`.
- Fix: Name the choice honestly (e.g. `firstDamageType`) and compute it from `monster` (the already-swapped result) instead of `base`. Only push the change line when the swap actually altered something. If the demo does not need this precision, drop the theme step and keep only damageSwap.

**17 frontend test files cast the sample JSON themselves and four re-define a name lookup; lib/testing has no shared sample helper**  
`frontend/src/lib/testing/srdMonsters.ts:6` · redundancy · low

- Evidence: `const monsters = sample as unknown as Monster[]` (plus the json import) appears in crossLanguage, encounter, exportJson, favorites, filters, fiveTools, fiveToolsSpells, foundry, generatedStore, generatorApi, liveGenerator, party, remixMoves, renderAction, sharedLibrary and spellcastingText tests, and again in testing/srdMonsters.ts:6 itself. Name lookups with a non-null `!` are re-written as `byName` in fiveTools.test.ts:15, foundry.test.ts:21 and renderAction.test.ts:10, and as `named` in rem…
- Fix: Add lib/testing/sampleMonsters.ts next to the existing helpers: `export const sampleMonsters = sample as unknown as Monster[];` and `export function sampleNamed(name: string): Monster { const m = sampleMonsters.find(x => x.name === name); if (!m) throw new Error(`No sample monster called ${name}`); return m; }`. Replace the per-file casts and lookups, and let srdMonsters.ts import `sampleNamed('Stormhide Drake')`. About 17 casts and 4 helpers go, and the cast to the type lives in one place.

### css

**Base `.panel` and `.filter-bar` rules are overridden by the 'Grim dark' section appended 1,200 lines later**  
`frontend/src/styles.css:227` · redundancy · low

- Evidence: Line 226 says "A bordered, tinted box" and sets `padding: 0.6rem 0.75rem; border: 1px solid var(--panel-border); background: var(--panel)` on .panel (227-234). .filter-bar (786-795) likewise sets padding 0.4rem 0.6rem, border and background. Then line 1418 `.panel, .filter-bar { ... border: 0; background: transparent; padding: 0.8rem 1rem; }` overrides all three, so the values and the comment are wrong. The declared `border-radius: 6px` is also not what is drawn (the pseudo-elements use 3px). T…
- Fix: Fold the final values into the first definitions: one `.panel, .filter-bar { position: relative; isolation: isolate; padding: 0.8rem 1rem; }` plus the layout-only declarations, and delete the dead border/background/padding lines. Move the `.app` z-index and `.monster-list` max-height/overflow into their main rules, and move the two texture tokens into the top `:root`. The file shrinks and each selector's real values live in one place.

**Scrolling .panel leaves its paper background behind**  
`frontend/src/styles.css:675` · logic-error · low

- Evidence: Desktop rule `.panel { display:flex; flex-direction:column; min-height:0; overflow-y:auto; }` while the 'Grim dark' section draws the paper with `.panel::before/::after { position:absolute; inset:0; }`.
- Fix: Keep the panel itself `overflow: visible` and give the scrolling to an inner wrapper. Or paint the paper on the panel with `background-attachment: local` instead of pseudo-elements. Or at least `overflow:hidden` the panel and let the existing lists scroll, and delete the overflow-y fallback.

**Two parallel dropdown implementations: `.menu/.menu-panel` (FilterBar) and `.dropmenu/.dropmenu__panel` (DropMenu)**  
`frontend/src/styles.css:810` · structure · low

- Evidence: `.menu-panel` (829-843) and `.dropmenu__panel` (1165-1181) share the same position:absolute, top: calc(100% + ~0.3rem), z-index, max-height, overflow-y:auto, padding, 1px --panel-border, radius 6px, --field background and box-shadow, differing only in tiny values (0.25 vs 0.35rem, 60 vs 70vh, shadow 0.25 vs 0.45). The phone block is copied twice (853-866 `.menu{position:static}` + `left/right:.75rem` and 1553-1568 `.dropmenu{position:static}` + `left/right:.5rem`). FilterBar.tsx's own `Menu` re…
- Fix: Render the filter menus with `<DropMenu label={...} align="left"|"right">` (count badge goes in `label`, ReactNode) and delete `.menu`, `.menu-button`'s duplicate box rules, `.menu-panel`, the nth-last-child rule and one of the two phone blocks, plus FilterBar's ~35 lines of effect/ref code. Pass `align="right"` explicitly for the last menus instead of counting siblings.

### dead-code

**AttackAction.conditions is never set or read, yet it is advertised to the AI**  
`backend/src/cauldron/actions.py:116` · bloat · low

- Evidence: `conditions: list[str] | None = None` (the TypeScript mirror is `conditions?: string[]` at types/monster.ts:40). None of the 333 SRD actions or the sample monsters has it. describe() never prints it, no validator check, template, export or component reads it, and no test sets it. draft_json_schema() is built from MonsterDraft, so I confirmed the schema sent to Haiku contains `"conditions": {"anyOf": [...array of string, null...]}`. The model can fill it, and the value then disappears from the s…
- Fix: Delete the field from AttackAction (actions.py:116) and from AttackAction in types/monster.ts:40. If a condition rider is wanted later, put it in `effects_text`, which describe() already prints.

**The body size limit trusts the Content-Length header, so a chunked request bypasses it**  
`backend/src/cauldron/service/app.py:98` · logic-error · low

- Evidence: `length = request.headers.get('content-length'); if length and length.isdigit() and int(length) > MAX_BODY_BYTES:` A request sent with Transfer-Encoding: chunked has no Content-Length, passes this middleware and is read in full by FastAPI before validation. MAX_BODY_BYTES (64_000) therefore protects nothing against a client that omits the header. The failure body is also hand-built here although _failure_response exists.
- Fix: Either read the body with a hard cap (wrap receive and count bytes, or let the reverse proxy enforce client_max_body_size), or drop the middleware and rely on the proxy so the code does not claim a limit it does not enforce.

**With no API key every request still burns a call from the daily cap, so the forge reports 'resting' without any AI call ever being made**  
`backend/src/cauldron/service/service.py:108` · logic-error · low

- Evidence: create() and create_reskin() do `if not self._cap.reserve(): ...` before `self._generator.generate(...)`. build_generator() returns UnavailableGenerator when ANTHROPIC_API_KEY is unset, and its generate()/rename() always raise GeneratorUnavailable. The reserved call is never refunded, so 150 requests (the default cap) flip /health to 'resting' and the message from 'could not be reached' to 'back tomorrow', although nothing was spent and nothing can be. The DailyCap docstring justifies counting …
- Fix: Reserve the call only when the generator can actually make one (give MonsterGenerator an `available` property that UnavailableGenerator sets to False), or refund the reservation when GeneratorUnavailable is raised before any request was sent.

**find() parses and validates every matching row, then keeps only the first 50 (which also means the cache only serves the oldest 50)**  
`backend/src/cauldron/service/store.py:142` · complexity-time · low

- Evidence: `found = [m for m in (Monster.model_validate_json(row[0]) for row in rows) if matches(m, request)]` then `return found if limit is None else found[:limit]`. service.lookup calls find(..., limit=50) on every /generate. All rows passing the SQL filter are fetched and fully parsed through Pydantic on each request, however many there are. Because rows are ordered by rowid and cut at 50, `rng.choice(found)` only ever picks among the 50 OLDEST matching monsters; newer generated monsters are never han…
- Fix: Stop early with itertools.islice over the lazy generator, and use `ORDER BY rowid DESC` (or RANDOM()) in the SQL so newer monsters are reachable. Use `LIMIT` in SQL where the only Python-side rules are cheap.

### gap-1

**Both export handlers repeat the same work, and the monster/monsters plural is written five times**  
`frontend/src/components/EncounterPanel.tsx:91` · redundancy · low

- Evidence: handleExport and handleExportFiveTools each do `cleanName(working.name)`, `exportFileName(...)`, `downloadTextFile(filename, toJsonText(file))` and `new Date().toISOString()`, then build a "Download started: ..." string. The pattern `n === 1 ? "monster" : "monsters"` appears at lines 101, 110, 127 and 271 (twice).
- Fix: Add `const monstersText = (n: number) => `${n} ${n === 1 ? "monster" : "monsters"}``. Pull the shared tail into one helper such as `finishExport(filename, file, detail)` that downloads and calls setExportStatus(`Download started: ${filename} (${detail})`). Each handler then only builds its file and its detail text.

**The two export status messages count different things under the same word "unavailable"**  
`frontend/src/components/EncounterPanel.tsx:98` · logic-error · low

- Evidence: handleExport uses `summary.missingCount` (monsters: a row of 3 missing gloomcaps counts as 3) and prints `${unavailable} unavailable listed but not counted`. handleExportFiveTools uses `summary.lines.length - known.length` (rows: the same missing row counts as 1) and prints `${skipped} unavailable left out`.
- Fix: Pick one unit. Rows is simplest, and it matches the "Unavailable monster" row label. Compute `const unavailable = summary.lines.filter(l => !l.monster).length` in one place and have both handlers use it. Note that missingCount also covers monsters that exist but have unusable XP, while the 5etools export only drops monsters that are missing from the library.

### gap-2

**Skill-name lookup written twice and rescanned for every skill**  
`frontend/src/lib/foundry.ts:99` · redundancy · low

- Evidence: Line 99: `Object.entries(monster.skills).find(([name]) => skillFor(name)?.id === skill.id)?.[1]` runs inside the loop over all 18 skills. Line 149 repeats the same find for "prc". Line 109 loops over the keys again to find unknown skill names.
- Fix: Build one `Map<skillId, total>` before the loop, e.g. `for (const [name, total] of Object.entries(monster.skills)) { const s = skillFor(name); if (s) totals.set(s.id, total); else notes.push(...) }`. Then use `totals.get(skill.id)` in the loop and `totals.get("prc")` for passive Perception. This also removes the third loop and means each name is resolved once.

**Legendary Resistance counter is only read from the exact name form '(N/Day)'**  
`frontend/src/lib/foundry.ts:194` · logic-error · low

- Evidence: `/^Legendary Resistance \((\d+)\/Day\)/i` requires `)` straight after `Day`. A generated or edited trait named "Legendary Resistance (3/Day, or 4/Day in Lair)" does not match. The counter then stays at 0 and no "text only" note is added, even though the monster has the trait. The SRD data only uses the plain form, so tests do not catch this.
- Fix: Drop the closing-paren requirement: `/^Legendary Resistance \((\d+)\/Day/i`. The first number is the normal count.

**Catch-all try/catch hides programming errors as 'unreadable dice' notes**  
`frontend/src/lib/foundryItems.ts:43` · logic-error · low

- Evidence: proseHtml wraps renderAction in `try { ... } catch { notes.push("Could not write the description...") }` and damagePart wraps parseDice in `catch { ... "the dice could not be read" }`. Neither checks what was thrown. A TypeError from a real bug (a missing field in a renderer, say) is reported to the user as bad dice and passes the tests.
- Fix: Have parseDice throw one named error, such as DiceParseError. In both catch blocks, rethrow anything that is not an instance of it (`if (!(e instanceof DiceParseError)) throw e;`). Tests for bad dice keep passing and real bugs surface.

**Empty target template, empty damage part and source block each written more than once**  
`frontend/src/lib/foundryItems.ts:95` · redundancy · low

- Evidence: NO_TEMPLATE (line 95) repeats the inline `template: { count: "", contiguous: false, type: "", size: ... }` in baseActivity (line 84). emptyBase() (line 166) and `versatile: { number: null, denomination: null, bonus: "", types: [], custom: {...}, scaling: {...} }` (line 223) are the same shape as damagePart's output. sourceBlock() (line 52) duplicates the system.source literal in foundry.ts lines 204-211. plainUses() (line 63) and baseActivity's `uses` (line 89) are also the same object.
- Fix: Define NO_TEMPLATE above baseActivity and use it there (spread it where the override is needed). Make one emptyDamage() helper and use it for both versatile and base, with the denomination difference as a parameter or a spread. In foundry.ts, call a shared source helper that takes the custom string. Use plainUses() in baseActivity.

**weaponItem and spellAttackItem repeat the same attack-activity setup**  
`frontend/src/lib/foundryItems.ts:248` · redundancy · low

- Evidence: Both builders compute the id, the `range: { value: String(ranged ? (range?.normal ?? "") : reach...) , units: "ft", special: "", override: false }` object, the `type: { value: ranged ? "ranged" : "melee", classification: ... }` object, and the `damage: { critical: { bonus: "" }, includeBase, parts }` wrapper. The only differences are `flat`, `bonus`, `classification` and `includeBase`. The reach default `reach ?? 5` is written twice, once as `reachValue` in weaponItem and once inline in spellAt…
- Fix: Add one `attackActivity(ctx, id, action, activationType, { classification, flat, bonus, includeBase, parts })` helper, plus a single `const reachOf = (a) => a.attack.reach ?? 5` for the default. Each builder then only supplies what differs, which saves about 25 lines.

### gap-3

**current_theme lives in engine but apply_theme re-derives the same 'old theme' by hand**  
`backend/src/cauldron/remix/engine.py:48` · structure · low

- Evidence: engine.current_theme: primary_damage elemental, else damage_themes[0], else type default. theme.apply_theme lines 131-135 repeat the same primary/else-first-tag logic as `old_theme`. Also engine._THEMES (value->DamageTheme dict) duplicates theme._THEMES (value set), and RemixResult(monster, changes) is field-for-field identical to theme.ThemeResult.
- Fix: Move current_theme (and one _THEMES dict) into theme.py and have apply_theme call it for old_theme; reuse ThemeResult as the engine's return type (or alias RemixResult = ThemeResult) instead of a second identical dataclass.

**Context.roll floor of 2 ignores the fraction and can break the 'never more than best attack' rule**  
`backend/src/cauldron/remix/moves.py:54` · logic-error · low

- Evidence: `return dice_for(max(2, int(self.budget * fraction)), self.damage_type)`. The docstring says 'worth `fraction` of the budget (never more)'. With budget 2 (any best attack of 2-3), every fraction below 1 still returns 2, the whole budget. So the 0.34 burn/aura/backlash rider on top of a 0.75 attack (Rider+fire, OpeningStrike's 0.6 attack plus a 0.5 extra) each carry 2 or 3 on top of an attack that already carries 2. Together they exceed the monster's best attack, which the module docstring says …
- Fix: Name the floor once (`_MIN_DAMAGE = 2`) and use it in all four places. Decide honestly what a tiny budget means: skip the secondary rider damage when the budget is below about 6, or fix the docstring to say 'at least 2'. Do not claim 'never more'.

**dice_for caps at 12 dice, so strong monsters get a far weaker signature move than their budget, and it loops with string parsing**  
`backend/src/cauldron/remix/moves.py:89` · logic-error · low

- Evidence: `while average_dice(f"{count + 1}d{sides}") <= average and count < 12`. Running it: dice_for(300) returns 12d12 (average 78), so a CR 20+ monster with a 225 budget gets a move worth a third of that. Each loop step builds a string and re-parses it through parse_dice. The 12 is a magic number and nothing says why.
- Fix: Replace the loop with arithmetic. `count = (2 * average) // (sides + 1)`, `reached = count * (sides + 1) // 2`, and skip the die when count is 0. Then pick the best (reached, sides) as now. This removes the cap, the f-string parsing and the while loop. If a limit is wanted, make it a named constant with a reason.

**Most moves are the same one-line builder with different fraction and text**  
`backend/src/cauldron/remix/moves.py:197` · redundancy · low

- Evidence: Rider, OpeningStrike, Drain, Lob, Sunder, GraspingStrike, SlowingTouch all end in `return self._done(ctx, actions=[self._attack(ctx, F, effect)])`; Burst/Spray/Dazzle/DreadPresence all `_done(ctx, actions=[self._save(..., recharge=Recharge(min=5))])`; Aura/DeathBurst/Backlash differ only in text. SlowingTouch's effect string is also copied verbatim from Rider's COLD branch (line 206 vs 270).
- Fix: Add an `AttackMove(Move)` base with class attribute `fraction` and an `effect(ctx) -> str | None` method, whose `build` does the _done/_attack call once; each subclass then holds only key/label/blurb/fraction/effect. Share the 'speed halved' sentence as one helper used by Rider(COLD) and SlowingTouch. Do the same for the recharging-save moves (area, ability, effect).

**Lob is offered to monsters that already have ranged attacks, contradicting its own blurb**  
`backend/src/cauldron/remix/moves.py:236` · logic-error · low

- Evidence: `blurb = "A ranged attack in the theme's damage, for monsters that otherwise fight up close."` but Lob uses the default `applies_to` (only checks best attack >= 2). An archer or spellcaster sees Lob in the menu, and 'surprise' can pick it for them. The blurb is also mirrored in the front end by test_menu_matches_frontend.
- Fix: Override `applies_to` in Lob to also require that no AttackAction in monster.actions has a ranged mode. Or change the blurb to say what the move really is ('A ranged attack in the theme's damage'), and update the front-end copy to match.

**apply_theme is a 60-line function with a nested closure doing four jobs**  
`backend/src/cauldron/remix/theme.py:121` · readability · low

- Evidence: One function swaps damage type, picks old_theme, trades immunity/resistance via the inner `trade` closure (mutating the lists passed in with `items[:] = ...`), adds the vulnerability, edits damage_text, builds change messages, then model_copy. _describe also reports only removed[0]/added[0] and its params are named `label_set`/`label_verb`.
- Fix: Split into `_trade_defence(items, old, new) -> list` (returning a new list instead of mutating), `_add_vulnerability(...)`, and `_edit_damage_text(...)`; rename _describe params to `noun` and `verb_phrase`.

### remix

**The 'move exists and fits this monster' check is written twice, in resolve and in remix**  
`backend/src/cauldron/remix/engine.py:92` · redundancy · low

- Evidence: resolve: `chosen_move = _find(move); if not chosen_move.applies_to(monster): raise ValueError(f"The move {chosen_move.label} does not fit this monster.")`. remix: `move = _find(move_key) ...; if move is not None and not move.applies_to(monster): raise ValueError(f"The move {move.label} does not fit this monster.")`. The message text is duplicated, and the same pair of rules is tested twice (test_a_move_that_does_not_fit_is_an_error and test_a_move_that_does_not_fit_is_refused_when_chosen_by_nam…
- Fix: Add one helper, `_fitting_move(monster, key) -> Move`, that does the lookup and the fit check, and call it from both places. Or have resolve only choose, and let remix be the only place that validates. Then keep a single test for the refusal.

**Context.roll says 'never more' than the budget, but its max(2, ...) floor overshoots small budgets**  
`backend/src/cauldron/remix/moves.py:52` · logic-error · low

- Evidence: `"""A damage roll ... worth `fraction` of the budget (never more)."""` followed by `dice_for(max(2, int(self.budget * fraction)), ...)`. For any budget from 2 to 5, a 0.34 fraction gives int(0.68..1.7) = 0 or 1, which is floored to 2. So the Aura, Backlash and Rider burn rolls cost 40-100% of the budget instead of 34%, and Opening Strike's conditional extra roll (0.5) does the same. test_no_move_deals_more_than_the_monsters_best_attack only measures `action_damage` of the attack's damage list, …
- Fix: Correct the docstring to say 'at least 2'. Make the test add the damage quoted in each move's effects text (reuse theme._AMOUNT_AND_TYPE or measure._text_damage) and drop the +0.5 slack. If the overshoot is not wanted, return None or skip the extra damage when the scaled amount is under 2, instead of rounding up.

### seed

**A rejected monster is dropped from the shipped file and the command still exits 0**  
`backend/src/cauldron/seed/__main__.py:33` · logic-error · low

- Evidence: payload is built from result.monsters only, the files are written first, and then `if result.rejected: print(f"{len(result.rejected)} monsters were rejected; see the report.")` is the only signal. main() returns normally, so the exit code is 0.
- Fix: If result.rejected is non-empty, write the report, then call sys.exit(1), ideally before overwriting srd-monsters.json. A scripted or CI run then fails loudly instead of quietly publishing a smaller data file.

**import_monster is a 100-line function doing six jobs, and builds a Monster with placeholder tag fields only to patch them afterwards**  
`backend/src/cauldron/seed/importer.py:129` · readability · low

- Evidence: One function (l.129-232) applies overrides, builds abilities, reconciles XP and proficiency bonus against the SRD tables (l.138-146), splits traits from spellcasting (l.148-163), defines a nested `actions()` closure (l.165), builds legendary actions, converts three damage lines into lists plus DamageText (l.176-182), assembles a 35-field Monster, then tags it. The Monster is first built with `environments=[]`, `role="brute", # replaced just below`, `damage_themes=[]`, `features=[]`, then copied…
- Fix: Extract three private helpers that return plain values: `_challenge(raw, notes) -> Challenge` (the label, pb, xp and note logic), `_traits_and_spellcasting(raw, abilities, pb, notes) -> tuple[list[TextAction], Spellcasting | None]`, and `_damage_modifiers(raw) -> tuple[lists..., DamageText | None]`. Move the build, tag and copy step into `_with_tags(monster)` with a one-line comment explaining why tags need a built Monster. import_monster then reads top to bottom as about 40 lines of assembly. Keep the output identical, since the 333-monster round-trip tests cover it.

**A later spellcasting entry overwrites an earlier parsed one, which was already dropped from the traits, so data can be lost**  
`backend/src/cauldron/seed/importer.py:151` · logic-error · low

- Evidence: The loop at l.151-156 does `spellcasting = parse_spellcasting(entry, abilities, pb)`; `if spellcasting is not None: continue`. If a monster has two spellcasting entries (say "Spellcasting" and "Innate Spellcasting") and the first parses, it is skipped from `traits`. A second entry that fails to parse then resets `spellcasting` to None, so the first one's spells vanish from the monster entirely. This breaks the module's stated rule that nothing is lost. If the second also parses, the first is si…
- Fix: Parse into a local variable and keep only the first success: `parsed = parse_spellcasting(entry, abilities, pb)`, then `if parsed is not None and spellcasting is None: spellcasting = parsed; continue`. Anything else falls through to the text-trait path with the existing note.

### service-core

**monster_from_draft sets identity fields that GenerationService._accept overwrites at once**  
`backend/src/cauldron/service/draft.py:102` · redundancy · low

- Evidence: haiku.py:68 calls `monster_from_draft(draft, generator=self._model, new_id=f"gen-draft-{uuid.uuid4().hex[:6]}")`, which sets id, source=AI, validated=False, generator and schema_version. service._accept then calls `self._rebuild(monster, id=_new_id(monster.name), source=Source.AI, validated=False, generator=generator, parent_id=None)`, which replaces id, source, validated and generator. That is a second dump-and-validate round trip.
- Fix: Have monster_from_draft take no new_id or generator and leave those fields at their defaults. Let `_accept` be the only place that assigns id, source, validated and generator. Alternatively drop the `_rebuild` keywords that repeat what the draft already set (source, validated, parent_id).

**Tokens are never recorded for attempts that came back as BadOutput, though the API billed them**  
`backend/src/cauldron/service/service.py:117` · logic-error · low

- Evidence: In create(): `except BadOutput as problem: feedback = [str(problem)]; ...; continue` comes BEFORE `self._cap.record_tokens(generated.input_tokens, generated.output_tokens)`, and the same shape is in create_reskin (lines 214-218). But haiku.py raises BadOutput only AFTER the response arrived with usage: `_tool_input` raises for stop_reason "max_tokens" (a full max_output_tokens=4000 reply) and "refusal", and generate()/rename() raise it on a schema failure. Those tokens are billed but the ai_usa…
- Fix: Give BadOutput `input_tokens` and `output_tokens` attributes (default 0), have HaikuGenerator pass `response.usage` values when it raises, and call `self._cap.record_tokens(...)` in the `except BadOutput` branch too (one place once the two loops are merged, see the retry-loop finding).

### service-infra

**load_library accepts a half-empty library silently, and its test pins a magic count**  
`backend/src/cauldron/service/app.py:51` · logic-error · low

- Evidence: `if not path.exists(): continue` with a `found` flag only raises when BOTH files are missing. If srd-monsters.json is absent, the server starts with 20 monsters and every SRD reskin answers 'That monster is not known to the forge' with no hint why. The function is also data loading living in the 'deliberately thin' web module, so main.py and smoke.py import FastAPI-side code just to read JSON. test_api.py:305 asserts `len(library) == 353`, a third copy of counts (20 samples + 333 SRD) already g…
- Fix: Require every file: `for name in LIBRARY_FILES: for raw in json.loads((settings.library_dir / name).read_text(encoding="utf-8")): ...`. A missing file then raises FileNotFoundError naming the path, so the `found` flag, the exists() check and the custom message go away (about 6 lines). The existing missing-folder test still passes. In the test replace 353 with a check that every id from both files is present. Optionally move the function next to the settings or store code.

**Duplicate monster ids across library files silently overwrite each other**  
`backend/src/cauldron/service/app.py:60` · logic-error · low

- Evidence: for raw in json.loads(...): monster = Monster.model_validate(raw); library[monster.id] = monster -- no check that monster.id is already in library.
- Fix: Raise ValueError(f"Duplicate monster id {monster.id}") when monster.id is already in library; one line, and the existing load test then guards the data files.

**GET /library skips the rate limiter and does unbounded O(N) work per call, twice over**  
`backend/src/cauldron/service/app.py:139` · complexity-time · low

- Evidence: library() has no cache_limiter check (unlike generate and reskin). It calls store.all(), which model_validate_json()s every stored row (21 ms for 353 monsters in a probe), then app.py runs model_dump(mode="json", exclude_none=True) on every one again. The rows already hold exactly that JSON in the `json` column. The page (frontend/src/lib/sharedLibrary.ts) keeps only data.slice(0, MAX_SHARED = 5000), but the server returns everything, and the table only grows.
- Fix: Add the same 3-line cache_limiter guard used in the other endpoints. Cap the query with `LIMIT 5000` (or a named constant shared with the page). Optionally add a store method that returns the raw `json` strings and join them as "[" + ",".join(rows) + "]" in a Response(media_type="application/json"), skipping both pydantic passes.

### validator-templates

**swap_damage_type and retarget_name each re-implement "rewrite every prose field of a monster"**  
`backend/src/cauldron/templates.py:33` · redundancy · low

- Evidence: swap_damage_type defines `words`, `action` (with identical Multiattack and Text branches, 44-47), `trait`, and a legendary-options comprehension (53-55). retarget_name (140-166) defines `said`, `action`, and the same legendary-options comprehension, both ending in the same `model_copy(update={traits, actions, bonus_actions, reactions, legendary_actions ...})`. Only the str->str function differs. The two walks have already drifted: retarget_name also rewrites spellcasting intro/footer, swap_dama…
- Fix: One helper, `_rewrite_text(monster, fn) -> dict` (the update dict for traits, the three action lists, legendary options and spellcasting intro/footer), built on Monster.map_actions from the earlier finding. swap_damage_type then adds only roll changes plus the defences block; retarget_name becomes about 10 lines (pattern plus `said`). Merge the Multiattack and Text branches with `isinstance(a, (MultiattackAction, TextAction))` regardless. Splitting the defences/themes part into `_swap_defences(monster, old, new)` makes the main function readable top to bottom.

**Level-up at CR 30 raises the numbers but leaves the CR unchanged, and the test does not notice**  
`backend/src/cauldron/templates.py:189` · logic-error · low

- Evidence: `new_cr = step_cr(old_cr, 1)` clamps at "30", but AC +1, hit points x1.5, to-hit +1 and damage +1 are applied unconditionally. test_level_up_stops_at_challenge_rating_30 only asserts `level_up(top).challenge.cr == "30"`.
- Fix: If new_cr == old_cr, return the monster unchanged or raise a clear ValueError. Have the caller refuse level-up at the top rung. Make the test assert on the numbers or the refusal, not just the CR label.

**Check.name is an unenforced class attribute**  
`backend/src/cauldron/validator.py:109` · logic-error · low

- Evidence: `name: str` is only an annotation on the ABC. A subclass that forgets `name = ...` still instantiates, and the first `_finding` call raises AttributeError at runtime. The checks also hard-code names such as "derived fields" and "CR consistency", and tests and the service match on those strings.
- Fix: Make `name` an abstract property, or have `_finding` use `type(self).__name__`. Alternatively, check in `Validator.__init__` that every check has a name.

### web-components

**The generator is rebuilt when the SRD list loads, so the shared library and health are fetched twice on every page load**  
`frontend/src/App.tsx:122` · complexity-time · low

- Evidence: `const generator = useMemo(() => createGenerator(window.location.search, monsters, API_URL), [monsters]);` createLiveGenerator ignores `monsters` but still returns a new object, and the effect at lines 126-144 depends on `[generator]`. Render 1 has monsters=[] so it fetches /library (up to 5000 entries) and /health. When loadMonsters() resolves, `generator` changes, `cancelled` is set for the first run, and both requests are sent again. The first pair of responses is thrown away.
- Fix: Quickest: add `libraryReady` to the effect's guard and deps (`if (!libraryReady || generator.mode !== "live" || !API_URL) return;`). setMonsters and setLibraryReady commit together, so the effect then runs once, against the final generator. Heavier fallback: make createDemoGenerator take a `() => Monster[]` getter (or read the list from a ref) so `generator` is built once and never changes identity.

**App mixes library loading, encounter wiring and the whole generator workflow in one 320-line component**  
`frontend/src/App.tsx:169` · structure · low

- Evidence: Six pieces of generator state (generated, generating, generateMessage, shared, libraryNote, forgeStatus), a fetch effect (126-144), `accept` (171-183), `runGenerate` (185-194) and `runReskin` (196-202) all sit beside the filter, party and encounter state. `accept` reads `generated` from the render in which the button was clicked, then writes `[monster, ...generated.filter(...)]` back after an await that can take up to 120 s. That is safe only because `generating` blocks overlap, and the setter …
- Fix: Extract a hook, for example `lib/useForge.ts`: `const forge = useForge({ monsters, generated, setGenerated, onOpen: setOpenId })` returning `{ generator, generating, message, status, libraryNote, shared, generate(request), reskin(request) }`. It owns the generator memo, the shared-library/status effect (and fixes the double fetch), `accept` and the guards. App keeps layout and encounter wiring and drops roughly 55 lines and 6 state variables.

**The 'blocked' flag and the busy/offline/resting status chain are written twice**  
`frontend/src/components/GenerateBar.tsx:29` · redundancy · low

- Evidence: GenerateBar: `const blocked = offline || resting || busy || problem !== null; const status = busy ? "Generating…" : offline ? OFFLINE_MESSAGE : resting ? RESTING_MESSAGE : message || ...`. ReskinPanel.tsx:38 and 147-153: `blocked = offline || resting || busy || !hasChange` and `busy ? "Reskinning…" : offline ? OFFLINE_MESSAGE : resting ? RESTING_MESSAGE : message || ...`
- Fix: Add one helper in lib/generatorApi.ts, `unavailableMessage(mode, resting): string | null`, returning OFFLINE_MESSAGE, RESTING_MESSAGE or null. Both components use `const unavailable = unavailableMessage(mode, resting)`, then `blocked = unavailable !== null || busy || ...` and `status = busy ? "…" : unavailable ?? message || fallback`.

**List keys are the entry names, so duplicate names cause duplicate keys**  
`frontend/src/components/StatBlock.tsx:196` · logic-error · low

- Evidence: `traits.map((trait) => <Entry key={trait.name} .../>)`, `actions.map((action) => <Entry key={action.name} .../>)`, and `legendary.options.map((option) => ... key={option.name}`. The spellcasting trait is appended with the fixed name "Spellcasting" (line 144) after `monster.traits`.
- Fix: Use the index as part of the key, `key={`${i}-${trait.name}`}`. These lists are static and never reordered, so index keys are safe. Apply the same change in ActionSection and LegendarySection.

### web-domain

**partyThresholds clamps the level but does not round it, so a fractional or NaN level throws; the clamp is also written twice**  
`frontend/src/lib/party.ts:92` · logic-error · low

- Evidence: `THRESHOLDS_BY_LEVEL[Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level)) - 1]` indexes the table with the raw number. I ran partyThresholds({ levels: [2.5] }) and ({ levels: [NaN] }): both throw "TypeError: Cannot read properties of undefined (reading '0')". The test is named "clamps out-of-range levels instead of crashing", so the intent is to be forgiving. storage.ts:62 has the same clamp plus `Math.round`: `Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)))`. Nothing reachable today pas…
- Fix: Add `export function clampLevel(level: number): number` to party.ts, next to the constants and in the same style as clampCount in encounter.ts: `Number.isNaN(level) ? MIN_LEVEL : Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)))`. Use it in partyThresholds and in parseParty's `.map(clampLevel)`. Use MIN_PARTY_SIZE in PartyPanel's `range(...)`, or delete it. Add a NaN and 2.5 case to party.test.ts.

### web-export

**"is a pure function of its input" tests cannot fail, and the same test is copied into three files**  
`frontend/src/lib/exportJson.test.ts:32` · logic-error · low

- Evidence: `expect(buildMonsterFile(monsters[3], NOW)).toEqual(buildMonsterFile(monsters[3], NOW));` builds an object literal around the same monster reference twice, so toEqual is true by construction. fiveTools.test.ts:95 and foundry.test.ts:97 repeat the idea for other builders. The foundry one is meaningful (ids come from hashes), the 5etools one is nearly so, but the exportJson one proves nothing.
- Fix: Delete the exportJson test. Keep one determinism check per builder that has real hashing or ordering (Foundry), and drop the 5etools duplicate, which is already covered by the golden-file snapshot test.

**Damage-line conversion written three times with casts; convertAction repeats one pattern four times**  
`frontend/src/lib/fiveTools.ts:160` · redundancy · low

- Evidence: Lines 160-162 repeat `if (monster.X.length > 0 || text?.X) out.K = fiveToolsDamageEntries("K", monster.X, text?.X) as JsonValue[]` for vulnerable/resist/immune. The guard duplicates what the function already returns (empty types and no text give `[]`), and the `as JsonValue[]` casts exist only because damageLines.ts:28 returns `unknown[]`. convertAction (l.96-111) calls `segmentsToText(renderAction(action, monster.name))` in three branches and repeats the `recharge ? recharge(min) : ""` suffix …
- Fix: Type fiveToolsDamageEntries as returning `JsonValue[]`, then loop: `for (const [kind, field] of [["vulnerable","vulnerabilities"],["resist","resistances"],["immune","immunities"]] as const) { const e = fiveToolsDamageEntries(kind, monster[field], monster.damage_text?.[field]); if (e.length > 0) out[kind] = e; }`, which drops the three casts. Rewrite convertAction as: `const prose = segmentsToText(renderAction(action, monster.name)); const suffix = "recharge" in action && action.recharge ? recharge(action.recharge.min) : ""; return { name: `${action.name}${suffix}`, entries: [action.kind === "…

**Language-line splitting and the dash-means-none rule are written twice, once for 5etools and once for Foundry**  
`frontend/src/lib/fiveTools.ts:165` · redundancy · low

- Evidence: fiveTools.ts: `monster.languages.split(",").map((l) => l.trim()).filter((l) => l !== "" && !/^[-–—]$/.test(l))`. foundryMaps.ts parseLanguages: `if (trimmed === "" || /^[-–—]$/.test(trimmed)) return ...` then `trimmed.split(",").map((p) => p.trim()).filter(Boolean)`. If the rule for what counts as 'no languages' changes, one export will drift.
- Fix: Export a small `splitLanguages(text): string[]` (comma split, trim, drop empties and a lone dash) from exportCommon.ts or foundryMaps.ts and use it in both parseLanguages and convertMonster.

**An unparsable exportedAt silently becomes the 1970 epoch in the file's dateAdded**  
`frontend/src/lib/fiveTools.ts:233` · logic-error · low

- Evidence: `const parsed = Date.parse(exportedAt); const seconds = Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);` swallows a caller bug and writes dateAdded: 0 into the homebrew file, which importers may show or sort by. Callers always pass new Date().toISOString(), so the fallback only hides mistakes, and a test ("handles a bad time without throwing") enshrines it.
- Fix: Drop the NaN branch and the test, computing `Math.floor(Date.parse(exportedAt) / 1000)` directly, or throw on an invalid date so the mistake is visible instead of exporting a wrong timestamp.

**exportFoundryActor is one 185-line function that re-assigns values the template already holds**  
`frontend/src/lib/foundry.ts:65` · readability · low

- Evidence: Lines 65-249 do abilities, skills, hp/ac/movement/senses, details, spell slots, traits, resources, source, token and notes in one body. Many assignments only restate the template, which foundryTemplates.ts copies from a real SRD actor: `entry.max = null`, `bonuses.check = ""`, `bonuses.passive = ""`, `entry.ability = skill.ability` (all 18 match the template), `temp: null, tempmax: null`, `calc: "natural"`, `units: "ft"`, and the token's `actorLink = false`, `disposition = -1`, `displayName = 2…
- Fix: Split into functions named after the existing section comments: fillAbilities(system, monster, mods, pb), fillSkills(...), fillAttributes(...), fillDetails(...), buildToken(monster, legendaryActions). The main function becomes about 25 lines of calls. In the same pass delete the assignments that equal template values, since the template guarantees them and tests compare against the real fixtures. Change the template header to 'Copied from ...'.

**isStrictFormula guard in normalizeHpFormula can never reject anything, so the function and its test are dead weight**  
`frontend/src/lib/foundryMaps.ts:176` · bloat · low

- Evidence: normalizeHpFormula first calls parseDice(dice), whose regex /^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/ only accepts digits, then rebuilds `${count}d${sides} ${+/-} ${abs(bonus)}` from three numbers and finally does `return isStrictFormula(text) ? text : ""`. A string made only of those numbers always matches /^\d+(d\d+)?(\s*[+-]\s*\d+(d\d+)?)*$/, so the check is always true. The try/catch around parseDice already covers the unreadable case.
- Fix: Delete isStrictFormula, drop the `isStrictFormula(text) ?` ternary (return text) and delete the isStrictFormula it.each block in foundryMaps.test.ts. It is not used anywhere else.

### web-generator

**swapDamageType leaves damage_text (printed resistance/immunity wording) on the old type**  
`frontend/src/lib/demoGenerator.ts:16` · logic-error · low

- Evidence: The returned object swaps actions, resistances, immunities, vulnerabilities and damage_themes but spreads `...monster`, so `damage_text` (e.g. resistances: "bludgeoning, piercing, and slashing from nonmagical weapons") is carried over unchanged. The type lists say 'fire' while the stat block prose, which takes priority when present per the DamageText doc, still names the old type.
- Fix: Either also replace the whole word `from` with `to` in each damage_text string, or set damage_text to null when from appears in any of its lines so the stat block falls back to the swapped lists. Add a test using a monster with damage_text.

**typesNamedIn only sees the last type in lists like "cold or fire damage"**  
`frontend/src/lib/demoGenerator.ts:40` · logic-error · low

- Evidence: `/([a-z]+) damage/g` captures one word before 'damage'. In "bludgeoning, piercing, or slashing damage" or "cold or fire damage", only slashing and fire are found, so damageDealtBy under-reports and the reskin menu omits the earlier types.
- Fix: Scan for every DAMAGE_TYPES word inside each match of `/([a-z, ]+) damage/` (or simply look for each known type word followed within a short span by 'damage'), instead of a single capture word.

**Demo reskin calls the alphabetically first damage type the 'main damage', and its swap leaves action text untouched**  
`frontend/src/lib/demoGenerator.ts:107` · logic-error · low

- Evidence: `const main = damageDealtBy(base)[0];` and then `changes.push(`Main damage: ${main} → ${themeChosen}`)`. damageDealtBy returns `[...found].sort()`, so [0] is alphabetical, not the main damage. I ran the same logic over the 353 SRD and sample monsters: for 108 of them the first attack's damage type differs from the alphabetical first (a dragon that deals fire and bludgeoning gets 'Main damage: bludgeoning'). Also, damageDealtBy counts types named in prose (effects_text, multiattack and text acti…
- Fix: Choose the main type deliberately: the monster's `damage_themes[0]`, falling back to the first damage roll of its first attack or save action. Say 'Damage text is not rewritten in demo mode' in the demo note, or have swapDamageType also run a `replaceAll(`${from} damage`, `${to} damage`)` over the action, trait and legendary text. Tighten the test regex to the expected type.

**The page's one trust-boundary validator is hidden in the storage module, its helper is re-declared, and every monster is validated twice**  
`frontend/src/lib/generatedStore.ts:79` · structure · low

- Evidence: looksLikeMonster (about 100 lines) lives in generatedStore.ts, a file about remembering generated monsters. It is imported by liveGenerator.ts:2, sharedLibrary.ts:2, App.tsx:44 and two test files. liveGenerator.ts:55 re-declares the same helper under another name: `const isObject = (value: unknown): value is Record<string, unknown> => ...` is identical to generatedStore.ts:15 `isObj`. A live monster is checked in liveGenerator.toResult (line 64, 'The server sent back something that couldn't be …
- Fix: Create `lib/monsterShape.ts` holding isObj, isNum, isStr, isStrList, looksLikeMonster and the looksLike* helpers. generatedStore.ts keeps parseGenerated and the constants, and liveGenerator imports isObj. Pick one validation point: keep the check in liveGenerator.toResult, which is where untrusted data enters, and delete the second check and message from App.accept. That also removes the cyclic feel of sharedLibrary and liveGenerator importing the store.

**looksLikeMonster never checks `changes` or `attribution`, which the UI reads, so a malformed monster still crashes the stat block**  
`frontend/src/lib/generatedStore.ts:95` · logic-error · low

- Evidence: The header says a malformed monster 'would crash the stat block, so each is checked'. The string-list loop at line 95 lists subtypes, vulnerabilities, ..., features but not `changes`, and nothing checks `attribution`. StatBlockDialog.tsx:122-126 does `monster.changes && monster.changes.length > 0 && monster.changes.map(...)`. A stored or served monster with `changes: "abc"` passes looksLikeMonster, then `"abc".map` throws during render. `attribution: {}` (StatBlock.tsx:207 renders it as a React…
- Fix: Add two lines before `return true`: `if (value.changes !== undefined && !isStrList(value.changes)) return false;` and `if (value.attribution != null && !isStr(value.attribution)) return false;`. Add one rejection case to the 'rejects wrong types' test for each.

## Unverified low-severity notes

- `backend/src/cauldron/actions.py:116` (bloat) Dead fields: AttackAction.conditions is never used and is offered to the AI; Spellcasting.caster_level is only used by tests
- `backend/src/cauldron/actions.py:120` (redundancy) Signed-number formatting is re-implemented instead of using format_signed
- `backend/src/cauldron/actions.py:171` (redundancy) Recharge field and display_name are duplicated in SaveAction and TextAction
- `backend/tests/test_actions.py:53` (redundancy) Near-duplicate and brittle tests that check the language or a count rather than project behaviour
- `backend/tests/test_monster.py:14` (redundancy) The sample-monsters fixture is loaded and its lookup helper re-written in eight test modules
- `backend/src/cauldron/cr/calibrate.py:97` (complexity-space) leave_one_out copies the whole point list once per monster
- `backend/src/cauldron/cr/calibrate.py:121` (readability) run() is a 55-line function that imports, searches, builds per-band tolerances, formats and writes the file, and the band logic is untested
- `backend/src/cauldron/cr/calibrate.py:149` (readability) Magic fallback tolerance of 2 for an empty band
- `backend/src/cauldron/cr/calibrate.py:150` (redundancy) Accuracy figures are written to the table twice, and the constants are only read by a test
- `backend/src/cauldron/cr/estimator.py:87` (bloat) The committed calibration is rebuilt on every estimate and imported lazily for no reason
- `backend/src/cauldron/cr/measure.py:36` (bloat) _first_sentence_with_damage hand-rolls what re.split plus next() does
- `backend/src/cauldron/actions.py:88` (bloat) describe() takes monster_name in all four subclasses but only MultiattackAction uses it
- `backend/src/cauldron/actions.py:171` (redundancy) The recharge display_name property is copy-pasted into SaveAction and TextAction, and the base default is only an escape hatch
- `backend/src/cauldron/monster.py:374` (redundancy) The 'dice must parse' validator is written twice, and the short-string and name types are defined three times
- `backend/src/cauldron/templates.py:211` (bloat) LevelUpTemplate sets identity fields the only caller immediately overwrites, and the template registry has no production caller
- `backend/tests/test_actions.py:132` (redundancy) Recharge label and display_name checks are repeated across several tests
- `frontend/src/lib/renderAction.ts:126` (bloat) Dead branch in renderMultiattack
- `frontend/src/types/monster.ts:263` (structure) Ability, Source, attack mode and area shape are hand-written unions outside lib/options.ts, so the options contract is only half in one place
- `frontend/src/styles.css:100` (bloat) `.theme-toggle` selector matches no markup
- `frontend/src/styles.css:155` (redundancy) Seven near-identical button rule sets and the disabled state written three times
- `frontend/src/styles.css:341` (readability) `.topbar__scene` rules are inert for the painted witch; the comment claims she steps aside
- `frontend/src/styles.css:347` (readability) Overlapping breakpoints at exactly 1100px and an inconsistent 1000/1100/700 set
- `frontend/src/styles.css:507` (bloat) .brew-overlay sets size twice and uses 100vw
- `frontend/src/styles.css:753` (redundancy) `.pill.selected` is a JS-driven copy of the radio's checked state
- `frontend/src/styles.css:846` (readability) Right-aligned menus depend on a magic `nth-last-child(-n + 3)`
- `frontend/src/styles.css:979` (redundancy) Row rule is written for encounter and saved rows, then partly undone for saved rows
- `frontend/src/styles.css:1363` (redundancy) `.changes-note` and `.source-note` are the same rule written twice
- `frontend/src/styles.css:1540` (redundancy) `.app` and `.monster-list` are each declared in two separate places
- `backend/src/cauldron/remix/moves.py:36` (bloat) A handful of definitions are never read: Context.pb, Context.best, MIN_PARTY_SIZE, three imports, an identity table, a guard that cannot fail, and stale CSS selectors
- `backend/src/cauldron/service/generators.py:55` (structure) Test doubles and test-only API live in production modules
- `backend/src/cauldron/service/service.py:186` (bloat) Validation of a reskin request is repeated in four layers; two of the guards cannot fire
- `backend/src/cauldron/templates.py:251` (bloat) Several production members exist only for their own tests
- `backend/src/cauldron/validator.py:102` (redundancy) The ability-modifier-of-a-named-ability lookup is hand-written in five places
- `frontend/src/components/EncounterPanel.tsx:42` (bloat) formatMultiplier and a few locals add nothing, and one comment is wrong
- `frontend/src/components/EncounterPanel.tsx:87` (complexity-time) Export status cleared by an effect that sets state after render
- `frontend/src/components/EncounterPanel.tsx:261` (redundancy) Panel re-checks 'nothing counted' with redundant conditions
- `frontend/src/lib/encounter.test.ts:134` (redundancy) Duplicated and tautological assertions in encounter.test.ts
- `frontend/src/lib/encounter.test.ts:407` (redundancy) Inner-spacing name rule tested three times
- `frontend/src/lib/encounter.ts:79` (bloat) EncounterSummary.partySize duplicates party.levels.length
- `frontend/src/lib/encounter.ts:110` (redundancy) addMonster scans the list three times and re-implements the max-count rule
- `frontend/src/lib/encounter.ts:143` (redundancy) Monster totals computed in two places
- `frontend/src/lib/encounter.ts:148` (bloat) Unneeded exports and a thin wrapper
- `frontend/src/lib/encounter.ts:170` (complexity-space) summarizeEncounter builds a flat array with one XP per monster, up to 3,960 items, just to count and sum it
- `frontend/src/lib/storage.test.ts:73` (redundancy) Near-identical parser tests are written separately for favorites and entries
- `frontend/src/lib/storage.ts:144` (readability) Legacy id generation uses an empty-string sentinel and a loop
- `frontend/src/lib/foundry.test.ts:97` (redundancy) Determinism test and some shape tests duplicate what the snapshot and key-path tests already cover
- `frontend/src/lib/foundry.test.ts:152` (redundancy) it.each table has identical name pairs, and the lookups use unchecked `!`
- `frontend/src/lib/foundry.ts:37` (bloat) child() 'make it if missing' branch never runs and would hide a broken template
- `frontend/src/lib/foundry.ts:221` (redundancy) Token and ability fields re-assigned to the values the template already holds
- `frontend/src/lib/foundryItems.ts:25` (bloat) ACTIVATION map is an identity mapping and utilityActivity's cost default is always passed explicitly
- `frontend/src/lib/foundryItems.ts:351` (readability) Section and index are threaded through every builder only to build an id
- `backend/src/cauldron/remix/engine.py:39` (redundancy) The damage-theme value lookup is built separately in engine.py, theme.py and templates.py
- `backend/src/cauldron/remix/engine.py:74` (bloat) Dead 'no moves available' branch and a double model_copy in remix
- `backend/src/cauldron/remix/moves.py:22` (redundancy) Ability list and ability names are re-typed instead of using Ability and ABILITY_NAMES
- `backend/src/cauldron/remix/moves.py:69` (readability) make_context: the DC-cap comment sits above the wrong line, and 0.75 and the budget rule are unexplained
- `backend/src/cauldron/remix/moves.py:126` (complexity-time) available_moves rescans all actions once per move
- `backend/src/cauldron/remix/moves.py:152` (naming-intent) `damage` parameter of _save (and Move builders) is a budget fraction, not damage
- `backend/src/cauldron/remix/moves.py:232` (redundancy) Capitalised monster name hand-built twice; size tables and the damage floor repeated
- `frontend/src/components/PartyPanel.tsx:28` (naming-intent) SIZES means party sizes but clashes with options.SIZES (monster sizes)
- `frontend/src/components/PartyPanel.tsx:68` (readability) setSize has two branches where one expression is enough
- `frontend/src/components/ReskinPanel.tsx:42` (readability) Casts and two-branch request builder repeat the empty-string-to-null mapping
- `frontend/src/components/ReskinPanel.tsx:60` (structure) One 130-line component holds two forms with separate state
- `frontend/src/components/ReskinPanel.tsx:136` (redundancy) Selected move looked up twice in JSX
- `frontend/src/components/ReskinPanel.tsx:147` (readability) Four-level nested ternary builds the status text
- `frontend/src/lib/filters.test.ts:158` (naming-intent) Helper `has` returns the values that are missing, and the sort-by-type test skips the tie rule
- `frontend/src/lib/filters.ts:42` (redundancy) matchesOne is matchesAny with a one-element list
- `frontend/src/lib/filters.ts:56` (structure) XpRange lives in filters.ts but is a party/XP concept, creating a filters<->party import cycle
- `frontend/src/lib/filters.ts:67` (complexity-time) Search string trimmed and lowercased again for every monster
- `frontend/src/lib/filters.ts:89` (redundancy) 'Is this filter active' rules written twice (matchesFilters and countActiveFilters)
- `backend/src/cauldron/remix/engine.py:39` (redundancy) Three tables of 'the DamageTheme values', one with a different meaning under the same name
- `backend/src/cauldron/remix/engine.py:64` (complexity-time) current_theme(monster) is recomputed inside a comprehension, and other values are rescanned per item
- `backend/src/cauldron/remix/engine.py:74` (bloat) Unreachable fallbacks: an empty-moves branch and a dead max(2, ...) guard
- `backend/src/cauldron/remix/engine.py:104` (redundancy) The 'add an Addition to a monster' block is written twice, once in the engine and once in a test
- `backend/src/cauldron/remix/moves.py:62` (bloat) best_attack's multiattack filter is redundant, and tests/remix/test_moves.py has its own copy
- `backend/src/cauldron/remix/moves.py:187` (readability) Rider keeps its sentences in two forms (an if/elif chain plus the _RIDERS dict), and its cold wording duplicates SlowingTouch
- `backend/src/cauldron/remix/moves.py:232` (redundancy) Capitalising ctx.who is spelled out by hand twice
- `backend/src/cauldron/seed/importer.py:29` (redundancy) importer reaches into action_parser's private helpers to rebuild what parse_action's text fallback already builds; Abilities-from-raw is also written four times
- `backend/src/cauldron/seed/report.py:10` (readability) Counter keyed by class-name strings, then looked up by class-name strings
- `backend/src/cauldron/seed/spells.py:66` (bloat) _parse repeats an empty-input guard and has a double None path behind a catch-all wrapper
- `backend/src/cauldron/seed/tagger.py:11` (bloat) Small dead weight in the parsers and tagger: unused imports, exception types that duplicate each other, a pointless list copy, a repeated rule
- `backend/src/cauldron/seed/tagger.py:125` (readability) Melee attacks are found by 'not equal to any ranged attack' instead of by mode
- `backend/tests/seed/test_spells.py:81` (bloat) Pointless parametrize with an unused argument
- `backend/tests/seed/test_tagger.py:43` (redundancy) Environment-count and no-repeat tests repeat what the importer's all-monsters test already checks
- `backend/src/cauldron/service/__main__.py:12` (structure) Host and port bypass Settings, so a bad CAULDRON_PORT gives a raw traceback and the 'everything lives in settings' promise is false
- `backend/src/cauldron/service/prompts.py:18` (naming-intent) Two tool names live in different modules under confusingly similar names, and one is repeated as a bare string
- `backend/src/cauldron/service/service.py:43` (readability) Public ARROW constant built from a code point
- `backend/src/cauldron/service/service.py:101` (redundancy) create() computes effective_bounds, then build_brief computes it again and raises a ValueError that cannot happen
- `backend/src/cauldron/service/service.py:182` (redundancy) The 'find the base monster' lookup is written twice
- `backend/src/cauldron/service/smoke.py:56` (bloat) Settings are built with a database override that nothing reads
- `backend/tests/service/conftest.py:1` (redundancy) The 'shared request builders' the conftest promises do not exist; the same helpers are copied across test files
- `backend/tests/service/test_brief.py:97` (redundancy) Near-duplicate tests that add no coverage
- `backend/src/cauldron/service/store.py:55` (redundancy) The name-normalising rule is written twice, in the DB key and in the validator
- `backend/src/cauldron/service/store.py:109` (bloat) Unused store/limiter members that exist only for tests
- `backend/tests/service/test_api.py:127` (redundancy) CR-above-cap test duplicates the parametrized invalid-request test
- `backend/tests/service/test_limits.py:103` (redundancy) Daily-cap tests overlap and repeat the same assertions
- `backend/src/cauldron/templates.py:72` (readability) Theme swap round-trips enum to string to enum, with dict.fromkeys used as an ordered set
- `backend/src/cauldron/validator.py:92` (bloat) ValidationReport.retries has no production caller
- `backend/src/cauldron/validator.py:115` (bloat) Check._result wrapper adds nothing over CheckResult
- `backend/tests/test_validator.py:346` (redundancy) Duplicated, brittle and misplaced tests in test_validator.py
- `frontend/src/App.tsx:177` (redundancy) accept() re-checks looksLikeMonster on a result that is already validated, and its comment is stale
- `frontend/src/App.tsx:205` (readability) The Add-button note is a nested ternary in the component, untested, and it contradicts the project's own layout rule
- `frontend/src/components/EncounterPanel.tsx:43` (bloat) A one-line wrapper with a misleading comment, and a no-op alias in statusText
- `frontend/src/components/EncounterPanel.tsx:87` (readability) Export status is cleared with an effect that resets state after the render
- `frontend/src/components/EncounterPanel.tsx:101` (redundancy) The 'N monster(s)' plural is hand-written five times, and the two export handlers repeat each other
- `frontend/src/components/ExportButtons.tsx:44` (readability) The export menu uses an untyped tuple table with three casts that switch off type checking
- `frontend/src/components/ReskinPanel.tsx:136` (redundancy) The chosen move is looked up twice, and the request builder needs casts
- `frontend/src/components/StatBlockDialog.tsx:60` (redundancy) Every close path runs onClose twice
- `frontend/src/components/StatBlockDialog.tsx:117` (redundancy) sourceLabel(monster) is computed twice in one expression, here and per row in the results list
- `frontend/src/lib/bubbles.test.ts:9` (redundancy) The bubble tests re-state the formula as range checks and test determinism of a pure function
- `frontend/src/lib/encounter.ts:111` (readability) addMonster scans the rows three times and re-clamps a value that is already known to be in range
- `frontend/src/lib/encounter.ts:170` (complexity-space) summarizeEncounter expands one array entry per monster just to sum it, then computes the multiplier three times
- `frontend/src/lib/encounter.ts:202` (bloat) describeRating is a wrapper that only adds a null check around label
- `frontend/src/lib/favorites.ts:13` (redundancy) countAvailableFavorites is a second scan that onlyFavorites already provides
- `frontend/src/lib/filters.ts:66` (complexity-time) The search text is trimmed and lowercased once per monster instead of once per filter pass
- `frontend/src/lib/renderAction.test.ts:119` (redundancy) Sample-data checks are scattered across four test files, with one assertion duplicated and one test in the wrong file
- `frontend/src/lib/renderAction.ts:126` (redundancy) Three small helpers are re-implemented next to their existing versions
- `frontend/src/lib/storage.ts:143` (redundancy) The "is this a usable id" check is hand-written four times
- `frontend/src/lib/theme.ts:22` (structure) theme.ts re-implements the safe localStorage handling that storage.ts and usePersistentState already provide
- `frontend/src/lib/fiveTools.ts:32` (bloat) tagProse is re-exported from fiveTools only so one test file can import it from the old place
- `frontend/src/lib/foundry.test.ts:430` (readability) Two 'copes with' tests are titled for more than they check
- `frontend/src/lib/foundry.ts:34` (redundancy) The six-ability list is rewritten in five places
- `frontend/src/lib/foundry.ts:236` (bloat) ItemContext.slugs is a field the only caller always fills with a fresh empty Set
- `frontend/src/lib/foundryItems.ts:289` (redundancy) Recharge consumption and empty-template literals duplicated
- `frontend/src/lib/foundryMaps.test.ts:23` (redundancy) foundryMaps.test.ts holds tests for other modules and tautological assertions
- `frontend/src/lib/demoGenerator.ts:18` (readability) swapList needs a double cast `to as unknown as T` that hides a real type mismatch
- `frontend/src/lib/demoGenerator.ts:72` (readability) One counter is both the unique-id suffix and the choice of which monster and prefix to copy
- `frontend/src/lib/generatorApi.ts:4` (readability) Header comments in this unit describe a project that no longer exists
- `frontend/src/lib/generatorApi.ts:29` (redundancy) The "surprise" literal is typed in the API file while a SURPRISE constant exists in remixMoves
- `frontend/src/lib/liveGenerator.ts:20` (redundancy) Value lists and messages are written twice and kept in sync by hand: failure reasons, the rate-limit text, abilities and sources
- `frontend/src/lib/liveGenerator.ts:112` (bloat) reskin rebuilds the damageSwap object field by field for no change
- `frontend/src/lib/liveGenerator.ts:118` (redundancy) The "default timeout unless the caller gave one" override is repeated at each call site, with a magic number
- `frontend/src/lib/remixMoves.test.ts:11` (redundancy) Tests in this unit are brittle or duplicated: a hard-coded move count, a copy of an existing case, a conditional assertion, repeated fetch stubs and a weak cap check
- `frontend/src/lib/remixMoves.ts:25` (readability) Every move row spells out both flags, though only 6 rows differ from the defaults

# Remix: how the deeper reskin works

This is the reference for the Remix feature, written so that someone who did not build it can maintain it. It also feeds the
final technical document.

## What it is, in one paragraph

A visitor opens a monster, chooses **Remix**, and picks a new damage **theme**, a **signature move**, a **level up**, or any mix
(or "Surprise me" for the theme and/or the move). The server changes the monster's numbers with plain code, asks Claude Haiku
only for words (a new name, a new description, and a name for the new move), checks the result with the same validator as every
other reskin, stores it, and returns it with a list of **what changed**. The old **Quick reskin** (a damage-type swap) is gone: its job is the `damageOnly` tick under a theme, and **Reflavor** (below) is the no-choice reskin.

## The rules that never bend

1. **Code does every number.** The AI never sees or changes a hit point, damage die, DC or bonus. It writes a name, a
   description and a move name, nothing else (`draft.py`: `NameDraft`, `RemixNameDraft`).
2. **Challenge-rating neutral.** A signature move is an alternative to one of the monster's attacks, never extra output on top.
   No move deals more than 75% of the monster's best single attack (`Context.budget` in `moves.py`), and a move's save DC is
   capped at what the monster's own attacks and saves already reach (`make_context`). Only **Level up** raises the rating, by
   about one step, and the player asks for it.
3. **The original is never changed.** Every function returns a new `Monster`.
4. **The same explicit choices give the same monster.** They are cached (free); a "Surprise me" is settled by the server first
   and then behaves like any explicit choice.

## Files

| File | Job |
|---|---|
| `backend/src/cauldron/remix/theme.py` | `apply_theme`: the main damage type, the old theme's immunity or resistance traded for the new one's, a resistance added if there was none, a vulnerability from a fixed table. Returns the monster and plain-words `changes`. |
| `backend/src/cauldron/remix/moves.py` | The 18 signature moves. Abstract `Move` with `applies_to` and `build`; `Context` holds the numbers (DC, attack bonus, damage budget); `Addition` is what a move adds. `MOVES` is the menu in order. |
| `backend/src/cauldron/remix/engine.py` | `remix()` puts theme, move and level up together and recomputes the feature tags; `resolve()` turns "surprise" into a definite theme and move using a random generator that is passed in. |
| `backend/src/cauldron/templates.py` | `swap_damage_type` (with `defences=False` for remix), `LevelUpTemplate`, `retarget_name`. |
| `backend/src/cauldron/service/models.py` | `ReskinRequest`: `base_id`, `damage_swap` or (`theme`, `move`), `level_up`. Its `cache_key` and `has_surprise`. |
| `backend/src/cauldron/service/service.py` | `settle` (decide surprises), `create_reskin`, `_shape` (the numbers by code), `_accept_reskin` (validate and store). |
| `backend/src/cauldron/service/prompts.py`, `draft.py`, `haiku.py` | The naming prompt, the tool schema (with a `move_name` only when a move was chosen) and the Haiku call. |
| `frontend/src/lib/remixMoves.ts` | The move menu shown on the page: a copy of the server's list. |
| `frontend/src/components/ReskinPanel.tsx` | The panel: Reflavor, then Remix. |
| `frontend/src/components/StatBlockDialog.tsx` | The "What changed" list, shown from `monster.changes`. |

## Themes

The ten damage themes: acid, cold, fire, force, lightning, necrotic, poison, psychic, radiant, thunder.

Applying a theme (`apply_theme`):

1. **Main damage.** The monster's main damage type (an elemental type is preferred over physical, so a red dragon's fire is
   replaced, not its bite) becomes the theme's type. Only damage the monster *deals* is changed (`damage_dealt_by`), never its
   defences, so an ogre's bludgeoning resistance is left alone.
2. **Trade.** If the old theme appears as an immunity (else a resistance), it becomes the new theme.
3. **Add.** If the monster has neither a resistance nor an immunity to the new theme, it gains a resistance.
4. **Vulnerability.** Fixed table; a vulnerability is not added if the monster is already protected against that type:

| Theme | Gains vulnerability to |
|---|---|
| fire | cold |
| cold | fire |
| necrotic | radiant |
| radiant | necrotic |
| acid | cold |
| poison | radiant |
| lightning, thunder, force, psychic | none (no good opposite) |

## The 18 signature moves

| Group | Moves |
|---|---|
| Offence | on-hit rider, opening strike, drain, lob, sunder |
| Control | grasping strike, slowing touch, pull, dazzle, dread presence, leap |
| Area | burst, spray, aura, death burst |
| Defence and mobility | backlash, blink step, ward flicker |

Numbers every move uses (`make_context`): proficiency bonus from the challenge rating; save DC = 8 + proficiency + the best
ability modifier, capped at the monster's own highest to-hit or DC (minus 8 for DCs); attack bonus = proficiency + the better of
Strength and Dexterity; damage budget = 75% of the best single attack, at least 2. A move needs the monster to deal damage
unless it is dazzle, dread presence, blink step or ward flicker; pull and leap need a monster that is not Tiny.

The page's menu is a copy of this list. `backend/tests/remix/test_menu_matches_frontend.py` fails if the two differ.

### Adding a move

1. Add a subclass of `Move` in `moves.py` and append it to the `MOVES` list (keys must be unique; order is menu order).
2. Add its row to `frontend/src/lib/remixMoves.ts` (same key, label, group, blurb, flags).
3. Run the backend tests. The sweep test (below) tries the new move on every monster and will name any that breaks.

## The engine in order (`engine.remix`)

1. Theme (if chosen): `apply_theme`.
2. Move (if chosen): `Move.build` with the new theme (or the monster's own theme if none was chosen), appended to its actions,
   bonus actions, reactions or traits.
3. Feature tags are recomputed (`derive_features`), because a breath-like move changes them and the validator checks them.
4. Level up (if chosen): `LevelUpTemplate`, then the identity (id, name, source, parent) is put back; the service renames it.
5. The result carries `changes`, in the order theme, move, level up. These are the notes and the stored "What changed" list.

## The service flow (`create_reskin`)

1. `settle`: "surprise" becomes a real theme and/or move (a surprise theme is never the theme the monster already has; a
   surprise move is always one that fits).
2. Look the answer up by `cache_key` (the route in `app.py` does this *after* settling, so a repeat of the same outcome is free).
3. Refuse a move that does not fit, without an AI call.
4. Build a preview with a stand-in move name to get the new CR and the change list for the prompt.
5. Ask the AI: name, description and (for a move) `move_name`. A reply without a `move_name` is sent back with feedback.
6. Rebuild with the real move name, retarget name mentions, validate, store, remember under the cache key.
7. Retries use the same retry loop and daily cap as everything else; only the words can change between attempts.

## Wire format (`POST /api/v1/reskin`)

```json
{ "baseId": "srd-ogre", "theme": "cold", "damageOnly": false, "move": "lob", "levelUp": false }
```

`theme` is a theme name or `"surprise"`; `move` is a move key or `"surprise"`. `damageOnly: true` (needs a theme) changes the main damage and the theme tag but leaves resistances, immunities and vulnerabilities as they were; a damage-only theme the monster already had changes nothing and is refused. `damageSwap` no longer exists. At least one of theme, move, levelUp or reflavor must be given. The old `template` field is gone.

## Reflavor (`"reflavor": true`)

A one-click reskin with no choices: a new name, a new description, and new names for the monster's own attacks and traits. No
number changes, so it skips the engine and the validator's CR checks have nothing to correct. It stands alone: the request
validator rejects it combined with a swap, theme, move or level up.

- `remix/reflavor.py` decides which AI-proposed renames are used. A rename applies only to an ability the monster really has
  (never Multiattack, Spellcasting, Legendary Resistance or the Legendary Actions header), within 40 characters, not blocklisted,
  and not colliding with another ability. Usage notes such as "(3/Day)" are kept, and a Multiattack's sequence and sentence follow
  the new names. A blocklisted name is sent back to the AI as feedback; other unusable proposals are simply skipped.
- A monster keeps at most 3 reflavors (`MAX_REFLAVORS`, stored under `reflavor:<base id>:<n>` in the `reskins` table). The first
  three presses each make a new one, told the names of the earlier ones so it differs; after that a press returns one of the three
  at random, free of charge.

## Tests that guard it

- `tests/remix/test_theme.py`, `test_moves.py`: each rule and each move.
- `tests/remix/test_engine.py`: composition, surprise, and the **sweep**: every move on all 353 monsters (the 333 SRD ones and
  the 20 samples), 6,038 remixes, each of which must be a valid monster, add no new validator complaint, and keep the CR
  estimate within one step. If you change a move or the estimator, this is the test that shows what broke.
- `tests/service/*`: the request model, cache key, prompts, the Haiku tool schema and the service flow with the scripted generator.
- `frontend/src/lib/remixMoves.test.ts`, `liveGenerator.test.ts`, `generatorApi.test.ts`: the menu and the request body.

## Decisions and gotchas worth knowing

- **Why save DCs are capped.** The Deva attacks at +8 but its Wisdom would give a DC of 17; any new save then raised the CR
  estimate two steps, because the estimator reads the highest bonus. Capping the DC at the monster's own highest bonus keeps a
  move CR neutral.
- **Why feature tags are recomputed.** A spray on a Wyvern is a breath weapon; the validator expects the `breath-weapon` tag.
- **Why "Surprise me" is not cached.** Caching it would hand every visitor the same surprise. The server decides first, then the
  normal cache applies to the decided outcome.
- **Level up is the only thing that changes CR** (about +1 step; hit points about 1.5x, AC +1, +1 to hit, DC and damage).
- **Reskins are remembered by their choices.** A flawed older reskin persists until `backend/data/cauldron.sqlite3` is deleted
  (stop the server first).
- **Demo mode** (`?generator=demo`) applies only the theme's damage swap (keeping the defences when damage only) and says signature moves are not added.
- **Not built:** swapping resistances or immunities as a separate option; deleting generated monsters from the page.

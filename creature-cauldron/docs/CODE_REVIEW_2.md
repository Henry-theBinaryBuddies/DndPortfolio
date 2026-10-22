# Second code review (before launch)

Four reviewers worked in parallel on everything built since the first review (commit `bfeb02e`): Reflavor, Polymorph and legendary actions, the A5E import,
the Source filter and licences, and the deployment tooling. Each looked only for problems it could demonstrate by running code or tracing exact lines,
with a security focus. Every finding below was checked again before it was fixed. No reviewer found a way for the API key to leak.

## Fixed

| Area | Finding | Fix |
|---|---|---|
| Server | One polymorph could be repeated with repeated ticks, each a new cache key and a new AI call | The `borrow` list is de-duplicated; the cache key ignores repeats and order |
| Server | `/library` read every stored monster with no limit | It goes through the same per-address limit as the other free answers |
| Server | An IPv6 visitor owns a whole /64 and could start every request from a new address, evading every limit | The limit counts an IPv6 visitor by their /64 prefix (an IPv4-mapped address by its IPv4 address) |
| Deployment | The log file never rotated while the server ran and the active file was never pruned | One file per day, capped at 50 MB, two weeks kept |
| Deployment | A quoted key in the secrets file was sent with its quotes (every call would fail 401 and use the day's allowance) | Matching quotes and a byte-order mark are stripped, and a key that does not start with `sk-ant-` gets a warning (never printing it) |
| Deployment | The backup ignored `CAULDRON_DATABASE`, and its task did not run when logged out | It finds the database the server uses; the docs register it like the server task |
| Deployment | `.gitignore` missed `.env.local`, `.env.*.local` and the chronomancer `.env.production` | Added |
| Front end | "Make polymorph" could be enabled for a donor with nothing to lend; ticks survived a change of donor | It needs something to borrow, and a new donor resets the ticks |
| Front end | Two creatures with one name made the second unselectable | One donor per name |
| Front end | 134 A5E monsters showed raw `**` and line breaks (spell lists) and exported them | Lists become one sentence; markup is removed |
| Front end | The 5etools export carried no credit | Each monster's credit travels with it as fluff |
| Front end | The server's option list was trusted: repeats, any length, more than ten ticks sent | De-duplicated, capped at 100, at most ten ticks sent; a saved A5E monster is accepted |
| Logic (high) | **Every reskin, theme, reflavor or polymorph of an A5E monster was rejected**: the A5E credit mentions the "System Reference Document" and the SRD-misquote check refused it | A derived monster may carry either credit or both (`combined_credit`); a polymorph of an SRD monster with an A5E donor carries both |
| Logic | 66 of 68 A5E legendary monsters had the intro paragraph as a bogus first option, always 3 a round, and lost "(1/Day)" limits | The intro gives the count (1, 2 or 3); per-day and recharge limits stay on the option |
| Logic | About 18 of 70 A5E Multiattacks were wrong (lost attacks, "replace one attack" options added as extra attacks) | Typed only for plain sentences ("attacks once with its bite and twice with its claws"); a sentence offering a choice stays prose |
| Logic | Borrowed text kept damage that was untyped or bare dice ("an extra 13 (4d6) damage") | Every amount of damage in borrowed text is capped; a base with the smallest budget gets one roll |
| Logic | Borrowed legendary options pointed at swimming, burrowing or traits the hybrid lacked; a 3/Day power became an at-will legendary action | Checked for movement and trait names; limited powers are not offered |
| Logic | Borrowed text still named the donor ("The vampire regains..." for "Vampire Mage"), turned "mummy rot" into "wolf rot", and wrote "+-3 to hit" | Text is re-addressed by any word of the donor's name after "the"; a word alone is left; the sign is written once |
| Logic | A reflavor could move a number (a renamed attack left its plural Multiattack entry unpriced), left prose Multiattacks and legendary options naming the old attack, chained renames, and allowed a clash with a legendary option | Names match the way the CR measure matches them, prose and legendary options are rewritten in one pass |
| Data | A5E hit dice invented (33 wrong), resistances widened to all three physical types, debris "names", a trait with its text glued on, commas lost as double spaces | The record's own hit dice, only the types named, debris dropped, names unglued, commas restored |
| Data | The ability score cap was raised to 40 with nothing stopping a made monster from using it | A made monster's scores above 30 are corrected to 30; published monsters keep theirs |

## Known and accepted

- A "let the forge choose" polymorph, and a reflavor of a monster with fewer than three, are never reused, so each press is a fresh AI call. The per-visitor limits, the daily cap and the Console spend limit are the ceiling (documented in `DEPLOYMENT.md`).
- Several visitors pressing Reflavor at the same instant can leave a monster with a fourth variant (harmless).
- 101 of the A5E Multiattacks stay prose, so the CR measure prices only the creature's best single action for them.
- Open5e's A5E text has lost most apostrophes ("the aboleths allies"); only the stock "spellcasting ability" phrase is restored. The "psychic (with mind blank)" immunity on the A5E Archmage is dropped.
- A donor made by the forge but missing from the server's database (for example after the database is deleted) is offered, and the server then says it does not know it.

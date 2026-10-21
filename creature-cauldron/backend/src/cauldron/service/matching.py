"""Does a monster fit a request? The same rules as the web page's filters (frontend/src/lib/filters.ts):
type, size and role are "one of"; environments and damage themes need any one of the picks; features need all of them."""

from cauldron.monster import Monster
from cauldron.service.models import GenerateRequest


def mismatches(monster: Monster, request: GenerateRequest) -> list[str]:
    """Why a monster does not fit a request, in plain sentences for the AI to act on. Empty when it fits."""
    problems: list[str] = []
    cr = monster.challenge.cr_value
    if (request.cr_min is not None and cr < request.cr_min) or (request.cr_max is not None and cr > request.cr_max):
        low = "any" if request.cr_min is None else f"{request.cr_min:g}"
        high = "any" if request.cr_max is None else f"{request.cr_max:g}"
        problems.append(f"The challenge rating must be between {low} and {high}, but it is {monster.challenge.cr}.")
    if request.types and monster.type not in request.types:
        problems.append(f"The creature type must be one of {', '.join(t.value for t in request.types)}, but it is {monster.type.value}.")
    if request.sizes and monster.size not in request.sizes:
        problems.append(f"The size must be one of {', '.join(s.value for s in request.sizes)}, but it is {monster.size.value}.")
    if request.roles and monster.role not in request.roles:
        problems.append(f"The role must be one of {', '.join(r.value for r in request.roles)}, but it is {monster.role.value}.")
    if request.environments and not any(e in monster.environments for e in request.environments):
        problems.append(f"It must live in at least one of: {', '.join(e.value for e in request.environments)}.")
    if request.damage_themes and not any(t in monster.damage_themes for t in request.damage_themes):
        problems.append(f"Its damage theme must include one of: {', '.join(t.value for t in request.damage_themes)}.")
    missing = [f.value for f in request.features if f not in monster.features]
    if missing:
        problems.append(f"It must have these features: {', '.join(missing)}.")
    return problems


def matches(monster: Monster, request: GenerateRequest) -> bool:
    return not mismatches(monster, request)

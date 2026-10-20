"""Does a monster fit a request? The same rules as the web page's filters (frontend/src/lib/filters.ts):
type, size and role are "one of"; environments and damage themes need any one of the picks; features need all of them."""

from cauldron.monster import Monster
from cauldron.service.models import GenerateRequest


def matches(monster: Monster, request: GenerateRequest) -> bool:
    cr = monster.challenge.cr_value
    if request.cr_min is not None and cr < request.cr_min:
        return False
    if request.cr_max is not None and cr > request.cr_max:
        return False
    if request.types and monster.type not in request.types:
        return False
    if request.sizes and monster.size not in request.sizes:
        return False
    if request.roles and monster.role not in request.roles:
        return False
    if request.environments and not any(e in monster.environments for e in request.environments):
        return False
    if request.damage_themes and not any(t in monster.damage_themes for t in request.damage_themes):
        return False
    return all(f in monster.features for f in request.features)

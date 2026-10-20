"""Discovery tags that code derives from the stat block. The AI's own claims about these are never trusted."""

from cauldron.actions import Action, MultiattackAction, SaveAction
from cauldron.monster import Monster
from cauldron.options import AreaShape, CreatureType, Feature


def _is_breath_weapon(monster: Monster, action: Action) -> bool:
    """Any action with "breath" in its name, or a dragon's recharging cone or line."""
    if "breath" in action.name.lower():
        return True
    if not isinstance(action, SaveAction):
        return False
    shaped = action.area is not None and action.area.shape in (AreaShape.CONE, AreaShape.LINE)
    return monster.type is CreatureType.DRAGON and shaped and action.recharge is not None


def derive_features(monster: Monster) -> list[Feature]:
    """The features this stat block really has, in the order of the Feature enum."""
    found: set[Feature] = set()
    if monster.speeds.fly:
        found.add(Feature.FLYING)
    if monster.speeds.swim:
        found.add(Feature.SWIMMING)
    if any(isinstance(action, MultiattackAction) for action in monster.actions):
        found.add(Feature.MULTIATTACK)
    if any(_is_breath_weapon(monster, action) for action in monster.actions):
        found.add(Feature.BREATH_WEAPON)
    if monster.legendary_actions is not None:
        found.add(Feature.LEGENDARY)
    if monster.spellcasting is not None:
        found.add(Feature.SPELLCASTING)
    if any(trait.name.lower().startswith("regeneration") for trait in monster.traits):
        found.add(Feature.REGENERATION)
    return [feature for feature in Feature if feature in found]

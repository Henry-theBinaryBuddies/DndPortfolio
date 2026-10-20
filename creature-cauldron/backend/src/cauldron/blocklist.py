"""Names we will not use, because they are protected by Wizards of the Coast or belong to other people.

This is deliberately cautious: the rule is "when it might be a legal gray area, leave it out". The SRD 5.1 does
not include these creatures and characters, so none of them can be generated, imported or reskinned. Add to the
list freely; removing a name needs a good reason.
"""

import re

# Monsters Wizards keeps as product identity, and iconic named characters, deities and settings.
PRODUCT_IDENTITY_TERMS: frozenset[str] = frozenset(
    {
        # monsters
        "beholder",
        "death tyrant",
        "spectator",
        "gauth",
        "mind flayer",
        "illithid",
        "displacer beast",
        "githyanki",
        "githzerai",
        "gith",
        "kuo-toa",
        "slaad",
        "yuan-ti",
        "umber hulk",
        "carrion crawler",
        # named characters, deities and demon lords
        "tiamat",
        "bahamut",
        "orcus",
        "demogorgon",
        "asmodeus",
        "baphomet",
        "yeenoghu",
        "juiblex",
        "zuggtmoy",
        "graz'zt",
        "lolth",
        "strahd",
        "drizzt",
        "elminster",
        "vecna",
        "acererak",
        "mordenkainen",
        "bigby",
        "tasha",
        # settings and brands
        "forgotten realms",
        "faerun",
        "greyhawk",
        "ravenloft",
        "dragonlance",
        "eberron",
        "waterdeep",
        "dungeons & dragons",
        "dungeons and dragons",
        "d&d",
    }
)


def _words(text: str) -> str:
    """Lowercase, with every run of punctuation or spaces turned into one space: "Mind-Flayer's" -> " mind flayer s "."""
    return f" {re.sub(r'[^a-z0-9&]+', ' ', text.lower()).strip()} "


def blocked_term(name: str) -> str | None:
    """The blocked term this name contains as whole words, or None. Matching ignores case and punctuation."""
    haystack = _words(name)
    for term in sorted(PRODUCT_IDENTITY_TERMS):
        if _words(term) in haystack:
            return term
    return None

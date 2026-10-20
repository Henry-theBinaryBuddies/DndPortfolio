"""The one base class every model in this package builds on."""

from pydantic import BaseModel, ConfigDict


class CauldronModel(BaseModel):
    """A Pydantic model that refuses fields it does not know about.

    Pydantic models are classes whose attributes are checked when an object is made: give a wrong type or an
    out-of-range number and it raises ValidationError instead of silently accepting it. Forbidding extra fields
    matters here because the AI generator may invent fields, and we want to hear about that, not store it.
    """

    model_config = ConfigDict(extra="forbid")

"""Embeds and persistent buttons. Button custom_ids carry the poll/candidate ids, so the
buttons keep working across restarts (DynamicItem re-creates them from the custom_id)."""
import discord
from discord.ui import Button, DynamicItem, View

from . import wording
from datetime import datetime

from .snapshots import PollSnapshot

VOTE_TEMPLATE = r"cm:vote:(?P<poll>\d+):(?P<cand>\d+)"
CONFIRM_TEMPLATE = r"cm:confirm:(?P<poll>\d+)"

COLOURS = {"dnd": 0xE0A63A, "plain": 0x2F5FD0}


def _esc(text: str) -> str:
    """Organizer-controlled text must not be able to inject markdown (e.g. masked links)."""
    return discord.utils.escape_markdown(discord.utils.escape_mentions(text))


def _colour(theme: str) -> discord.Colour:
    return discord.Colour(COLOURS.get(theme, COLOURS["dnd"]))


def vote_embed(s: PollSnapshot) -> discord.Embed:
    w = wording.words(s.theme)
    t = lambda key, **kw: wording.t(s.theme, key, **kw)  # noqa: E731
    embed = discord.Embed(
        title=t("botVoteTitle", title=_esc(s.display_title))[:256],
        description=t("botVoteBody") if s.status == "voting" else t("botVoteClosed"),
        colour=_colour(s.theme),
    )
    lines = []
    for i, c in enumerate(s.candidates, start=1):
        lines.append(
            f"**{i}.** {discord.utils.format_dt(c.start, 'F')} ({discord.utils.format_dt(c.start, 'R')})\n"
            f" {c.free} {t('botFreeWord')} · {c.maybe} {t('botMaybeWord')} · "
            f"**{c.votes}** {t('botVotesWord')}"
        )
    embed.add_field(name=w["candidates"], value="\n".join(lines) or "-", inline=False)
    if s.vote_deadline and s.status == "voting":
        embed.add_field(name=t("botVoteDeadline"), value=discord.utils.format_dt(s.vote_deadline, "F"))
    embed.set_footer(text=f"{s.duration_min} min")
    return embed


def confirmed_embed(s: PollSnapshot) -> discord.Embed:
    when = (f"{discord.utils.format_dt(s.confirmed_start, 'F')} "
            f"({discord.utils.format_dt(s.confirmed_start, 'R')})") if s.confirmed_start else "?"
    text = wording.t(s.theme, "botConfirmedBody", title=_esc(s.display_title), when=when)
    text += _reminder_line(s)
    if s.next_week:  # the campaign meets regularly: say where the next poll should start
        text += "\n\n" + wording.t(s.theme, "botNextWeek", date=s.next_week.strftime("%A %B %d, %Y"))
    return discord.Embed(
        title=wording.t(s.theme, "botConfirmedTitle"),
        description=text,
        colour=_colour(s.theme),
    )


def _when(dt: datetime) -> str:
    return f"{discord.utils.format_dt(dt, 'F')} ({discord.utils.format_dt(dt, 'R')})"


def reminder_embed(s: PollSnapshot) -> discord.Embed:
    embed = discord.Embed(
        title=wording.t(s.theme, "botReminderTitle"),
        description=wording.t(s.theme, "botReminderBody", title=_esc(s.display_title),
                              when=_when(s.confirmed_start)),
        colour=_colour(s.theme),
    )
    embed.set_footer(text=s.campaign_name[:100])
    return embed


def session_cancelled_embed(s: PollSnapshot) -> discord.Embed:
    return discord.Embed(
        title=wording.t(s.theme, "botSessionCancelledTitle"),
        description=wording.t(s.theme, "botSessionCancelled",
                              when=discord.utils.format_dt(s.confirmed_start, "F")),
        colour=_colour(s.theme),
    )


def _reminder_line(s: PollSnapshot) -> str:
    """Say what will (or will not) happen, so a missing reminder is never a silent surprise."""
    if s.reminder_times:
        when = ", ".join(discord.utils.format_dt(t, "f") for t in s.reminder_times)
        return "\n\n" + wording.t(s.theme, "botRemindersAt", times=when)
    if s.reminder_offsets:  # reminders are on, but none still fit before the session
        return "\n\n" + wording.t(s.theme, "botRemindersNoFit")
    return ""


def cancelled_embed(s: PollSnapshot) -> discord.Embed:
    w = wording.words(s.theme)
    return discord.Embed(
        title=wording.t(s.theme, "botVoteTitle", title=_esc(s.display_title))[:256],
        description=wording.t(s.theme, "botPollCancelled", organizer=w["organizer"]),
        colour=_colour(s.theme),
    )


class VoteButton(DynamicItem[Button], template=VOTE_TEMPLATE):
    def __init__(self, poll_id: int, candidate_id: int, label: str = "Vote"):
        super().__init__(Button(style=discord.ButtonStyle.primary, label=label,
                                custom_id=f"cm:vote:{poll_id}:{candidate_id}"))
        self.poll_id = poll_id
        self.candidate_id = candidate_id

    @classmethod
    async def from_custom_id(cls, interaction, item, match, /):
        return cls(int(match["poll"]), int(match["cand"]), label=item.label or "Vote")

    async def callback(self, interaction: discord.Interaction):
        await interaction.client.handle_vote(interaction, self.poll_id, self.candidate_id)


class ConfirmButton(DynamicItem[Button], template=CONFIRM_TEMPLATE):
    def __init__(self, poll_id: int, label: str = "Confirm"):
        super().__init__(Button(style=discord.ButtonStyle.success, label=label,
                                custom_id=f"cm:confirm:{poll_id}", row=1))
        self.poll_id = poll_id

    @classmethod
    async def from_custom_id(cls, interaction, item, match, /):
        return cls(int(match["poll"]), label=item.label or "Confirm")

    async def callback(self, interaction: discord.Interaction):
        await interaction.client.handle_confirm(interaction, self.poll_id)


def build_vote_view(s: PollSnapshot) -> View:
    view = View(timeout=None)
    for i, c in enumerate(s.candidates, start=1):
        view.add_item(VoteButton(s.poll_id, c.id, label=f"Vote {i}"))
    view.add_item(ConfirmButton(s.poll_id, label=wording.t(s.theme, "botConfirmButton")[:80]))
    return view

"""Roles are worded by theme: the D&D theme says Dungeon Master and Player, the plain theme says
Group manager and Member, everywhere a person can read them."""
import json
import re
from pathlib import Path

import pytest

from app import services
from app.bot import actions, wording
from app.bot.actions import DUser
from app.services import ServiceError

from conftest import login, make_client
from helpers import CHANNEL, GUILD, make_campaign, make_player

WEB = Path(__file__).resolve().parent.parent / "web"
THEMES = {n: json.loads((WEB / "themes" / f"{n}.json").read_text(encoding="utf-8")) for n in ("dnd", "plain")}
PAGES = {n: (WEB / n).read_text(encoding="utf-8") for n in ("index.html", "campaign.html", "poll.html")}
DM = DUser("1", "Dungeon Master", can_manage=True)
ARIA = DUser("2", "Aria")


def test_each_theme_names_both_roles_in_its_own_words():
    assert (THEMES["dnd"]["organizer"], THEMES["dnd"]["member"]) == ("Dungeon Master", "Player")
    assert (THEMES["plain"]["organizer"], THEMES["plain"]["member"]) == ("Group manager", "Member")
    assert THEMES["dnd"]["organizerInline"] == "Dungeon Master"
    assert THEMES["plain"]["organizerInline"] == "group manager"  # mid-sentence: never 'the Group manager'


def test_the_plain_theme_never_uses_dungeons_and_dragons_role_words():
    for key, text in THEMES["plain"].items():
        words = re.sub(r"\{\w+\}", "", text)  # a {placeholder} is filled in with the theme's own word
        assert not re.search(r"dungeon master|\bplayers?\b|\borganizer\b", words, re.IGNORECASE), (key, text)


def test_both_themes_define_the_same_words():
    assert set(THEMES["dnd"]) == set(THEMES["plain"])


@pytest.mark.parametrize("name,page", PAGES.items())
def test_every_theme_key_a_page_uses_exists_in_both_themes(name, page):
    keys = set(re.findall(r'data-t="(\w+)"', page))
    for call in re.findall(r"Theme\.t\(([^)]*)\)", page):  # also keys chosen with a ternary
        keys |= set(re.findall(r'"(\w+)"', call))
    assert keys
    for theme, words in THEMES.items():
        missing = {k for k in keys if k not in words}
        assert not missing, f"{name}: {theme} lacks {missing}"


def test_the_home_page_themes_the_member_badge_and_follows_theme_switches():
    page = PAGES["index.html"]
    assert 'Theme.t("member")' in page and ": c.my_role" not in page  # never the raw API word 'player'
    assert 'addEventListener("themechange"' in page and "renderCampaigns()" in page


def test_the_pages_no_longer_hard_code_players():
    assert 'data-t="minFreeLabel"' in PAGES["campaign.html"] and 'data-t="membersCap"' in PAGES["campaign.html"]
    assert not re.search(r"free player", PAGES["poll.html"])
    assert "Players will no longer" not in PAGES["poll.html"] and 'Theme.t("cancelPollConfirm")' in PAGES["poll.html"]
    assert 'Theme.t("hoursChosenBy")' in PAGES["poll.html"] and "poll.timezone === here" in PAGES["poll.html"]


def test_the_party_list_shows_a_badge_for_every_member():
    assert 'Theme.t("member")' in PAGES["campaign.html"]


# ------------------------------------------------ the bot


def test_a_plain_group_is_told_who_to_ask_in_plain_words(db):
    make_campaign(db, theme="plain")
    services.upsert_user(db, "2", "Aria")
    reply = actions.cmd_schedule(db, ARIA, GUILD, CHANNEL)
    assert "group manager" in reply.text and "Organizer" not in reply.text and "Dungeon Master" not in reply.text


def test_a_dnd_group_still_talks_about_its_dungeon_master(db):
    make_campaign(db, theme="dnd")
    reply = actions.cmd_schedule(db, ARIA, GUILD, CHANNEL)
    assert "Dungeon Master" in reply.text and "group manager" not in reply.text


@pytest.mark.parametrize("theme,expected", [("plain", "Only the group manager can do that."),
                                            ("dnd", "Only the Dungeon Master may do that.")])
def test_refusing_a_member_uses_the_groups_theme(db, theme, expected):
    campaign, owner = make_campaign(db, theme=theme)
    make_player(db, campaign, "2", "Aria")
    with pytest.raises(ServiceError) as err:
        actions.cmd_poll(db, ARIA, GUILD, CHANNEL, None, "00:00", "24:00", "")
    assert expected in str(err.value.detail)


def test_the_bot_says_group_manager_inside_a_cancelled_poll_notice(db):
    """Through the real embed, not a copy of its wording."""
    from app.bot.snapshots import load_poll_snapshot
    from app.bot.views import cancelled_embed
    from helpers import voting_poll
    for theme, expected in (("plain", "The group manager may start a new one."), ("dnd", "The Dungeon Master may unfurl")):
        _, poll, _ = voting_poll(db, guild=f"g-{theme}", channel=f"c-{theme}", theme=theme)
        services.cancel_poll(db, poll)
        assert expected in cancelled_embed(load_poll_snapshot(db, poll.id)).description


def test_no_sentence_on_the_pages_still_says_players_outside_a_theme_key():
    page = PAGES["campaign.html"]
    assert "minimum players" not in page and 'data-t="membersLower"' in page


def test_the_server_refuses_non_managers_in_neutral_words(client):
    login(client, "1", "DM")
    camp = client.post("/api/campaigns", json={"name": "x"}).json()
    member = make_client()
    login(member, "2", "Aria")
    member.post("/api/join", json={"invite_code": camp["invite_code"]})
    refused = member.delete(f"/api/campaigns/{camp['id']}")
    assert refused.status_code == 403
    assert refused.json()["detail"] == "only the group manager can do that"
    assert "organizer" not in refused.json()["detail"].lower()


def test_slash_command_text_uses_neutral_wording():
    source = (WEB.parent / "app" / "bot" / "commands.py").read_text(encoding="utf-8")
    assert "Minimum people who must be free" in source and "the group's manager" in source
    assert "Dungeon Master" not in source

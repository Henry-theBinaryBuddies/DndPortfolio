"""The six commands (/schedule, setup, poll, advance, cancel, unlink) and the two buttons."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app import services
from app.bot import actions, wording
from app.bot.actions import DUser
from app.models import Campaign, Notification, Poll, Vote
from app.services import ServiceError

from helpers import (
    CHANNEL, GUILD, fresh, make_campaign, make_player, mark_all_free, open_poll, voting_poll,
)

DM = DUser("1", "Dungeon Master", can_manage=True)
ARIA = DUser("2", "Aria")
ADMIN = DUser("50", "Server Admin", can_manage=True)
STRANGER = DUser("99", "Stranger")


def setup(db, du=DM, **kw):
    return actions.cmd_setup(db, du, GUILD, CHANNEL, **kw)


def poll_cmd(db, du=DM, week="2026-12-01", start="18:00", end="23:00", title="Session 5"):
    return actions.cmd_poll(db, du, GUILD, CHANNEL, week, start, end, title)


# ---------------------------------------------------------------- setup: create


def test_setup_creates_the_campaign_bound_to_this_channel(db):
    reply = setup(db, name="Curse of Strahd")
    assert "Curse of Strahd" in reply.text and "created" in reply.text and not reply.ephemeral
    campaign = services.campaign_for_channel(db, GUILD, CHANNEL)
    organizer = services.get_member(db, campaign.id, services.upsert_user(db, "1", "x").id)
    assert organizer.role == "organizer" and organizer.required
    assert "/schedule" in reply.text and "/chronomancer poll" in reply.text  # tells the group what to do next


def test_setup_applies_every_option_in_one_command(db):
    setup(db, name="Strahd", frequency="biweekly", quorum=1, length=120, reminders="2d, 30m", theme="plain")
    c = services.campaign_for_channel(db, GUILD, CHANNEL)
    assert (c.cadence, c.min_quorum, c.default_duration_min, c.theme) == ("biweekly", 1, 120, "plain")
    assert c.reminder_offsets_min == [2880, 30]


def test_setup_summary_shows_the_settings(db):
    reply = setup(db, name="Strahd", frequency="weekly", quorum=1, length=90, reminders="1h")
    for needle in ("Every week", "1 hour 30 minutes", "at least 1 free", "1 hour before"):
        assert needle in reply.text, needle
    assert "UTC" not in reply.text and "imezone" not in reply.text  # there is no timezone setting
    assert "reminders: off" in setup(db, reminders="off").text


def test_only_someone_who_manages_the_channel_may_create(db):
    with pytest.raises(ServiceError) as exc:
        setup(db, ARIA, name="Squat")
    assert exc.value.status == 403 and "Manage" in exc.value.detail
    assert db.scalars(select(Campaign)).first() is None


def test_creating_needs_a_name(db):
    with pytest.raises(ServiceError) as exc:
        setup(db)
    assert exc.value.status == 422 and "name" in exc.value.detail


def test_setup_outside_a_server_channel_is_refused(db):
    with pytest.raises(ServiceError):
        actions.cmd_setup(db, DM, None, None, name="x")


@pytest.mark.parametrize("kwargs", [
    dict(name="   "), dict(name="x" * 121), dict(name="ok", theme="nope"),
    dict(name="ok", frequency="hourly"), dict(name="ok", reminders="soon"),
    dict(name="ok", reminders="1d, 1h, 30m, 15m, 5m, 1m"), dict(name="ok", quorum=0),
    dict(name="ok", length=5),
])
def test_setup_rejects_bad_input_and_changes_nothing(db, kwargs):
    with pytest.raises(ServiceError) as exc:
        setup(db, **kwargs)
    assert exc.value.status in (422, 403)
    assert db.scalars(select(Campaign)).first() is None or kwargs.get("name") == "ok"
    campaign = services.campaign_for_channel(db, GUILD, CHANNEL)
    if campaign is not None:  # a half-applied create must not leave odd settings behind
        assert campaign.cadence == "none" and campaign.min_quorum == 2


def test_two_campaigns_cannot_share_a_channel_but_setup_updates_the_existing_one(db):
    setup(db, name="One")
    reply = setup(db, name="Renamed", quorum=3)
    assert "updated" in reply.text and db.scalars(select(Campaign)).all()[0].name == "Renamed"
    assert len(db.scalars(select(Campaign)).all()) == 1


def test_plain_theme_uses_plain_words(db):
    reply = setup(db, name="Book Club", theme="plain")
    assert "Organizer" in reply.text and "Dungeon Master" not in reply.text


# ---------------------------------------------------------------- setup: update permissions


def test_an_ordinary_member_cannot_change_settings(db):
    campaign, _ = make_campaign(db)
    make_player(db, campaign, "2", "Aria")
    with pytest.raises(ServiceError) as exc:
        setup(db, ARIA, quorum=1)
    assert exc.value.status == 403 and campaign.min_quorum == 2


def test_the_organizer_can_change_settings_even_without_manage_rights(db):
    campaign, _ = make_campaign(db)
    setup(db, DUser("1", "Dungeon Master", can_manage=False), quorum=1)
    assert campaign.min_quorum == 1


def test_a_server_admin_can_reconfigure_any_campaign_in_the_server(db):
    campaign, _ = make_campaign(db)
    setup(db, ADMIN, frequency="monthly")
    assert campaign.cadence == "monthly"


def test_changing_reminders_reschedules_a_decided_session(db):
    campaign, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    reply = setup(db, reminders="3h, 10m")
    with fresh() as other:
        offsets = sorted(r.offset_min for r in other.scalars(select(__import__("app.models", fromlist=["Reminder"]).Reminder)))
    assert offsets == [10, 180]
    assert "updated" in reply.text


# ---------------------------------------------------------------- setup: adopting a web campaign


def test_setup_with_a_code_adopts_a_campaign_made_on_the_web(db):
    owner = services.upsert_user(db, "1", "Dungeon Master")
    web, _ = services.create_campaign(db, owner, name="Made on web")
    reply = setup(db, code=f"  {web.invite_code}  ", quorum=1)
    assert "linked" in reply.text and "Made on web" in reply.text
    assert services.campaign_for_channel(db, GUILD, CHANNEL).id == web.id and web.min_quorum == 1


def test_only_the_organizer_can_adopt_a_web_campaign(db):
    owner = services.upsert_user(db, "7", "Someone Else")
    web, _ = services.create_campaign(db, owner, name="Theirs")
    with pytest.raises(ServiceError) as exc:
        setup(db, DM, code=web.invite_code)
    assert exc.value.status == 404 and web.channel_id is None
    with pytest.raises(ServiceError):
        setup(db, ARIA, code=web.invite_code)  # and a non-manager may not claim channels at all


# ---------------------------------------------------------------- /schedule


def test_schedule_with_nothing_going_on_says_how_to_start(db):
    campaign, _ = make_campaign(db)
    reply = actions.cmd_schedule(db, ARIA, GUILD, CHANNEL)
    assert reply.ephemeral and "Nothing is scheduled" in reply.text and "/chronomancer poll" in reply.text
    assert f"/campaign.html?id={campaign.id}" in reply.text  # no poll: the group page


def test_schedule_always_joins_the_caller(db):
    campaign, _ = make_campaign(db)
    actions.cmd_schedule(db, ARIA, GUILD, CHANNEL)
    aria = services.upsert_user(db, "2", "Aria")
    assert services.get_member(db, campaign.id, aria.id).role == "player"


def test_schedule_while_collecting_shows_progress_and_the_poll_link(db):
    campaign, owner = make_campaign(db)
    make_player(db, campaign, "2", "Aria")
    make_player(db, campaign, "3", "Borin")
    poll = open_poll(db, campaign)
    mark_all_free(db, poll, owner)
    text = actions.cmd_schedule(db, ARIA, GUILD, CHANNEL).text
    assert "Availability is open" in text and "1/3" in text
    assert "Aria" in text and "Borin" in text and "Your turn" in text
    assert f"/poll.html?id={poll.id}" in text


def test_schedule_while_voting_points_at_the_vote(db):
    _, poll, _ = voting_poll(db, vote_hours=24)
    text = actions.cmd_schedule(db, ARIA, GUILD, CHANNEL).text
    assert "vote is open" in text and "Voting ends" in text and "Your turn" in text
    assert f"/poll.html?id={poll.id}" in text and "Availability is open" not in text


def test_schedule_for_a_decided_session_shows_it_and_its_reminders(db):
    campaign, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    text = actions.cmd_schedule(db, ARIA, GUILD, CHANNEL).text
    assert "confirmed" in text and text.count("<t:") >= 4  # session twice (full+relative) + reminders
    assert "Reminders:" in text and "Nothing is scheduled" not in text


def test_schedule_says_when_no_reminder_fits(db):
    campaign, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    with fresh() as other:
        other.get(Poll, poll.id).confirmed_start_utc = datetime.now(timezone.utc) + timedelta(minutes=20)
        other.execute(__import__("sqlalchemy").delete(__import__("app.models", fromlist=["Reminder"]).Reminder))
        other.commit()
    assert "No reminder fits" in actions.cmd_schedule(db, ARIA, GUILD, CHANNEL).text


def test_schedule_has_the_same_shape_in_every_state(db):
    """The complaint: it used to answer four different ways. Now: a header, then the state,
    then one link, every time."""
    campaign, owner = make_campaign(db)
    states = []
    states.append(actions.cmd_schedule(db, ARIA, GUILD, CHANNEL).text)           # nothing
    poll = open_poll(db, campaign)
    mark_all_free(db, poll, owner)
    mark_all_free(db, poll, make_player(db, campaign, "2", "Aria"))
    states.append(actions.cmd_schedule(db, ARIA, GUILD, CHANNEL).text)           # collecting
    services.close_poll(db, poll)
    states.append(actions.cmd_schedule(db, ARIA, GUILD, CHANNEL).text)           # voting
    services.confirm_poll(db, poll)
    states.append(actions.cmd_schedule(db, ARIA, GUILD, CHANNEL).text)           # decided
    for text in states:
        lines = text.splitlines()
        assert lines[0].startswith("**Curse of Strahd**")            # always a header
        assert lines[-1].startswith("http")                            # always ends with one link
        assert len(text) <= 1900
    assert len({t.splitlines()[0] for t in states}) == 1


def test_schedule_outside_a_campaign_channel_explains_what_to_do(db):
    with pytest.raises(ServiceError) as exc:
        actions.cmd_schedule(db, DM, GUILD, CHANNEL)
    assert exc.value.status == 404 and "/chronomancer setup" in exc.value.detail


def test_schedule_stays_inside_discords_message_limit_for_big_groups(db):
    campaign, _ = make_campaign(db)
    for i in range(80):
        make_player(db, campaign, f"u{i}", f"Adventurer with a long display name number {i}")
    open_poll(db, campaign)
    text = actions.cmd_schedule(db, DM, GUILD, CHANNEL).text
    assert len(text) <= 1900 and "and 66 more" in text


def test_schedule_escapes_organizer_controlled_text(db):
    campaign, _ = make_campaign(db)
    setup(db, name="[click](https://evil.example) @everyone")
    text = actions.cmd_schedule(db, ARIA, GUILD, CHANNEL).text
    assert r"\[click]" in text and "@everyone" not in text


# ---------------------------------------------------------------- poll


def test_poll_uses_the_campaigns_settings_and_the_organizers_timezone(db):
    campaign, _ = make_campaign(db)
    services.update_campaign(db, campaign, min_quorum=1, default_duration_min=90)
    services.upsert_user(db, "1", "Dungeon Master", tz="America/Los_Angeles")  # learned from their browser
    reply = poll_cmd(db)
    poll = services.open_poll(db, campaign.id)
    assert f"/poll.html?id={poll.id}" in reply.text and "Session 5" in reply.text
    assert (poll.min_quorum, poll.duration_min, poll.timezone) == (1, 90, "America/Los_Angeles")
    assert "18:00 to 23:00 America/Los_Angeles" in reply.text and "own timezone" in reply.text
    assert "Open the website" not in reply.text  # the zone is known, no nagging
    assert (poll.date_start.isoformat(), poll.date_end.isoformat()) == ("2026-12-01", "2026-12-07")


def test_poll_defaults_to_a_week_starting_today_in_the_organizers_timezone(db):
    campaign, _ = make_campaign(db)
    services.upsert_user(db, "1", "Dungeon Master", tz="Pacific/Auckland")
    actions.cmd_poll(db, DM, GUILD, CHANNEL, None, "18:00", "23:00", "")
    assert services.open_poll(db, campaign.id).date_start == datetime.now(ZoneInfo("Pacific/Auckland")).date()


def test_an_organizer_whose_timezone_is_unknown_gets_utc_and_a_hint(db):
    campaign, _ = make_campaign(db)
    reply = poll_cmd(db)
    assert services.open_poll(db, campaign.id).timezone == "UTC"
    assert "18:00 to 23:00 UTC" in reply.text and "Open the website once" in reply.text


def test_a_players_timezone_never_changes_how_the_organizers_hours_are_read(db):
    campaign, _ = make_campaign(db)
    services.upsert_user(db, "1", "Dungeon Master", tz="Asia/Tokyo")
    make_player(db, campaign, "2", "Aria")
    services.upsert_user(db, "2", "Aria", tz="America/New_York")
    poll_cmd(db)
    assert services.open_poll(db, campaign.id).timezone == "Asia/Tokyo"


def test_poll_is_organizer_only_with_themed_message(db):
    campaign, _ = make_campaign(db)
    make_player(db, campaign, "2", "Aria")
    with pytest.raises(ServiceError) as exc:
        poll_cmd(db, ARIA)
    assert exc.value.status == 403 and "Dungeon Master" in exc.value.detail
    with pytest.raises(ServiceError):
        poll_cmd(db, STRANGER)


@pytest.mark.parametrize("override,needle", [
    (dict(week="12/01/2026"), "Week start"), (dict(week="soon"), "Week start"),
    (dict(start="6pm"), "Start"), (dict(end="25:00"), "End"),
])
def test_poll_input_errors_are_specific(db, override, needle):
    make_campaign(db)
    with pytest.raises(ServiceError) as exc:
        poll_cmd(db, **override)
    assert exc.value.status == 422 and needle in exc.value.detail
    assert db.scalars(select(Poll)).first() is None


def test_a_second_open_poll_is_refused(db):
    make_campaign(db)
    poll_cmd(db)
    with pytest.raises(ServiceError) as exc:
        poll_cmd(db)
    assert exc.value.status == 409


def test_poll_title_is_escaped_in_the_reply(db):
    make_campaign(db)
    reply = poll_cmd(db, title="**loud** @everyone")
    assert "@everyone" not in reply.text and r"\*\*loud\*\*" in reply.text


# ---------------------------------------------------------------- advance


def test_advance_closes_a_collecting_poll_into_a_vote(db):
    campaign, owner = make_campaign(db)
    aria = make_player(db, campaign, "2", "Aria")
    poll = open_poll(db, campaign)
    for u in (owner, aria):
        mark_all_free(db, poll, u)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_advance(db, ARIA, GUILD, CHANNEL, None)
    assert exc.value.status == 403 and poll.status == "collecting"
    reply = actions.cmd_advance(db, DM, GUILD, CHANNEL, 24)
    assert not reply.ephemeral and poll.status == "voting" and poll.vote_deadline
    assert [n.kind for n in db.scalars(select(Notification))] == ["vote_open"]


def test_advance_decrees_the_winner_of_a_vote(db):
    _, poll, _ = voting_poll(db)
    reply = actions.cmd_advance(db, DM, GUILD, CHANNEL, None)
    assert poll.status == "confirmed" and poll.confirmed_start_utc is not None
    assert "decreed" in reply.text.lower()
    with pytest.raises(ServiceError) as exc:
        actions.cmd_advance(db, DM, GUILD, CHANNEL, None)  # nothing left to advance
    assert exc.value.status == 409 and "/chronomancer poll" in exc.value.detail


def test_advance_with_no_poll_says_so(db):
    make_campaign(db)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_advance(db, DM, GUILD, CHANNEL, None)
    assert exc.value.status == 409


def test_a_failed_advance_explains_why_and_changes_nothing(db):
    campaign, _ = make_campaign(db)
    poll = open_poll(db, campaign)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_advance(db, DM, GUILD, CHANNEL, None)
    text = actions.error_text(exc.value)
    assert "start times considered" in text and "too few free players" in text
    assert poll.status == "collecting"


# ---------------------------------------------------------------- cancel / unlink


def test_cancel_prefers_the_open_poll_then_the_next_session(db):
    campaign, poll, _ = voting_poll(db)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_cancel(db, ARIA, GUILD, CHANNEL)
    assert exc.value.status == 403
    actions.cmd_cancel(db, DM, GUILD, CHANNEL)
    assert poll.status == "cancelled"
    with pytest.raises(ServiceError) as exc:
        actions.cmd_cancel(db, DM, GUILD, CHANNEL)  # nothing left
    assert exc.value.status == 409


def test_cancel_reaches_a_decided_session_when_no_poll_is_open(db):
    campaign, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    actions.cmd_cancel(db, DM, GUILD, CHANNEL)
    assert poll.status == "cancelled"


def test_unlink_is_for_the_organizer_or_an_admin(db):
    campaign, _ = make_campaign(db)
    make_player(db, campaign, "2", "Aria")
    with pytest.raises(ServiceError) as exc:
        actions.cmd_unlink(db, ARIA, GUILD, CHANNEL)
    assert exc.value.status == 403 and campaign.channel_id == CHANNEL
    actions.cmd_unlink(db, ADMIN, GUILD, CHANNEL)
    assert campaign.channel_id is None and campaign.name == "Curse of Strahd"  # kept
    setup(db, name="New one")  # the channel is free to claim again
    assert services.campaign_for_channel(db, GUILD, CHANNEL).name == "New one"


# ---------------------------------------------------------------- button clicks


def test_vote_click_records_vote_and_returns_fresh_tallies(db):
    _, poll, _ = voting_poll(db)
    cand = poll.candidates[0]
    out = actions.vote_click(db, ARIA, poll.id, cand.id, GUILD, CHANNEL)
    assert out.ok and out.snapshot.total_votes == 1
    assert next(c for c in out.snapshot.candidates if c.id == cand.id).votes == 1
    other = poll.candidates[-1]
    out = actions.vote_click(db, ARIA, poll.id, other.id, GUILD, CHANNEL)
    assert out.snapshot.total_votes == 1  # changing a vote moves it


def test_vote_click_from_a_new_user_joins_them(db):
    campaign, poll, _ = voting_poll(db)
    assert actions.vote_click(db, STRANGER, poll.id, poll.candidates[0].id, GUILD, CHANNEL).ok
    user = services.upsert_user(db, "99", "Stranger")
    assert services.get_member(db, campaign.id, user.id).role == "player"


def test_vote_click_in_the_wrong_channel_is_refused(db):
    _, poll, _ = voting_poll(db)
    for guild, channel in ((GUILD, "other-channel"), ("other-guild", CHANNEL), (None, None)):
        out = actions.vote_click(db, ARIA, poll.id, poll.candidates[0].id, guild, channel)
        assert not out.ok and "different channel" in out.text
    assert db.scalars(select(Vote)).first() is None


def test_vote_click_after_confirm_says_voting_ended(db):
    _, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    out = actions.vote_click(db, ARIA, poll.id, poll.candidates[0].id, GUILD, CHANNEL)
    assert not out.ok and "ended" in out.text


def test_vote_click_for_missing_poll(db):
    make_campaign(db)
    out = actions.vote_click(db, ARIA, 424242, 1, GUILD, CHANNEL)
    assert not out.ok and "no longer exists" in out.text


def test_confirm_click_requires_the_organizer(db):
    _, poll, _ = voting_poll(db)
    out = actions.confirm_click(db, ARIA, poll.id, GUILD, CHANNEL)
    assert not out.ok and "Dungeon Master" in out.text and poll.status == "voting"
    assert not actions.confirm_click(db, STRANGER, poll.id, GUILD, CHANNEL).ok
    assert actions.confirm_click(db, DM, poll.id, GUILD, CHANNEL).ok and poll.status == "confirmed"
    assert "ended" in actions.confirm_click(db, DM, poll.id, GUILD, CHANNEL).text


def test_confirm_click_in_wrong_channel_is_refused(db):
    _, poll, _ = voting_poll(db)
    assert not actions.confirm_click(db, DM, poll.id, GUILD, "elsewhere").ok and poll.status == "voting"


# ---------------------------------------------------------------- helpers and wording


@pytest.mark.parametrize("text,expected", [
    ("1d", [1440]), ("1d, 1h", [1440, 60]), ("2h 15m", [120, 15]), ("90m;1D", [90, 1440]),
    ("off", []), ("none", []), ("", []), (" 30M ", [30]),
])
def test_parse_offsets(text, expected):
    assert actions.parse_offsets(text) == expected


@pytest.mark.parametrize("junk", ["soon", "1 day", "h", "-5m", "1w", "1.5h", "1d,,x"])
def test_parse_offsets_rejects_junk_with_a_helpful_message(junk):
    with pytest.raises(ServiceError) as exc:
        actions.parse_offsets(junk)
    assert exc.value.status == 422 and "1d" in exc.value.detail


@pytest.mark.parametrize("minutes,text", [
    (1440, "1 day"), (60, "1 hour"), (45, "45 minutes"), (90, "1 hour 30 minutes"),
    (2880, "2 days"), (1500, "1 day 1 hour"),
])
def test_describe_minutes(minutes, text):
    assert actions.describe_minutes(minutes) == text


def test_web_api_ignores_guild_and_channel_fields(client):
    from conftest import login
    login(client, "1", "DM")
    r = client.post("/api/campaigns", json={"name": "Sneaky", "guild_id": "123", "channel_id": "456"})
    assert r.status_code == 201
    with fresh() as db:
        assert services.campaign_for_channel(db, "123", "456") is None
        assert db.scalars(select(Campaign)).one().channel_id is None


def test_wording_falls_back_safely():
    assert wording.t("no-such-theme", "botVoteRecorded") == wording.t("dnd", "botVoteRecorded")
    assert wording.t("dnd", "no-such-key") == "no-such-key"
    assert wording.words("../../etc/passwd") == wording.words("dnd")


def test_every_theme_defines_every_key():
    keys = set(wording.words("dnd"))
    for theme in wording.available_themes():
        assert keys == set(wording.words(theme)), theme

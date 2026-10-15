import pytest
from sqlalchemy import select

from app import services
from app.bot import actions, wording
from app.bot.actions import DUser
from app.models import Campaign, Member, Notification, Poll, Vote
from app.services import ServiceError

from helpers import CHANNEL, GUILD, fresh, make_campaign, make_player, open_poll, voting_poll

DM = DUser("1", "Dungeon Master", can_manage=True)  # Discord says: may manage this channel
ARIA = DUser("2", "Aria")
STRANGER = DUser("99", "Stranger")


def poll_args(**kw):
    base = dict(week_start="2026-12-01", start="18:00", end="23:00", length=120, tz="UTC",
                title="Session 5")
    base.update(kw)
    return (base["week_start"], base["start"], base["end"], base["length"], base["tz"], base["title"])


# ---------------------------------------------------------------- create / link


def test_create_binds_campaign_to_channel_and_makes_caller_organizer(db):
    reply = actions.cmd_create(db, DM, GUILD, CHANNEL, "Curse of Strahd", 180, 2, "dnd")
    assert "Curse of Strahd" in reply.text and not reply.ephemeral
    campaign = services.campaign_for_channel(db, GUILD, CHANNEL)
    member = services.get_member(db, campaign.id, services.upsert_user(db, "1", "x").id)
    assert member.role == "organizer" and member.required


def test_create_twice_in_one_channel_is_refused(db):
    actions.cmd_create(db, DM, GUILD, CHANNEL, "One", 180, 2, "dnd")
    with pytest.raises(ServiceError) as exc:
        actions.cmd_create(db, DUser("2", "Aria", can_manage=True), GUILD, CHANNEL, "Two", 180, 2, "dnd")
    assert exc.value.status == 409


@pytest.mark.parametrize("kwargs", [dict(name="   "), dict(name="x" * 121), dict(theme="nope")])
def test_create_rejects_bad_input(db, kwargs):
    args = dict(name="Ok", theme="dnd")
    args.update(kwargs)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_create(db, DM, GUILD, CHANNEL, args["name"], 180, 2, args["theme"])
    assert exc.value.status == 422


def test_create_refuses_dm_context(db):
    with pytest.raises(ServiceError):
        actions.cmd_create(db, DM, None, None, "X", 180, 2, "dnd")


def test_plain_theme_uses_plain_wording(db):
    reply = actions.cmd_create(db, DM, GUILD, CHANNEL, "Book Club", 60, 2, "plain")
    assert "forged" not in reply.text and "ready" in reply.text


def test_link_binds_web_campaign_for_its_organizer_only(db):
    owner = services.upsert_user(db, "1", "Dungeon Master")
    web, _ = services.create_campaign(db, owner, name="Made on web")
    with pytest.raises(ServiceError):
        actions.cmd_link(db, STRANGER, GUILD, CHANNEL, web.invite_code)
    reply = actions.cmd_link(db, DM, GUILD, CHANNEL, f"  {web.invite_code}  ")
    assert "Made on web" in reply.text
    assert services.campaign_for_channel(db, GUILD, CHANNEL).id == web.id


# ---------------------------------------------------------------- poll / availability / status


def test_commands_outside_a_campaign_channel_explain_what_to_do(db):
    for fn, args in ((actions.cmd_availability, ()), (actions.cmd_status, ()),
                     (actions.cmd_close, (None,)), (actions.cmd_confirm, ())):
        with pytest.raises(ServiceError) as exc:
            fn(db, DM, GUILD, CHANNEL, *args)
        assert exc.value.status == 404 and "/chronomancer create" in exc.value.detail


def test_poll_is_organizer_only_with_themed_message(db):
    campaign, _ = make_campaign(db)
    make_player(db, campaign, "2", "Aria")
    with pytest.raises(ServiceError) as exc:
        actions.cmd_poll(db, ARIA, GUILD, CHANNEL, *poll_args())
    assert exc.value.status == 403 and "Dungeon Master" in exc.value.detail


def test_stranger_who_never_joined_cannot_create_polls(db):
    make_campaign(db)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_poll(db, STRANGER, GUILD, CHANNEL, *poll_args())
    assert exc.value.status == 403


def test_poll_created_and_link_points_at_it(db):
    make_campaign(db)
    reply = actions.cmd_poll(db, DM, GUILD, CHANNEL, *poll_args())
    poll = db.scalars(select(Poll)).one()
    assert f"/poll.html?id={poll.id}" in reply.text and "Session 5" in reply.text
    assert poll.duration_min == 120 and poll.timezone == "UTC"


@pytest.mark.parametrize("override,needle", [
    (dict(week_start="12/01/2026"), "Week start"),
    (dict(start="6pm"), "Start"),
    (dict(end="25:00"), "End"),
    (dict(tz="Mars/Base"), "timezone"),
])
def test_poll_input_errors_are_specific(db, override, needle):
    make_campaign(db)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_poll(db, DM, GUILD, CHANNEL, *poll_args(**override))
    assert exc.value.status == 422 and needle in exc.value.detail
    assert db.scalars(select(Poll)).first() is None


def test_second_open_poll_is_refused(db):
    make_campaign(db)
    actions.cmd_poll(db, DM, GUILD, CHANNEL, *poll_args())
    with pytest.raises(ServiceError) as exc:
        actions.cmd_poll(db, DM, GUILD, CHANNEL, *poll_args())
    assert exc.value.status == 409


def test_availability_joins_the_caller_and_replies_privately(db):
    campaign, _ = make_campaign(db)
    poll = open_poll(db, campaign)
    reply = actions.cmd_availability(db, ARIA, GUILD, CHANNEL)
    assert reply.ephemeral and f"/poll.html?id={poll.id}" in reply.text
    aria = services.upsert_user(db, "2", "Aria")
    assert services.get_member(db, campaign.id, aria.id).role == "player"


def test_availability_with_no_open_poll_says_so(db):
    make_campaign(db)
    reply = actions.cmd_availability(db, ARIA, GUILD, CHANNEL)
    assert reply.ephemeral and "Dungeon Master" in reply.text


def test_status_lists_who_is_missing(db):
    from helpers import mark_all_free
    campaign, owner = make_campaign(db)
    aria = make_player(db, campaign, "2", "Aria")
    make_player(db, campaign, "3", "Borin")
    poll = open_poll(db, campaign)
    mark_all_free(db, poll, owner)
    text = actions.cmd_status(db, DM, GUILD, CHANNEL).text
    assert "1/3" in text and "Aria" in text and "Borin" in text and "Dungeon Master" not in text.split("waiting on")[-1]


# ---------------------------------------------------------------- close / confirm commands


def test_close_command_is_organizer_only_and_queues_the_vote(db):
    from helpers import mark_all_free
    campaign, owner = make_campaign(db)
    aria = make_player(db, campaign, "2", "Aria")
    poll = open_poll(db, campaign)
    for u in (owner, aria):
        mark_all_free(db, poll, u)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_close(db, ARIA, GUILD, CHANNEL, None)
    assert exc.value.status == 403 and poll.status == "collecting"
    reply = actions.cmd_close(db, DM, GUILD, CHANNEL, 24)
    assert not reply.ephemeral and poll.status == "voting" and poll.vote_deadline
    assert db.scalars(select(Notification)).one().kind == "vote_open"


def test_close_with_nothing_to_close(db):
    make_campaign(db)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_close(db, DM, GUILD, CHANNEL, None)
    assert exc.value.status == 409


def test_failed_close_message_explains_why(db):
    campaign, _ = make_campaign(db)
    open_poll(db, campaign)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_close(db, DM, GUILD, CHANNEL, None)
    text = actions.error_text(exc.value)
    assert "start times considered" in text and "too few free players" in text


def test_confirm_command(db):
    campaign, poll, _ = voting_poll(db)
    with pytest.raises(ServiceError):
        actions.cmd_confirm(db, ARIA, GUILD, CHANNEL)
    actions.cmd_confirm(db, DM, GUILD, CHANNEL)
    assert poll.status == "confirmed"
    with pytest.raises(ServiceError) as exc:
        actions.cmd_confirm(db, DM, GUILD, CHANNEL)
    assert exc.value.status == 409


# ---------------------------------------------------------------- button clicks


def test_vote_click_records_vote_and_returns_fresh_tallies(db):
    _, poll, _ = voting_poll(db)
    cand = poll.candidates[0]
    out = actions.vote_click(db, ARIA, poll.id, cand.id, GUILD, CHANNEL)
    assert out.ok and out.snapshot.total_votes == 1
    assert next(c for c in out.snapshot.candidates if c.id == cand.id).votes == 1
    # changing the vote moves it rather than adding one
    other = poll.candidates[-1]
    out = actions.vote_click(db, ARIA, poll.id, other.id, GUILD, CHANNEL)
    assert out.snapshot.total_votes == 1


def test_vote_click_from_a_new_user_joins_them(db):
    campaign, poll, _ = voting_poll(db)
    out = actions.vote_click(db, STRANGER, poll.id, poll.candidates[0].id, GUILD, CHANNEL)
    assert out.ok
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


def test_confirm_click_requires_organizer(db):
    _, poll, _ = voting_poll(db)
    out = actions.confirm_click(db, ARIA, poll.id, GUILD, CHANNEL)
    assert not out.ok and "Dungeon Master" in out.text and poll.status == "voting"
    out = actions.confirm_click(db, STRANGER, poll.id, GUILD, CHANNEL)
    assert not out.ok and poll.status == "voting"
    out = actions.confirm_click(db, DM, poll.id, GUILD, CHANNEL)
    assert out.ok and poll.status == "confirmed"
    out = actions.confirm_click(db, DM, poll.id, GUILD, CHANNEL)
    assert not out.ok and "ended" in out.text


def test_confirm_click_in_wrong_channel_is_refused(db):
    _, poll, _ = voting_poll(db)
    out = actions.confirm_click(db, DM, poll.id, GUILD, "elsewhere")
    assert not out.ok and poll.status == "voting"


# ---------------------------------------------------------------- web API cannot bind channels


def test_web_api_ignores_guild_and_channel_fields(client):
    from conftest import login
    login(client, "1", "DM")
    r = client.post("/api/campaigns", json={"name": "Sneaky", "guild_id": "123", "channel_id": "456"})
    assert r.status_code == 201
    with fresh() as db:
        assert services.campaign_for_channel(db, "123", "456") is None
        assert db.scalars(select(Campaign)).one().channel_id is None


# ---------------------------------------------------------------- wording


def test_wording_falls_back_safely():
    assert wording.t("no-such-theme", "botVoteRecorded") == wording.t("dnd", "botVoteRecorded")
    assert wording.t("dnd", "no-such-key") == "no-such-key"
    assert wording.t("dnd", "botCampaignCreated") .count("{name}") == 1  # unfilled stays visible
    assert wording.words("../../etc/passwd") == wording.words("dnd")


def test_every_theme_defines_every_bot_key():
    keys = set(wording.words("dnd"))
    for theme in wording.available_themes():
        assert keys == set(wording.words(theme)), theme

"""People who leave the Discord server stop counting; linked groups admit people via Discord."""
import asyncio
from datetime import datetime, timedelta, timezone

import discord
import pytest
from sqlalchemy import select

from app import services
from app.bot import actions, membership as membership_mod
from app.bot.actions import DUser
from app.bot.membership import MembershipSync
from app.bot.reminders import ReminderProcessor
from app.models import Member, Reminder

from conftest import login, make_client
from helpers import (
    CHANNEL, GUILD, fresh, make_campaign, make_player, mark_all_free, open_poll, voting_poll,
)
from test_reminders import FakeChan, Rig, confirmed, make_due

DM = DUser("1", "Dungeon Master", can_manage=True)
ARIA = DUser("2", "Aria")
NOW = lambda: datetime.now(timezone.utc)  # noqa: E731


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    monkeypatch.setattr(membership_mod, "PAUSE", 0)
    from app.bot import reminders as reminders_mod
    monkeypatch.setattr(reminders_mod, "DM_PAUSE", 0)


def leave(db, campaign, discord_id):
    user = services.upsert_user(db, discord_id, "x")
    member = services.get_member(db, campaign.id, user.id)
    assert services.mark_members_left(db, [member.id]) == 1
    return member


def row(db, campaign, discord_id):
    user = services.upsert_user(db, discord_id, "x")
    db.expire_all()
    return db.scalar(select(Member).where(Member.campaign_id == campaign.id, Member.user_id == user.id))


# ------------------------------------------------ the data rules


def test_someone_who_left_is_no_longer_a_member(db):
    campaign, _ = make_campaign(db)
    aria = make_player(db, campaign, "2", "Aria")
    leave(db, campaign, "2")
    assert services.get_member(db, campaign.id, aria.id) is None
    assert [m.user.discord_id for m in services.active_members(db, campaign.id)] == ["1"]


def test_they_come_back_with_their_role_and_flag_when_they_return_through_discord(db):
    campaign, _ = make_campaign(db)
    aria = make_player(db, campaign, "2", "Aria")
    member = services.get_member(db, campaign.id, aria.id)
    member.required = True
    db.commit()
    leave(db, campaign, "2")
    actions.cmd_schedule(db, ARIA, GUILD, CHANNEL)          # /schedule proves they are back
    back = row(db, campaign, "2")
    assert back.left_at is None and back.required is True and back.role == "player"
    assert len(db.scalars(select(Member).where(Member.campaign_id == campaign.id)).all()) == 2  # no duplicate


def test_a_vote_button_also_brings_them_back(db):
    campaign, poll, (_, aria, _) = voting_poll(db)
    with fresh() as other:
        services.mark_members_left(other, [services.get_member(other, campaign.id, aria.id).id])
    out = actions.vote_click(db, ARIA, poll.id, poll.candidates[0].id, GUILD, CHANNEL)
    assert out.ok and row(db, campaign, "2").left_at is None


def test_organizers_are_never_marked_as_having_left(db):
    campaign, owner = make_campaign(db)
    organizer = services.get_member(db, campaign.id, owner.id)
    assert services.mark_members_left(db, [organizer.id]) == 0
    assert row(db, campaign, "1").left_at is None


def test_marking_is_idempotent(db):
    campaign, _ = make_campaign(db)
    make_player(db, campaign, "2", "Aria")
    member = leave(db, campaign, "2")
    assert services.mark_members_left(db, [member.id]) == 0     # already marked


# ------------------------------------------------ they stop counting everywhere


def test_a_required_player_who_left_no_longer_blocks_the_poll(db):
    campaign, owner = make_campaign(db)
    aria = make_player(db, campaign, "2", "Aria")
    services.get_member(db, campaign.id, aria.id).required = True
    db.commit()
    poll = open_poll(db, campaign)
    mark_all_free(db, poll, owner)                                # Aria never answered
    with pytest.raises(services.ServiceError):
        services.close_poll(db, poll)                             # blocked on the required player
    leave(db, campaign, "2")
    services.close_poll(db, poll)                                 # she left: the poll can proceed
    assert poll.status == "voting"


def test_schedule_progress_ignores_people_who_left(db):
    campaign, owner = make_campaign(db)
    make_player(db, campaign, "2", "Aria")
    make_player(db, campaign, "3", "Borin")
    poll = open_poll(db, campaign)
    mark_all_free(db, poll, owner)
    assert "1/3" in actions.cmd_schedule(db, DM, GUILD, CHANNEL).text
    leave(db, campaign, "3")
    text = actions.cmd_schedule(db, DM, GUILD, CHANNEL).text
    assert "1/2" in text and "Borin" not in text


def test_reminders_skip_people_who_left(db):
    campaign, poll, _ = confirmed(db)
    leave(db, campaign, "3")
    make_due()
    rig = Rig()
    asyncio.run(rig.proc.run_once())
    assert sorted(rig.users) == [1, 2]
    assert "<@3>" not in rig.channel.posts[0]["content"]
    assert 3 not in [u.id for u in rig.channel.posts[0]["allowed_mentions"].users]


def test_they_lose_web_access_and_disappear_from_the_pages(client, db):
    from app.models import Campaign
    login(client, "1", "DM")
    camp = client.post("/api/campaigns", json={"name": "x"}).json()
    player = make_client()
    login(player, "2", "Aria")
    player.post("/api/join", json={"invite_code": camp["invite_code"]})
    assert player.get(f"/api/campaigns/{camp['id']}").status_code == 200
    with fresh() as other:
        services.mark_members_left(other, [services.get_member(
            other, camp["id"], services.upsert_user(other, "2", "x").id).id])
    assert player.get(f"/api/campaigns/{camp['id']}").status_code == 404
    assert player.get("/api/campaigns").json() == []
    assert [m["display_name"] for m in client.get(f"/api/campaigns/{camp['id']}").json()["members"]] == ["DM"]


# ------------------------------------------------ joining a group that lives in Discord


def test_an_invite_code_cannot_join_a_group_that_lives_in_discord(client):
    login(client, "1", "DM")
    camp = client.post("/api/campaigns", json={"name": "x"}).json()
    player = make_client()
    login(player, "2", "Aria")
    assert player.post("/api/join", json={"invite_code": camp["invite_code"]}).status_code == 200  # web-only: fine
    with fresh() as other:
        row_ = other.get(__import__("app.models", fromlist=["Campaign"]).Campaign, camp["id"])
        row_.guild_id, row_.channel_id = "5", "6"
        other.commit()
    third = make_client()
    login(third, "3", "Borin")
    r = third.post("/api/join", json={"invite_code": camp["invite_code"]})
    assert r.status_code == 409 and "/schedule" in r.json()["detail"]


def test_a_member_who_left_cannot_rejoin_with_the_code_either(client):
    login(client, "1", "DM")
    camp = client.post("/api/campaigns", json={"name": "x"}).json()
    with fresh() as other:  # now linked to Discord, with Aria already marked as gone
        c = other.get(__import__("app.models", fromlist=["Campaign"]).Campaign, camp["id"])
        c.guild_id, c.channel_id = "5", "6"
        other.commit()
    player = make_client()
    login(player, "2", "Aria")
    assert player.post("/api/join", json={"invite_code": camp["invite_code"]}).status_code == 409


# ------------------------------------------------ the periodic check against Discord


class FakeGuild:
    def __init__(self, gone=(), flaky=()):
        self.gone, self.flaky, self.asked = set(gone), set(flaky), []

    async def fetch_member(self, uid):
        self.asked.append(uid)
        if uid in self.gone:
            raise discord.NotFound(type("R", (), {"status": 404, "reason": "x"})(), "Unknown Member")
        if uid in self.flaky:
            raise discord.HTTPException(type("R", (), {"status": 500, "reason": "x"})(), "boom")
        return object()


def sync_with(guild, clock=None):
    async def get_guild(gid):
        if guild is None:
            raise discord.Forbidden(type("R", (), {"status": 403, "reason": "x"})(), "no access")
        assert gid == int(GUILD)
        return guild

    return MembershipSync(get_guild, clock=clock) if clock else MembershipSync(get_guild)


def three_player_campaign(db):
    campaign, _ = make_campaign(db)
    for i, name in ((2, "Aria"), (3, "Borin"), (4, "Cora")):
        make_player(db, campaign, str(i), name)
    return campaign


def test_people_missing_from_the_server_are_marked_as_left(db):
    campaign = three_player_campaign(db)
    guild = FakeGuild(gone={3})
    assert asyncio.run(sync_with(guild).run_once()) == 1
    assert row(db, campaign, "3").left_at is not None
    assert row(db, campaign, "2").left_at is None and row(db, campaign, "4").left_at is None
    assert 1 not in guild.asked                       # the organizer is never even checked


def test_a_discord_hiccup_is_not_evidence_that_someone_left(db):
    campaign = three_player_campaign(db)
    assert asyncio.run(sync_with(FakeGuild(flaky={2, 3, 4})).run_once()) == 0
    assert all(row(db, campaign, d).left_at is None for d in "234")


def test_if_the_bot_cannot_see_the_server_nobody_is_marked(db):
    campaign = three_player_campaign(db)
    assert asyncio.run(sync_with(None).run_once()) == 0
    assert all(row(db, campaign, d).left_at is None for d in "234")


def test_web_only_campaigns_are_not_checked(db):
    owner = services.upsert_user(db, "1", "DM")
    web, _ = services.create_campaign(db, owner, name="web")
    make_player(db, web, "2", "Aria")
    guild = FakeGuild(gone={2})
    assert asyncio.run(sync_with(guild).run_once()) == 0 and guild.asked == []


def test_already_departed_members_are_not_asked_about_again(db):
    campaign = three_player_campaign(db)
    guild = FakeGuild(gone={3})
    s = sync_with(guild)
    asyncio.run(s.run_once())
    guild.asked.clear()
    assert asyncio.run(s.run_once()) == 0 and 3 not in guild.asked


def test_a_large_server_is_checked_in_bounded_batches(db, monkeypatch):
    monkeypatch.setattr(membership_mod, "MAX_CHECKS", 2)
    campaign = three_player_campaign(db)
    guild = FakeGuild()
    asyncio.run(sync_with(guild).run_once())
    assert len(guild.asked) == 2


def test_the_check_runs_only_when_due():
    clock = {"t": 0.0}
    calls = []

    class Counting(MembershipSync):
        async def run_once(self):
            calls.append(clock["t"])
            self._last = clock["t"]
            return 0

    s = Counting(lambda gid: None, clock=lambda: clock["t"])
    asyncio.run(s.run_if_due())                                   # just started: not yet
    assert calls == []
    clock["t"] = membership_mod.FIRST_RUN_DELAY + 1               # a minute after startup
    asyncio.run(s.run_if_due())
    assert len(calls) == 1
    clock["t"] += membership_mod.INTERVAL_SECONDS - 10
    asyncio.run(s.run_if_due())                                   # not due for hours
    assert len(calls) == 1
    clock["t"] += 20
    asyncio.run(s.run_if_due())
    assert len(calls) == 2


def test_concurrent_checks_do_not_overlap(db):
    campaign = three_player_campaign(db)
    guild = FakeGuild()

    async def go():
        s = sync_with(guild)
        await asyncio.gather(*(s.run_once() for _ in range(3)))

    asyncio.run(go())
    assert len(guild.asked) == 9  # 3 members, 3 runs, one after another: no interleaving or skipping

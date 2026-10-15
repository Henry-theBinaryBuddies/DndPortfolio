"""Phase 3: reminders before a session, cancelling a decided session, and recurrence."""
import asyncio
import re
from datetime import date, datetime, timedelta, timezone

import discord
import pytest
from sqlalchemy import select

from app import background, services
from app.bot import actions, reminders as reminders_mod
from app.bot.actions import DUser
from app.bot.reminders import ReminderProcessor
from app.bot.snapshots import load_poll_snapshot
from app.bot.views import reminder_embed
from app.models import Campaign, Notification, Poll, PollMessage, Reminder
from app.services import ServiceError

from conftest import login, make_client
from helpers import CHANNEL, GUILD, fresh, make_campaign, make_player, voting_poll
from test_outbox import World, run, skip_backoff

DM = DUser("1", "Dungeon Master", can_manage=True)
ARIA = DUser("2", "Aria")
NOW = lambda: datetime.now(timezone.utc)  # noqa: E731


@pytest.fixture(autouse=True)
def no_dm_pause(monkeypatch):
    monkeypatch.setattr(reminders_mod, "DM_PAUSE", 0)


def reminder_rows():
    with fresh() as db:
        return db.scalars(select(Reminder).order_by(Reminder.offset_min.desc())).all()


def confirmed(db, **kw):
    campaign, poll, users = voting_poll(db, **kw)
    services.confirm_poll(db, poll)
    return campaign, poll, users


def make_due(minutes_ago=1):
    with fresh() as db:
        for r in db.scalars(select(Reminder)):
            r.send_at = NOW() - timedelta(minutes=minutes_ago)
        db.commit()


# ------------------------------------------------ fakes


class FakeDM:
    def __init__(self, uid, fail=None):
        self.id, self.fail, self.sent = uid, fail, []

    async def send(self, **kwargs):
        if self.fail:
            raise self.fail
        self.sent.append(kwargs)


class FakeChan:
    def __init__(self, fail=None):
        self.fail, self.posts = fail, []

    async def send(self, **kwargs):
        if self.fail:
            raise self.fail
        self.posts.append(kwargs)


class Rig:
    def __init__(self, channel=None, dm_failures=None):
        self.channel = channel or FakeChan()
        self.users = {}
        self.dm_failures = dm_failures or {}
        self.proc = ReminderProcessor(self.get_channel, self.get_user)

    async def get_channel(self, cid):
        assert cid == int(CHANNEL), "reminder went to the wrong channel"
        return self.channel

    async def get_user(self, uid):
        return self.users.setdefault(uid, FakeDM(uid, self.dm_failures.get(uid)))


def forbidden():
    return discord.Forbidden(type("R", (), {"status": 403, "reason": "Forbidden"})(), "Cannot send")


# ------------------------------------------------ scheduling


def test_confirming_schedules_a_reminder_per_offset(db):
    campaign, poll, _ = confirmed(db)
    rows = reminder_rows()
    assert [r.offset_min for r in rows] == [1440, 60]  # the defaults: a day and an hour before
    start = poll.confirmed_start_utc
    assert [r.send_at for r in rows] == [start - timedelta(minutes=1440), start - timedelta(minutes=60)]
    assert all(r.sent_at is None and r.poll_id == poll.id for r in rows)


def test_offsets_already_in_the_past_are_skipped(db):
    created = services.schedule_reminders(
        db, 1, NOW() + timedelta(hours=3), [1440, 180, 120, 60, 10], now=NOW())
    # "a day before" is long gone and "3 hours before" is right now: both skipped, not sent late
    assert sorted(r.offset_min for r in created) == [10, 60, 120]


def test_no_reminders_when_the_group_turned_them_off(db):
    campaign, poll, _ = voting_poll(db)
    services.update_campaign(db, campaign, reminder_offsets_min=[])
    services.confirm_poll(db, poll)
    assert reminder_rows() == []


def test_changing_offsets_affects_future_sessions(db):
    campaign, poll, _ = voting_poll(db)
    services.update_campaign(db, campaign, reminder_offsets_min=[30, 4320, 30])  # unsorted with a duplicate
    assert campaign.reminder_offsets_min == [4320, 30]
    services.confirm_poll(db, poll)
    assert [r.offset_min for r in reminder_rows()] == [4320, 30]


def test_due_reminders_respects_time_sent_state_and_backoff(db):
    confirmed(db)
    assert services.due_reminders(db) == []  # a day before December: nothing due
    make_due()
    due = services.due_reminders(db)
    assert len(due) == 2
    with fresh() as other:
        first = other.get(Reminder, due[0])
        first.retry_after = NOW() + timedelta(minutes=5)   # backing off
        other.get(Reminder, due[1]).sent_at = NOW()        # already sent
        other.commit()
    assert services.due_reminders(db) == []


# ------------------------------------------------ cancelling a decided session


def test_cancelling_a_confirmed_session_drops_unsent_reminders_and_queues_notice(db):
    _, poll, _ = confirmed(db)
    with fresh() as other:  # one reminder was already sent
        other.scalars(select(Reminder).where(Reminder.offset_min == 1440)).first().sent_at = NOW()
        other.commit()
    services.cancel_poll(db, poll)
    assert poll.status == "cancelled"
    left = reminder_rows()
    assert [(r.offset_min, r.sent_at is not None) for r in left] == [(1440, True)]  # sent one kept
    with fresh() as other:
        kinds = [n.kind for n in other.scalars(select(Notification).order_by(Notification.id))]
    assert kinds.count("cancelled") == 1


def test_cancel_command_works_on_a_decided_future_session(db):
    campaign, poll, _ = confirmed(db)
    reply = actions.cmd_cancel(db, DM, GUILD, CHANNEL)
    assert "burned" in reply.text and poll.status == "cancelled" and reminder_rows() == []


def test_a_cancelled_session_is_announced_and_its_reminders_never_fire(db):
    _, poll, _ = confirmed(db)
    world = World()
    run(world.processor.run_once())  # vote message and the confirmation go out
    services.cancel_poll(db, poll)
    run(world.processor.run_once())
    last = world.channel.sent[-1].embed
    assert "Called Off" in last.title and re.search(r"<t:\d+:F>", last.description)
    make_due()  # nothing left to make due
    assert services.due_reminders(db) == []


def test_deleting_a_campaign_removes_its_reminders(db):
    campaign, _, _ = confirmed(db)
    services.delete_campaign(db, campaign.id)
    assert reminder_rows() == []


# ------------------------------------------------ delivery


def test_due_reminder_pings_the_group_and_dms_everyone_once(db):
    _, poll, _ = confirmed(db)
    make_due()
    rig = Rig()
    assert run(rig.proc.run_once()) == 2
    assert len(rig.channel.posts) == 2
    post = rig.channel.posts[0]
    assert all(f"<@{i}>" in post["content"] for i in (1, 2, 3))  # the whole group, not just voters
    mentions = post["allowed_mentions"]
    assert mentions.everyone is False and mentions.roles is False
    assert sorted(u.id for u in mentions.users) == [1, 2, 3]  # exactly the members, nobody else
    assert sorted(rig.users) == [1, 2, 3] and all(len(u.sent) == 2 for u in rig.users.values())
    assert all(r.sent_at and r.dm_ok == 3 and r.dm_failed == 0 for r in reminder_rows())
    assert run(rig.proc.run_once()) == 0  # and never again
    assert len(rig.channel.posts) == 2


def test_the_reminder_says_when_the_session_starts(db):
    _, poll, _ = confirmed(db)
    make_due()
    rig = Rig()
    run(rig.proc.run_once())
    embed = rig.channel.posts[0]["embed"]
    assert embed.title == "The Hour Draws Near" and "Session 5" in embed.description
    assert re.search(r"<t:\d+:F> \(<t:\d+:R>\)", embed.description)
    assert embed.footer.text == "Curse of Strahd"


def test_closed_dms_do_not_stop_the_reminder(db):
    confirmed(db)
    make_due()
    rig = Rig(dm_failures={2: forbidden(), 3: discord.HTTPException(
        type("R", (), {"status": 500, "reason": "oops"})(), "boom")})
    run(rig.proc.run_once())
    assert len(rig.channel.posts) == 2  # the channel mention still reached everyone
    rows = reminder_rows()
    assert all(r.sent_at and r.dm_ok == 1 and r.dm_failed == 2 for r in rows)


def test_a_channel_failure_retries_without_having_dmed_anyone(db):
    confirmed(db)
    make_due()
    rig = Rig(channel=FakeChan(fail=RuntimeError("discord is down")))
    run(rig.proc.run_once())
    assert rig.users == {}  # no DMs yet: a retry cannot produce duplicates
    rows = reminder_rows()
    assert all(r.sent_at is None and r.attempts == 1 and r.retry_after > NOW() for r in rows)
    rig.channel.fail = None
    run(rig.proc.run_once())
    assert rig.channel.posts == []  # still backing off
    with fresh() as other:
        for r in other.scalars(select(Reminder)):
            r.retry_after = NOW() - timedelta(seconds=1)
        other.commit()
    run(rig.proc.run_once())
    assert len(rig.channel.posts) == 2 and all(len(u.sent) == 2 for u in rig.users.values())
    assert all(r.sent_at for r in reminder_rows())


def test_a_reminder_for_a_session_that_already_started_is_skipped(db):
    _, poll, _ = confirmed(db)
    make_due()
    with fresh() as other:
        other.get(Poll, poll.id).confirmed_start_utc = NOW() - timedelta(minutes=5)
        other.commit()
    rig = Rig()
    run(rig.proc.run_once())
    assert rig.channel.posts == [] and rig.users == {}
    assert all(r.sent_at and "already started" in r.error for r in reminder_rows())


def test_a_reminder_whose_poll_is_no_longer_confirmed_is_skipped(db):
    _, poll, _ = confirmed(db)
    make_due()
    with fresh() as other:  # simulate a status change that bypassed cancel_poll
        other.get(Poll, poll.id).status = "cancelled"
        other.commit()
    rig = Rig()
    run(rig.proc.run_once())
    assert rig.channel.posts == [] and all("no longer scheduled" in r.error for r in reminder_rows())


def test_nothing_is_sent_before_the_time(db):
    confirmed(db)
    rig = Rig()
    assert run(rig.proc.run_once()) == 0 and rig.channel.posts == []


def test_an_unlinked_campaign_is_reminded_by_dm_only(db):
    campaign, poll, _ = confirmed(db)
    with fresh() as other:
        row = other.get(Campaign, campaign.id)
        row.guild_id = row.channel_id = None
        other.commit()
    make_due()
    rig = Rig()
    run(rig.proc.run_once())
    assert rig.channel.posts == [] and sorted(rig.users) == [1, 2, 3]


def test_a_huge_group_is_capped(db, monkeypatch):
    monkeypatch.setattr(reminders_mod, "MAX_MEMBERS", 2)
    campaign, poll, _ = confirmed(db)
    make_due()
    rig = Rig()
    run(rig.proc.run_once())
    assert len(rig.users) == 2 and rig.channel.posts[0]["content"].count("<@") == 2


def test_concurrent_runs_do_not_double_send(db):
    confirmed(db)
    make_due()
    rig = Rig()

    async def go():
        await asyncio.gather(*(rig.proc.run_once() for _ in range(4)))

    run(go())
    assert len(rig.channel.posts) == 2  # one per reminder, not four


def test_the_background_loop_runs_reminders(monkeypatch):
    calls = []

    class Bot:
        def is_ready(self):
            return True

        class outbox:
            @staticmethod
            async def run_once():
                calls.append("outbox")

        class reminders:
            @staticmethod
            async def run_once():
                calls.append("reminders")

    async def stop(_):
        raise asyncio.CancelledError

    monkeypatch.setattr(background.asyncio, "sleep", stop)
    bg = background.Background()
    bg.bot = Bot()
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(bg._loop())
    assert calls == ["outbox", "reminders"]


# ------------------------------------------------ the reminder message


def test_reminder_embed_for_snapshot(db):
    _, poll, _ = confirmed(db)
    embed = reminder_embed(load_poll_snapshot(db, poll.id))
    assert embed.colour.value == 0xE0A63A and "Session 5" in embed.description


# ------------------------------------------------ the reported failure: nothing fired


def near_term_confirmed(db, minutes_ahead=18, offsets=None):
    """A campaign whose confirmed session starts `minutes_ahead` from now."""
    campaign, poll, users = voting_poll(db)
    if offsets is not None:
        services.update_campaign(db, campaign, reminder_offsets_min=offsets)
    with fresh() as other:  # move the decided time close to now, as in a live test
        row = other.get(Poll, poll.id)
        row.status = "voting"
        other.commit()
    start = NOW() + timedelta(minutes=minutes_ahead)
    with fresh() as other:
        cand = other.get(Poll, poll.id).candidates[0]
        cand.start_utc = start
        other.commit()
    db.expire_all()
    services.confirm_poll(db, db.get(Poll, poll.id), poll.candidates[0].id)
    return campaign, db.get(Poll, poll.id), start


def test_default_timings_schedule_nothing_for_a_session_soon_and_say_so(db):
    campaign, poll, _ = near_term_confirmed(db, minutes_ahead=18)
    assert reminder_rows() == []  # a day and an hour before are both already past
    text = actions.cmd_schedule(db, ARIA, GUILD, CHANNEL).text
    assert "No reminder fits" in text
    embed = confirmed_embed_for(db, poll)
    assert "No reminder fits" in embed.description  # and the announcement says so, not silence


def test_setting_timings_after_confirming_schedules_them(db):
    """The exact live sequence: confirm first, then set reminders. It used to do nothing."""
    campaign, poll, start = near_term_confirmed(db, minutes_ahead=18)
    assert reminder_rows() == []
    reply = actions.cmd_setup(db, DM, GUILD, CHANNEL, reminders="8m, 3m, 1m")
    rows = reminder_rows()
    assert sorted(r.offset_min for r in rows) == [1, 3, 8]
    assert sorted(r.send_at for r in rows) == [start - timedelta(minutes=m) for m in (8, 3, 1)]
    assert reply.text.count("<t:") == 3 and "8 minutes" in reply.text


def test_timings_that_cannot_fit_are_reported_in_the_reply(db):
    near_term_confirmed(db, minutes_ahead=18)
    reply = actions.cmd_setup(db, DM, GUILD, CHANNEL, reminders="1d, 1h")
    assert "No reminder fits" in reply.text and reminder_rows() == []


def test_changing_timings_replaces_unsent_and_keeps_sent_ones(db):
    campaign, poll, start = near_term_confirmed(db, minutes_ahead=60, offsets=[30, 10])
    assert sorted(r.offset_min for r in reminder_rows()) == [10, 30]
    with fresh() as other:  # the 30-minute one has already gone out
        other.scalars(select(Reminder).where(Reminder.offset_min == 30)).first().sent_at = NOW()
        other.commit()
    actions.cmd_setup(db, DM, GUILD, CHANNEL, reminders="30m, 5m")
    rows = {r.offset_min: r for r in reminder_rows()}
    assert sorted(rows) == [5, 30]            # 10 replaced by 5; 30 not duplicated
    assert rows[30].sent_at is not None       # and not sent a second time
    actions.cmd_setup(db, DM, GUILD, CHANNEL, reminders="off")
    assert [r.offset_min for r in reminder_rows()] == [30]  # unsent ones dropped, history kept


def test_changing_timings_never_touches_past_or_cancelled_sessions(db):
    campaign, poll, _ = confirmed(db)
    services.cancel_poll(db, poll)
    services.update_campaign(db, campaign, reminder_offsets_min=[15])
    assert reminder_rows() == []
    campaign2, poll2, _ = confirmed(db, guild="7", channel="8")
    with fresh() as other:
        other.get(Poll, poll2.id).confirmed_start_utc = NOW() - timedelta(hours=2)  # happened
        for r in other.scalars(select(Reminder).where(Reminder.poll_id == poll2.id)):
            other.delete(r)
        other.commit()
    services.update_campaign(db, campaign2, reminder_offsets_min=[15])
    assert reminder_rows() == []


def test_the_live_scenario_end_to_end_a_reminder_actually_fires(db):
    campaign, poll, start = near_term_confirmed(db, minutes_ahead=18)
    actions.cmd_setup(db, DM, GUILD, CHANNEL, reminders="8m, 3m, 1m")
    rig = Rig()
    assert run(rig.proc.run_once()) == 0                      # not yet time
    with fresh() as other:                                    # advance the clock to T-8m
        for r in other.scalars(select(Reminder).where(Reminder.offset_min == 8)):
            r.send_at = NOW() - timedelta(seconds=5)
        other.commit()
    assert run(rig.proc.run_once()) == 1
    assert len(rig.channel.posts) == 1 and "<@1>" in rig.channel.posts[0]["content"]
    assert sorted(rig.users) == [1, 2, 3]
    # rows are ordered 8m, 3m, 1m: only the 8-minute reminder has gone out
    assert [r.sent_at is not None for r in reminder_rows()] == [True, False, False]


def test_the_announcement_lists_the_reminder_times(db):
    campaign, poll, _ = confirmed(db)  # default timings, session in December
    embed = confirmed_embed_for(db, poll)
    assert embed.description.count("<t:") >= 4  # the session (absolute+relative) and two reminders
    assert "Reminders will be sent" not in embed.description  # no placeholder text leaked
    assert "reminded at" in embed.description


def confirmed_embed_for(db, poll):
    from app.bot.views import confirmed_embed
    return confirmed_embed(load_poll_snapshot(db, poll.id))

"""Recurring sessions: when a decided session ends, the next one is scheduled automatically at
the same local time. Built around the example 'Saturdays at 11:00 AM, weekly'."""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app import background, services
from app.bot import actions
from app.bot.actions import DUser
from app.bot.outbox import OutboxProcessor
from app.bot.snapshots import load_poll_snapshot
from app.bot.views import confirmed_embed, recurred_embed, session_cancelled_embed
from app.models import Notification, Poll, Reminder
from app.services import ServiceError, add_cadence

from helpers import CHANNEL, GUILD, fresh, make_campaign, make_player, mark_all_free, open_poll, voting_poll
from test_outbox import World, run

PT = ZoneInfo("America/Los_Angeles")
UTC = timezone.utc
DM = DUser("1", "Dungeon Master", can_manage=True)
ARIA = DUser("2", "Aria")


def local(y, m, d, hh=11, mm=0, tz=PT):
    return datetime(y, m, d, hh, mm, tzinfo=tz)


def decided(db, campaign, start, *, duration=180, tz="America/Los_Angeles", recurred_from=None):
    """A decided session starting at `start` (aware), as if a poll had confirmed it."""
    poll = Poll(
        campaign_id=campaign.id, title="Saturday game", timezone=tz,
        date_start=start.date(), date_end=start.date() + timedelta(days=6),
        window_start=time(10), window_end=time(15), slot_minutes=30, duration_min=duration,
        min_quorum=1, vote_top_n=3, status="confirmed",
        confirmed_start_utc=start.astimezone(UTC), recurred_from=recurred_from)
    db.add(poll)
    db.commit()
    return poll


def repeating(db, cadence="weekly", tz="America/Los_Angeles", **kw):
    campaign, owner = make_campaign(db)
    services.update_campaign(db, campaign, cadence=cadence, timezone=tz, **kw)
    return campaign, owner


def all_polls(db):
    db.expire_all()
    return db.scalars(select(Poll).order_by(Poll.id)).all()


def kinds(db, kind):
    return [n for n in db.scalars(select(Notification).order_by(Notification.id)) if n.kind == kind]


# ------------------------------------------------ the headline behaviour


def test_a_saturday_11am_weekly_session_reschedules_for_next_saturday_when_it_ends(db):
    campaign, _ = repeating(db, "weekly")
    first = decided(db, campaign, local(2026, 10, 17, 11))           # Saturday 11:00 AM, 3 hours
    ended = local(2026, 10, 17, 14, 1)                                # one minute after it concluded
    assert services.roll_recurrences(db, now=ended.astimezone(UTC)) != []
    polls = all_polls(db)
    nxt = polls[-1]
    assert len(polls) == 2 and nxt.id != first.id
    assert nxt.confirmed_start_utc == local(2026, 10, 24, 11).astimezone(UTC)  # next Saturday, 11:00 AM
    assert nxt.confirmed_start_utc.astimezone(PT).strftime("%A %H:%M") == "Saturday 11:00"
    assert nxt.status == "confirmed" and nxt.recurred_from == first.id


def test_nothing_happens_while_the_session_is_still_going(db):
    campaign, _ = repeating(db)
    decided(db, campaign, local(2026, 10, 17, 11))
    during = local(2026, 10, 17, 12, 30).astimezone(UTC)
    assert services.roll_recurrences(db, now=during) == [] and len(all_polls(db)) == 1
    just_before_end = local(2026, 10, 17, 13, 59).astimezone(UTC)
    assert services.roll_recurrences(db, now=just_before_end) == []
    at_end = local(2026, 10, 17, 14, 0).astimezone(UTC)
    assert len(services.roll_recurrences(db, now=at_end)) == 1


def test_it_happens_exactly_once_per_session(db):
    campaign, _ = repeating(db)
    first = decided(db, campaign, local(2026, 10, 17, 11))
    after = local(2026, 10, 17, 15).astimezone(UTC)
    assert len(services.roll_recurrences(db, now=after)) == 1
    for _ in range(3):
        assert services.roll_recurrences(db, now=after) == []
    assert len(all_polls(db)) == 2
    assert db.get(Poll, first.id).recurrence_handled is True
    assert len(kinds(db, "recurred")) == 1


def test_the_series_keeps_going_session_after_session(db):
    campaign, _ = repeating(db)
    decided(db, campaign, local(2026, 10, 17, 11))
    for _ in range(5):
        latest = all_polls(db)[-1]
        now = latest.confirmed_start_utc + timedelta(hours=4)           # an hour after it ended
        assert len(services.roll_recurrences(db, now=now)) == 1
    starts = [p.confirmed_start_utc.astimezone(PT) for p in all_polls(db)]
    assert [s.strftime("%m-%d %H:%M") for s in starts] == [
        "10-17 11:00", "10-24 11:00", "10-31 11:00", "11-07 11:00", "11-14 11:00", "11-21 11:00"]
    assert all(s.strftime("%A") == "Saturday" for s in starts)


def test_a_one_off_group_never_repeats(db):
    campaign, _ = repeating(db, "none")
    first = decided(db, campaign, local(2026, 10, 17, 11))
    assert services.roll_recurrences(db, now=local(2026, 10, 18).astimezone(UTC)) == []
    assert len(all_polls(db)) == 1 and db.get(Poll, first.id).recurrence_handled is True


def test_a_session_in_the_future_or_cancelled_or_unconfirmed_is_left_alone(db):
    campaign, owner = repeating(db)
    decided(db, campaign, local(2027, 1, 2, 11))                       # not started
    cancelled = decided(db, campaign, local(2026, 10, 3, 11))
    cancelled.status = "cancelled"
    open_poll(db, campaign)                                            # collecting
    db.commit()
    assert services.roll_recurrences(db, now=local(2026, 10, 20).astimezone(UTC)) == []
    assert len(all_polls(db)) == 3


# ------------------------------------------------ time rules


def test_the_local_time_survives_a_daylight_saving_change(db):
    campaign, _ = repeating(db)
    decided(db, campaign, local(2026, 10, 31, 11))                     # PDT (UTC-7): 18:00 UTC
    services.roll_recurrences(db, now=local(2026, 10, 31, 15).astimezone(UTC))
    nxt = all_polls(db)[-1]
    assert nxt.confirmed_start_utc.astimezone(PT).strftime("%Y-%m-%d %H:%M %Z") == "2026-11-07 11:00 PST"
    assert nxt.confirmed_start_utc.hour == 19  # one hour later in UTC, same 11:00 on the wall


@pytest.mark.parametrize("cadence,expected", [
    ("weekly", "2026-10-24"), ("biweekly", "2026-10-31"), ("monthly", "2026-11-17"),
    ("quarterly", "2027-01-17"), ("annually", "2027-10-17"),
])
def test_each_frequency_picks_its_own_interval(db, cadence, expected):
    campaign, _ = repeating(db, cadence)
    decided(db, campaign, local(2026, 10, 17, 11))
    services.roll_recurrences(db, now=local(2026, 10, 17, 15).astimezone(UTC))
    nxt = all_polls(db)[-1]
    assert nxt.confirmed_start_utc.astimezone(PT).strftime("%Y-%m-%d %H:%M") == f"{expected} 11:00"


def test_month_end_dates_do_not_drift(db):
    campaign, _ = repeating(db, "monthly", tz="UTC")
    decided(db, campaign, datetime(2026, 1, 31, 11, tzinfo=UTC), tz="UTC")
    seen = []
    for _ in range(5):
        last = all_polls(db)[-1]
        services.roll_recurrences(db, now=last.confirmed_start_utc + timedelta(hours=4))
        seen.append(all_polls(db)[-1].confirmed_start_utc.strftime("%m-%d"))
    assert seen == ["02-28", "03-31", "04-30", "05-31", "06-30"]  # back to the 31st whenever it exists


@pytest.mark.parametrize("start,cadence,anchor,expected", [
    (date(2026, 2, 28), "monthly", 31, date(2026, 3, 31)),
    (date(2026, 4, 30), "monthly", 31, date(2026, 5, 31)),
    (date(2027, 2, 28), "annually", 29, date(2028, 2, 29)),
    (date(2026, 11, 30), "quarterly", 30, date(2027, 2, 28)),
])
def test_add_cadence_honours_the_anchor_day(start, cadence, anchor, expected):
    assert add_cadence(start, cadence, anchor) == expected


def test_after_downtime_the_series_catches_up_to_the_next_session_still_ahead(db):
    campaign, _ = repeating(db)
    decided(db, campaign, local(2026, 10, 3, 11))
    now = local(2026, 10, 27, 9).astimezone(UTC)                       # the bot was off for weeks
    services.roll_recurrences(db, now=now)
    nxt = all_polls(db)[-1]
    assert nxt.confirmed_start_utc.astimezone(PT).strftime("%m-%d %H:%M") == "10-31 11:00"
    assert nxt.confirmed_start_utc > now and len(all_polls(db)) == 2   # no pile of past sessions


def test_the_new_session_copies_the_old_ones_shape(db):
    campaign, _ = repeating(db)
    first = decided(db, campaign, local(2026, 10, 17, 11), duration=150)
    services.roll_recurrences(db, now=local(2026, 10, 17, 15).astimezone(UTC))
    nxt = all_polls(db)[-1]
    assert (nxt.title, nxt.timezone, nxt.duration_min, nxt.window_start, nxt.window_end, nxt.min_quorum,
            nxt.slot_minutes) == (first.title, first.timezone, 150, first.window_start, first.window_end,
                                  first.min_quorum, first.slot_minutes)
    assert nxt.anchor_day == 17 and nxt.date_start == date(2026, 10, 24)


# ------------------------------------------------ reminders and announcement come with it


def test_the_new_session_gets_its_reminders(db):
    campaign, _ = repeating(db, reminder_offsets_min=[1440, 60])
    decided(db, campaign, local(2026, 10, 17, 11))
    services.roll_recurrences(db, now=local(2026, 10, 17, 15).astimezone(UTC))
    nxt = all_polls(db)[-1]
    with fresh() as other:
        rows = other.scalars(select(Reminder).where(Reminder.poll_id == nxt.id)).all()
    assert sorted(r.send_at for r in rows) == [
        local(2026, 10, 23, 11).astimezone(UTC), local(2026, 10, 24, 10).astimezone(UTC)]


def test_an_unlinked_web_campaign_repeats_too(db):
    owner = services.upsert_user(db, "1", "DM")
    campaign, _ = services.create_campaign(db, owner, name="Web only", cadence="weekly",
                                           timezone="America/Los_Angeles")
    decided(db, campaign, local(2026, 10, 17, 11))
    assert len(services.roll_recurrences(db, now=local(2026, 10, 17, 15).astimezone(UTC))) == 1


def test_the_group_is_told_in_the_channel(db):
    campaign, _ = repeating(db)
    decided(db, campaign, local(2026, 10, 17, 11))
    services.roll_recurrences(db, now=local(2026, 10, 17, 15).astimezone(UTC))
    world = World()
    run(world.processor.run_once())
    announcement = world.channel.sent[-1].embed
    assert announcement.title == "The Wheel Turns"
    assert "Saturday game" in announcement.description and "<t:" in announcement.description
    assert "reminded at" in announcement.description


def test_the_announcement_is_skipped_if_the_session_was_replaced_meanwhile(db):
    campaign, _ = repeating(db)
    decided(db, campaign, local(2026, 10, 17, 11))
    services.roll_recurrences(db, now=local(2026, 10, 17, 15).astimezone(UTC))
    nxt = all_polls(db)[-1]
    with fresh() as other:
        other.get(Poll, nxt.id).status = "cancelled"
        other.commit()
    world = World()
    run(world.processor.run_once())
    assert all(m.embed.title != "The Wheel Turns" for m in world.channel.sent)


def test_a_confirmed_announcement_promises_what_will_happen_next(db):
    campaign, poll, _ = voting_poll(db)
    services.update_campaign(db, campaign, cadence="weekly")
    services.confirm_poll(db, poll)
    text = confirmed_embed(load_poll_snapshot(db, poll.id)).description
    assert "next gathering is set automatically" in text


def test_one_off_groups_make_no_such_promise(db):
    campaign, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    assert "automatically" not in confirmed_embed(load_poll_snapshot(db, poll.id)).description


# ------------------------------------------------ skipping, replacing, changing


def test_cancelling_a_session_skips_it_and_schedules_the_next_straight_away(db):
    campaign, owner = repeating(db)
    first = decided(db, campaign, local(2030, 3, 2, 11))
    services.cancel_poll(db, first)
    polls = all_polls(db)
    assert [p.status for p in polls] == ["cancelled", "confirmed"]
    assert polls[1].confirmed_start_utc == local(2030, 3, 9, 11).astimezone(UTC)  # a week later, same hour
    assert polls[1].recurred_from == first.id and polls[0].recurrence_handled is True


def test_skipping_does_not_end_the_series(db):
    campaign, _ = repeating(db)
    first = decided(db, campaign, local(2030, 3, 2, 11))
    services.cancel_poll(db, first)
    second = all_polls(db)[-1]
    services.cancel_poll(db, second)                                    # skip two weeks in a row
    assert all_polls(db)[-1].confirmed_start_utc == local(2030, 3, 16, 11).astimezone(UTC)


def test_cancelling_in_a_one_off_group_just_cancels(db):
    campaign, _ = repeating(db, "none")
    first = decided(db, campaign, local(2030, 3, 2, 11))
    services.cancel_poll(db, first)
    assert [p.status for p in all_polls(db)] == ["cancelled"]


def test_the_cancel_command_names_the_next_session_and_how_to_stop(db):
    campaign, _ = repeating(db)
    campaign.channel_id, campaign.guild_id = CHANNEL, GUILD
    db.commit()
    decided(db, campaign, local(2030, 3, 2, 11))
    reply = actions.cmd_cancel(db, DM, GUILD, CHANNEL)
    assert "next session is" in reply.text and "one-off" in reply.text


def test_the_cancelled_announcement_says_when_the_next_one_is(db):
    campaign, _ = repeating(db)
    first = decided(db, campaign, local(2030, 3, 2, 11))
    services.cancel_poll(db, first)
    text = session_cancelled_embed(load_poll_snapshot(db, first.id)).description
    assert "next gathering is" in text and text.count("<t:") >= 3


def test_deciding_a_session_by_poll_replaces_automatic_ones(db):
    campaign, owner = repeating(db)
    first = decided(db, campaign, local(2030, 3, 2, 11))
    services.roll_recurrences(db, now=local(2030, 3, 2, 15).astimezone(UTC))
    auto = all_polls(db)[-1]
    assert auto.recurred_from == first.id and auto.status == "confirmed"
    # the group re-polls and decides a different time; the automatic one must not double up
    aria = make_player(db, campaign, "2", "Aria")
    poll = open_poll(db, campaign, tz="America/Los_Angeles", date_start=date(2030, 3, 4))
    for u in (owner, aria):
        mark_all_free(db, poll, u)
    services.close_poll(db, poll)
    services.confirm_poll(db, poll)
    statuses = {p.id: p.status for p in all_polls(db)}
    assert statuses[auto.id] == "cancelled" and statuses[poll.id] == "confirmed"
    assert len(kinds(db, "cancelled")) == 1                              # the group is told
    with fresh() as other:
        assert other.scalars(select(Reminder).where(Reminder.poll_id == auto.id)).all() == []


def test_a_session_decided_by_a_poll_is_never_superseded(db):
    campaign, owner = repeating(db)
    a = decided(db, campaign, local(2030, 3, 2, 11))      # a poll-decided session (not automatic)
    b = decided(db, campaign, local(2030, 3, 9, 11))
    services.supersede_auto_sessions(db, campaign.id, keep_id=b.id)
    assert [p.status for p in all_polls(db)] == ["confirmed", "confirmed"]


def test_changing_the_frequency_replans_the_upcoming_automatic_session(db):
    campaign, _ = repeating(db, "weekly")
    first = decided(db, campaign, local(2030, 3, 2, 11))
    services.roll_recurrences(db, now=local(2030, 3, 2, 15).astimezone(UTC))
    assert all_polls(db)[-1].confirmed_start_utc == local(2030, 3, 9, 11).astimezone(UTC)
    services.update_campaign(db, campaign, cadence="monthly")
    polls = all_polls(db)
    assert [p.status for p in polls] == ["confirmed", "cancelled", "confirmed"]
    assert polls[-1].confirmed_start_utc == local(2030, 4, 2, 11).astimezone(UTC)  # a month after the real session
    assert polls[-1].recurred_from == first.id


def test_switching_to_one_off_drops_the_upcoming_automatic_session(db):
    campaign, _ = repeating(db, "weekly")
    decided(db, campaign, local(2030, 3, 2, 11))
    services.roll_recurrences(db, now=local(2030, 3, 2, 15).astimezone(UTC))
    services.update_campaign(db, campaign, cadence="none")
    assert [p.status for p in all_polls(db)] == ["confirmed", "cancelled"]
    assert services.roll_recurrences(db, now=local(2031, 1, 1).astimezone(UTC)) == []


def test_saving_the_same_frequency_changes_nothing(db):
    campaign, _ = repeating(db, "weekly")
    decided(db, campaign, local(2030, 3, 2, 11))
    services.roll_recurrences(db, now=local(2030, 3, 2, 15).astimezone(UTC))
    before = [(p.id, p.status) for p in all_polls(db)]
    services.update_campaign(db, campaign, cadence="weekly", min_quorum=1)
    assert [(p.id, p.status) for p in all_polls(db)] == before


# ------------------------------------------------ visible to players, and the loop


def test_schedule_shows_the_automatically_scheduled_session(db):
    campaign, _ = repeating(db)
    campaign.guild_id, campaign.channel_id = GUILD, CHANNEL
    db.commit()
    decided(db, campaign, local(2030, 3, 2, 11))
    services.roll_recurrences(db, now=local(2030, 3, 2, 15).astimezone(UTC))
    text = actions.cmd_schedule(db, ARIA, GUILD, CHANNEL).text
    assert "confirmed" in text and "Nothing is scheduled" not in text


def test_the_background_tick_runs_recurrence_alongside_auto_confirm(db):
    campaign, _ = repeating(db)
    decided(db, campaign, local(2020, 3, 7, 11))          # long over; will catch up to something ahead
    confirmed, scheduled = background._db_tick()
    assert confirmed == [] and len(scheduled) == 1
    assert all_polls(db)[-1].confirmed_start_utc > datetime.now(UTC)


def test_the_campaign_json_lists_automatic_sessions(client):
    from conftest import login
    login(client, "1", "DM")
    cid = client.post("/api/campaigns", json={"name": "x", "cadence": "weekly"}).json()["id"]
    with fresh() as other:
        camp = other.get(__import__("app.models", fromlist=["Campaign"]).Campaign, cid)
        decided(other, camp, local(2030, 3, 2, 11))
        services.roll_recurrences(other, now=local(2030, 3, 2, 15).astimezone(UTC))
    polls = client.get(f"/api/campaigns/{cid}").json()["polls"]
    assert [p["auto"] for p in polls] == [False, True]
    assert polls[1]["confirmed_start"].endswith("Z")

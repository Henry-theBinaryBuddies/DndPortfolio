"""One repeating Discord event per repeating group, and 'I'm in / Can't make it' on the
reminder DMs, which reschedule a session that more than half the group cannot attend."""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import discord
import pytest
from sqlalchemy import select

from app import services
from app.bot import actions, events, reminders as reminders_mod
from app.bot.actions import DUser
from app.bot.reminders import ReminderProcessor
from app.bot.views import RSVP_TEMPLATE, RsvpButton
from app.models import Attendance, Campaign, Member, Notification, Poll, Reminder

from helpers import CHANNEL, GUILD, fresh, make_campaign, make_player
from test_events import stored_event_id
from test_outbox import FakeResponse, World, run
from test_recurrence import all_polls, decided, kinds, local, repeating
from test_reminders import FakeChan, Rig, make_due

UTC = timezone.utc
PT = ZoneInfo("America/Los_Angeles")
SAT_11AM = local(2030, 3, 2, 11)  # a Saturday, in a year the tests' clock has not reached


def series_of(world):
    return list(world.guild.series.items())


# ------------------------------------------------ the repeat rules Discord is sent


@pytest.mark.parametrize("cadence,expected", [
    ("weekly", {"frequency": 2, "interval": 1, "by_weekday": [5]}),
    ("biweekly", {"frequency": 2, "interval": 2, "by_weekday": [5]}),
    ("monthly", {"frequency": 1, "interval": 1, "by_n_weekday": [{"n": 1, "day": 5}]}),
    ("annually", {"frequency": 0, "interval": 1, "by_month": [3], "by_month_day": [2]}),
])
def test_each_frequency_becomes_the_matching_discord_rule(cadence, expected):
    rule = events.recurrence_rule(cadence, SAT_11AM.astimezone(UTC))  # Saturday 2 March 2030
    assert rule == {"start": "2030-03-02T19:00:00Z", **expected}


def test_a_one_off_group_has_no_repeat_rule():
    assert events.recurrence_rule("none", SAT_11AM) is None


def test_a_fifth_weekday_is_offered_as_the_fourth():
    assert events.recurrence_rule("monthly", datetime(2026, 1, 31, 11, tzinfo=UTC))["by_n_weekday"] == [
        {"n": 4, "day": 5}]


# ------------------------------------------------ one repeating event, moved not duplicated


def test_the_first_confirmed_session_creates_one_repeating_event(db):
    campaign, _ = repeating(db, "weekly")
    first = decided(db, campaign, SAT_11AM)
    services.enqueue(db, "event_sync", first.id)
    db.commit()
    world = World()
    run(world.processor.run_once())
    ((event_id, event),) = series_of(world)
    assert world.guild.created == []
    assert event["recurrence_rule"]["by_weekday"] == [5]
    assert event["scheduled_start_time"] == "2030-03-02T19:00:00Z"
    assert event["scheduled_end_time"] == "2030-03-02T22:00:00Z"
    assert event["entity_type"] == 3 and event["entity_metadata"]["location"].endswith(f"id={campaign.id}")
    with fresh() as other:
        c = other.get(Campaign, campaign.id)
        assert (c.series_event_id, c.events_guild_id) == (event_id, GUILD) and c.series_event_sig


def test_a_new_poll_that_moves_the_session_updates_the_same_event(db):
    campaign, _ = repeating(db, "weekly")
    first = decided(db, campaign, SAT_11AM)
    services.enqueue(db, "event_sync", first.id)
    db.commit()
    world = World()
    run(world.processor.run_once())
    (event_id,) = world.guild.series
    services.cancel_poll(db, first)  # called off; the poll that replaces it is decided for Sunday
    moved = decided(db, campaign, local(2030, 3, 3, 14))
    services.supersede_auto_sessions(db, campaign.id, moved.id)
    services.enqueue(db, "event_sync", moved.id)
    db.commit()
    run(world.processor.run_once())
    assert list(world.guild.series) == [event_id]                      # not a second event
    event = world.guild.series[event_id]
    assert event["scheduled_start_time"] == "2030-03-03T22:00:00Z"
    assert event["recurrence_rule"]["by_weekday"] == [6]               # now repeats on Sundays


def test_nothing_is_sent_when_nothing_changed(db):
    campaign, _ = repeating(db, "weekly")
    first = decided(db, campaign, SAT_11AM)
    services.enqueue(db, "event_sync", first.id)
    db.commit()
    world = World()
    run(world.processor.run_once())
    calls = len(world.guild._state.http.calls)
    with fresh() as other:
        services.enqueue(other, "event_sync", first.id)
        other.commit()
    run(world.processor.run_once())
    assert len(world.guild._state.http.calls) == calls


def test_an_event_deleted_by_hand_is_made_again(db):
    campaign, _ = repeating(db, "weekly")
    first = decided(db, campaign, SAT_11AM)
    services.enqueue(db, "event_sync", first.id)
    db.commit()
    world = World()
    run(world.processor.run_once())
    world.guild.series.clear()                                          # someone removed it in Discord
    second = decided(db, campaign, local(2030, 3, 9, 11))
    services.enqueue(db, "event_sync", second.id)                       # a change makes the bot look again
    services.cancel_poll(db, first)
    db.commit()
    run(world.processor.run_once())
    assert len(world.guild.series) == 1


def test_if_discord_refuses_the_repeat_rule_the_event_is_still_made(db):
    campaign, _ = repeating(db, "weekly")
    first = decided(db, campaign, SAT_11AM)
    services.enqueue(db, "event_sync", first.id)
    db.commit()
    world = World()
    world.guild._state.http.reject_rules = True
    run(world.processor.run_once())
    ((_, event),) = series_of(world)
    assert "recurrence_rule" not in event


def test_a_one_off_groups_old_event_is_replaced_when_the_group_starts_repeating(db):
    campaign, _ = repeating(db, "none")
    session = decided(db, campaign, SAT_11AM)
    services.enqueue(db, "event_sync", session.id)
    db.commit()
    world = World()
    run(world.processor.run_once())
    assert len(world.guild.events) == 1 and stored_event_id(session.id)
    services.update_campaign(db, campaign, cadence="weekly")
    run(world.processor.run_once())
    assert world.guild.events == {} and stored_event_id(session.id) is None
    assert len(world.guild.series) == 1


def test_turning_events_off_removes_the_repeating_event(db):
    campaign, _ = repeating(db, "weekly")
    first = decided(db, campaign, SAT_11AM)
    services.enqueue(db, "event_sync", first.id)
    db.commit()
    world = World()
    run(world.processor.run_once())
    services.update_campaign(db, campaign, events_enabled=False)
    run(world.processor.run_once())
    assert world.guild.series == {}


def test_unlinking_the_channel_removes_the_repeating_event(db):
    campaign, _ = repeating(db, "weekly")
    first = decided(db, campaign, SAT_11AM)
    services.enqueue(db, "event_sync", first.id)
    db.commit()
    world = World()
    run(world.processor.run_once())
    assert len(world.guild.series) == 1
    db.expire_all()
    services.unlink_campaign(db, campaign)                              # the channel link is gone...
    run(world.processor.run_once())                                     # ...yet the event is still removed
    assert world.guild.series == {}
    with fresh() as other:
        c = other.get(Campaign, campaign.id)
        assert c.series_event_id is None and c.channel_id is None


def test_unlinking_removes_a_one_off_groups_session_events_too(db):
    campaign, _ = repeating(db, "none")
    session = decided(db, campaign, SAT_11AM)
    services.enqueue(db, "event_sync", session.id)
    db.commit()
    world = World()
    run(world.processor.run_once())
    assert len(world.guild.events) == 1
    db.expire_all()
    services.unlink_campaign(db, campaign)
    run(world.processor.run_once())
    assert world.guild.events == {} and stored_event_id(session.id) is None


def test_unlinking_a_group_without_events_queues_nothing(db):
    campaign, _ = repeating(db, "weekly")
    services.unlink_campaign(db, campaign)
    assert kinds(db, "event_sync") == []


# ------------------------------------------------ answering the reminder


def session_of(db, players=2, **kw):
    """A confirmed upcoming session for a group of the organizer plus `players`-1 others."""
    campaign, owner = make_campaign(db)
    users = [owner] + [make_player(db, campaign, str(10 + i), f"P{i}") for i in range(players - 1)]
    poll = decided(db, campaign, SAT_11AM, **kw)
    services.schedule_reminders(db, poll.id, poll.confirmed_start_utc, [1440, 60])
    db.commit()
    return campaign, poll, users


def test_an_answer_is_recorded_and_can_be_changed(db):
    _, poll, (a, b, c) = session_of(db, players=3)
    first = services.record_attendance(db, poll, a, "out")
    assert (first.out, first.active, first.rescheduled) == (1, 3, None)
    again = services.record_attendance(db, poll, a, "in")
    assert (again.out, again.rescheduled) == (0, None)
    assert db.scalars(select(Attendance)).all()[0].answer == "in"
    assert len(db.scalars(select(Attendance)).all()) == 1


def test_exactly_half_cannot_is_not_enough(db):
    _, poll, (a, b, c, d) = session_of(db, players=4)
    services.record_attendance(db, poll, a, "out")
    result = services.record_attendance(db, poll, b, "out")             # 2 of 4
    assert result.rescheduled is None and all_polls(db)[0].status == "confirmed"


def test_more_than_half_calls_the_session_off_and_opens_a_new_poll(db):
    campaign, poll, (a, b, c) = session_of(db, players=3)
    services.record_attendance(db, poll, a, "out")
    result = services.record_attendance(db, poll, b, "out")             # 2 of 3
    new = result.rescheduled
    assert new is not None and new.status == "collecting" and new.rescheduled_from == poll.id
    old = all_polls(db)[0]
    assert old.status == "cancelled" and old.recurrence_handled
    assert db.scalars(select(Reminder).where(Reminder.poll_id == poll.id, Reminder.sent_at.is_(None))).all() == []
    # the same hours, length and title, for the week starting today in the group's timezone
    assert (new.title, new.timezone, new.duration_min) == (poll.title, poll.timezone, poll.duration_min)
    assert (new.window_start, new.window_end) == (poll.window_start, poll.window_end)
    assert new.date_start == datetime.now(PT).date() and (new.date_end - new.date_start).days == 6
    assert len(kinds(db, "reschedule")) == 1


def test_people_who_never_answered_count_as_coming(db):
    _, poll, (a, b, c) = session_of(db, players=3)
    result = services.record_attendance(db, poll, a, "out")             # b and c said nothing
    assert result.rescheduled is None


def test_people_who_left_the_server_do_not_count(db):
    campaign, poll, (a, b, c) = session_of(db, players=3)
    services.record_attendance(db, poll, a, "out")
    membership = services.get_member(db, campaign.id, c.id)
    membership.left_at = datetime.now(UTC)
    db.commit()
    result = services.record_attendance(db, poll, b, "out")             # 2 of the 2 who remain
    assert result.rescheduled is not None
    out, active = services.declined_count(db, poll)
    assert (out, active) == (2, 2)


def test_a_leaver_cannot_answer(db):
    campaign, poll, (a, b) = session_of(db, players=2)
    services.get_member(db, campaign.id, b.id).left_at = datetime.now(UTC)
    db.commit()
    with pytest.raises(services.ServiceError) as err:
        services.record_attendance(db, poll, b, "out")
    assert err.value.status == 403


def test_repeated_answers_open_only_one_poll(db):
    _, poll, (a, b, c) = session_of(db, players=3)
    services.record_attendance(db, poll, a, "out")
    services.record_attendance(db, poll, b, "out")
    with pytest.raises(services.ServiceError) as err:                    # the session is already off
        services.record_attendance(db, poll, c, "out")
    assert err.value.status == 409
    assert len([p for p in all_polls(db) if p.status == "collecting"]) == 1


def test_a_session_that_has_started_takes_no_answers(db):
    campaign, owner = make_campaign(db)
    poll = decided(db, campaign, datetime.now(UTC) - timedelta(minutes=5))
    with pytest.raises(services.ServiceError) as err:
        services.record_attendance(db, poll, owner, "out")
    assert err.value.status == 409


def test_only_in_or_out_are_accepted(db):
    _, poll, (a, _) = session_of(db, players=2)
    with pytest.raises(services.ServiceError) as err:
        services.record_attendance(db, poll, a, "maybe")
    assert err.value.status == 422


def test_calling_a_session_off_does_not_line_up_an_automatic_next_one(db):
    campaign, owner = make_campaign(db)
    services.update_campaign(db, campaign, cadence="weekly")
    me = make_player(db, campaign, "9", "Solo")
    poll = decided(db, campaign, SAT_11AM)
    services.record_attendance(db, poll, owner, "out")
    result = services.record_attendance(db, poll, me, "out")
    assert result.rescheduled is not None
    assert [p.status for p in all_polls(db)] == ["cancelled", "collecting"]  # no automatic session
    assert services.roll_recurrences(db, now=SAT_11AM.astimezone(UTC) + timedelta(days=30)) == []


def test_a_poll_already_open_is_left_alone(db):
    campaign, poll, (a, b) = session_of(db, players=2)
    services.create_poll(db, campaign, title="Other", date_start=date(2030, 3, 4),
                         window_start=time(10), window_end=time(15), tz="UTC", duration_min=60)
    services.record_attendance(db, poll, a, "out")
    result = services.record_attendance(db, poll, b, "out")
    assert result.rescheduled is None and all_polls(db)[0].status == "cancelled"
    assert len([p for p in all_polls(db) if p.status == "collecting"]) == 1


# ------------------------------------------------ announcing it, and the buttons themselves


def test_the_channel_is_told_and_the_whole_group_mentioned(db):
    _, poll, (a, b, c) = session_of(db, players=3)
    services.record_attendance(db, poll, a, "out")
    new = services.record_attendance(db, poll, b, "out").rescheduled
    world = World()
    run(world.processor.run_once())
    post = world.channel.sent[-1]
    assert all(f"<@{u.discord_id}>" in post.content for u in (a, b, c))
    assert post.allowed_mentions.everyone is False and post.allowed_mentions.roles is False
    body = post.embed.description
    assert "more than half" in body.lower() and f"/poll.html?id={new.id}" in body
    assert world.guild.series == {} and world.guild.events == {}


def test_nothing_is_posted_if_the_new_poll_was_closed_before_delivery(db):
    _, poll, (a, b) = session_of(db, players=2)
    services.record_attendance(db, poll, a, "out")
    new = services.record_attendance(db, poll, b, "out").rescheduled
    services.cancel_poll(db, new)
    world = World()
    run(world.processor.run_once())
    assert [m for m in world.channel.sent if m.content] == []


def test_the_reminder_dm_carries_both_buttons_the_channel_post_does_not(db):
    _, poll, users = session_of(db, players=2)
    make_due()
    rig = Rig()
    run(rig.proc.run_once())
    assert "view" not in rig.channel.posts[0]
    dm = next(iter(rig.users.values())).sent[0]
    ids = [item.custom_id for item in dm["view"].children]
    assert ids == [f"cm:rsvp:{poll.id}:in", f"cm:rsvp:{poll.id}:out"]
    assert [item.item.label for item in dm["view"].children] == ["I'm in", "Can't make it"]


def test_the_buttons_survive_a_restart():
    import re
    assert re.fullmatch(RSVP_TEMPLATE, "cm:rsvp:12:out") and re.fullmatch(RSVP_TEMPLATE, "cm:rsvp:7:in")
    assert not re.fullmatch(RSVP_TEMPLATE, "cm:rsvp:7:maybe")
    button = RsvpButton(12, "out")
    assert button.item.custom_id == "cm:rsvp:12:out" and button.item.style == discord.ButtonStyle.danger


def test_button_replies_say_what_happened(db):
    campaign, poll, (a, b, c) = session_of(db, players=3)
    du = lambda u: DUser(u.discord_id, u.display_name)  # noqa: E731
    assert "will be there" in actions.rsvp_click(db, du(a), poll.id, "in").text
    out = actions.rsvp_click(db, du(a), poll.id, "out")
    assert out.ok and "1 of 3" in out.text and out.snapshot is None
    called_off = actions.rsvp_click(db, du(b), poll.id, "out")
    assert called_off.ok and "called off" in called_off.text and called_off.snapshot is not None
    late = actions.rsvp_click(db, du(c), poll.id, "out")
    assert not late.ok and "no longer upcoming" in late.text


def test_a_stranger_pressing_the_button_is_refused(db):
    _, poll, _ = session_of(db, players=2)
    outcome = actions.rsvp_click(db, DUser("999", "Stranger"), poll.id, "out")
    assert not outcome.ok and "not part" in outcome.text
    assert db.scalars(select(Attendance)).all() == []


def test_a_missing_session_is_handled(db):
    outcome = actions.rsvp_click(db, DUser("1", "x"), 4242, "out")
    assert not outcome.ok


# ------------------------------------------------ wording stays in step across themes


def test_the_frequency_list_matches_what_discord_can_repeat():
    from app.bot import commands
    assert [v for _, v in commands.FREQUENCIES] == ["none", "weekly", "biweekly", "monthly", "annually"]
    assert services.CADENCES == ("none", "weekly", "biweekly", "monthly", "annually")


def test_quarterly_groups_become_one_off_in_the_migration():
    from pathlib import Path
    source = (Path(__file__).resolve().parent.parent / "migrations" / "versions"
              / "0008_series_events_and_attendance.py").read_text(encoding="utf-8")
    assert "cadence = 'none' WHERE cadence = 'quarterly'" in source

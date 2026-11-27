"""The organizer can move one session without another poll and vote, called-off polls can be
deleted (by hand, and automatically once nobody needs them), and a repeating event no longer
keeps announcing a session that was called off."""
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select

from app import services
from app.bot import actions
from app.bot.actions import DUser
from app.bot.snapshots import load_poll_snapshot
from app.bot.views import moved_embed
from app.models import (
    Attendance, Availability, Candidate, DiscordCleanup, Notification, Poll, PollMessage, Reminder, Vote,
)
from app.services import ServiceError

from conftest import login, make_client
from helpers import CHANNEL, GUILD, fresh, make_campaign, make_player, mark_all_free, open_poll, voting_poll
from test_outbox import World, run
from test_recurrence import all_polls, decided, local, repeating
from test_series_and_attendance import SAT_11AM, series_of, session_of

ROOT = Path(__file__).resolve().parent.parent
UTC = timezone.utc
DM = DUser("1", "Dungeon Master", can_manage=True)
ARIA = DUser("2", "Aria")
LONG_BEFORE = datetime(2030, 1, 1, tzinfo=UTC)          # 'now' for sessions in March 2030


def kinds(db):
    return sorted(n.kind for n in db.scalars(select(Notification).where(Notification.processed_at.is_(None))))


# ------------------------------------------------ moving a session


def test_a_moved_session_has_the_new_time_and_remembers_the_old_one(db):
    campaign, poll, _ = session_of(db, players=3)
    new = SAT_11AM + timedelta(days=1, hours=2)
    services.move_session(db, poll, new, now=LONG_BEFORE)
    assert poll.confirmed_start_utc == new.astimezone(UTC) and poll.status == "confirmed"
    assert poll.moved_from_utc == SAT_11AM.astimezone(UTC)
    assert poll.series_start_utc == SAT_11AM.astimezone(UTC)
    assert "moved" in kinds(db) and "event_sync" in kinds(db)


def test_moving_twice_keeps_the_original_series_time_and_the_latest_old_time(db):
    _, poll, _ = session_of(db, players=2)
    first, second = SAT_11AM + timedelta(days=1), SAT_11AM + timedelta(days=3)
    services.move_session(db, poll, first, now=LONG_BEFORE)
    services.move_session(db, poll, second, now=LONG_BEFORE)
    assert poll.moved_from_utc == first.astimezone(UTC)
    assert poll.series_start_utc == SAT_11AM.astimezone(UTC)


def test_answers_for_the_old_time_are_cleared(db):
    _, poll, (dm, a, b) = session_of(db, players=3)
    db.add(Attendance(poll_id=poll.id, user_id=a.id, answer="out"))
    db.commit()
    services.move_session(db, poll, SAT_11AM + timedelta(days=1), now=LONG_BEFORE)
    assert db.scalars(select(Attendance).where(Attendance.poll_id == poll.id)).all() == []
    assert services.declined_names(db, poll) == []


def test_every_reminder_is_planned_again_for_the_new_time_even_one_already_sent(db):
    _, poll, _ = session_of(db, players=2)               # reminders 1 day and 1 hour before
    sent = db.scalars(select(Reminder).where(Reminder.poll_id == poll.id).order_by(Reminder.send_at)).all()[0]
    sent.sent_at = LONG_BEFORE                           # the 1-day reminder went out for the old time
    db.commit()
    new = SAT_11AM + timedelta(days=2)
    services.move_session(db, poll, new, now=LONG_BEFORE)
    rows = db.scalars(select(Reminder).where(Reminder.poll_id == poll.id).order_by(Reminder.send_at)).all()
    assert all(r.sent_at is None for r in rows)
    assert [r.send_at for r in rows] == [(new - timedelta(days=1)).astimezone(UTC),
                                         (new - timedelta(hours=1)).astimezone(UTC)]


def test_a_one_off_groups_event_is_replaced_not_left_at_the_old_time(db):
    campaign, poll, _ = session_of(db, players=2)
    poll.discord_event_id = "5555"
    db.commit()
    services.move_session(db, poll, SAT_11AM + timedelta(days=1), now=LONG_BEFORE)
    assert poll.discord_event_id is None
    cleanup = db.scalars(select(DiscordCleanup)).all()
    assert [(c.kind, c.target_id, c.guild_id) for c in cleanup] == [("event", "5555", GUILD)]


@pytest.mark.parametrize("when,message", [
    (LONG_BEFORE - timedelta(days=1), "future"),
    (SAT_11AM, "already at that time"),
    (LONG_BEFORE + timedelta(days=400), "within a year"),
])
def test_a_bad_new_time_is_refused_and_changes_nothing(db, when, message):
    _, poll, _ = session_of(db, players=2)
    with pytest.raises(ServiceError) as exc:
        services.move_session(db, poll, when, now=LONG_BEFORE)
    assert exc.value.status == 422 and message in exc.value.detail
    assert poll.confirmed_start_utc == SAT_11AM.astimezone(UTC) and poll.moved_from_utc is None


def test_only_a_decided_session_that_has_not_started_can_move(db):
    campaign, owner = make_campaign(db, guild="7000", channel="7001")
    waiting = open_poll(db, campaign)
    with pytest.raises(ServiceError) as exc:
        services.move_session(db, waiting, SAT_11AM, now=LONG_BEFORE)
    assert exc.value.status == 409
    _, started, _ = session_of(db, players=2)
    with pytest.raises(ServiceError) as exc:
        services.move_session(db, started, SAT_11AM + timedelta(days=9), now=SAT_11AM + timedelta(hours=1))
    assert exc.value.status == 409
    with pytest.raises(ServiceError) as exc:
        services.move_session(db, started, datetime(2030, 4, 1, 12), now=LONG_BEFORE)   # no timezone
    assert exc.value.status == 422


def test_moving_one_session_does_not_drag_the_series_with_it(db):
    campaign, _ = repeating(db, "weekly")
    poll = decided(db, campaign, SAT_11AM)                                # Saturday 2 March 2030, 11:00
    sunday = SAT_11AM + timedelta(days=1, hours=3)                        # moved to Sunday 14:00
    services.move_session(db, poll, sunday, now=LONG_BEFORE)
    start, day = services.next_occurrence(poll, "weekly", now=LONG_BEFORE)
    assert (day, start.astimezone(SAT_11AM.tzinfo).hour) == (date(2030, 3, 9), 11)   # the next Saturday, 11:00


def test_a_session_moved_past_its_next_slot_skips_ahead(db):
    campaign, _ = repeating(db, "weekly")
    poll = decided(db, campaign, SAT_11AM)
    later = SAT_11AM + timedelta(days=10)                                 # after the next Saturday has gone by
    services.move_session(db, poll, later, now=LONG_BEFORE)
    _, day = services.next_occurrence(poll, "weekly", now=later + timedelta(hours=4))
    assert day == date(2030, 3, 16)


# ------------------------------------------------ telling the group


def test_the_channel_post_names_both_times_and_mentions_the_group(db):
    campaign, poll, (dm, a, b) = session_of(db, players=3)
    services.move_session(db, poll, SAT_11AM + timedelta(days=1), now=LONG_BEFORE)
    embed = moved_embed(load_poll_snapshot(db, poll.id))
    assert "Saturday game" in embed.description and embed.title == "The Hour Is Changed"
    world = World()
    run(world.processor.run_once())
    posts = [m for m in world.channel.sent if m.embed is not None and m.embed.title == "The Hour Is Changed"]
    assert len(posts) == 1 and posts[0].content.count("<@") == 3


def test_a_session_called_off_after_being_moved_only_posts_the_cancellation(db):
    campaign, poll, _ = session_of(db, players=2)
    services.move_session(db, poll, SAT_11AM + timedelta(days=1), now=LONG_BEFORE)
    services.cancel_poll(db, poll)
    world = World()
    run(world.processor.run_once())
    titles = [m.embed.title for m in world.channel.sent if m.embed is not None]
    assert "The Hour Is Changed" not in titles and "The Session Is Called Off" in titles


def test_the_repeating_event_follows_a_moved_session(db):
    campaign, _ = repeating(db, "weekly")
    poll = decided(db, campaign, SAT_11AM)
    services.enqueue(db, "event_sync", poll.id)
    db.commit()
    world = World()
    run(world.processor.run_once())
    services.move_session(db, poll, SAT_11AM + timedelta(days=1, hours=3), now=LONG_BEFORE)
    run(world.processor.run_once())
    ((_, event),) = series_of(world)
    assert event["scheduled_start_time"] == "2030-03-03T22:00:00Z"


# ------------------------------------------------ the Discord command


def soon_session(db, players=2):
    """A decided session three weeks from the real clock (the command uses real time), 11:00 Pacific."""
    campaign, owner = make_campaign(db)
    users = [owner] + [make_player(db, campaign, str(10 + i), f"P{i}") for i in range(players - 1)]
    day = (datetime.now(SAT_11AM.tzinfo) + timedelta(days=21)).date()
    poll = decided(db, campaign, datetime.combine(day, time(11), tzinfo=SAT_11AM.tzinfo))
    services.schedule_reminders(db, poll.id, poll.confirmed_start_utc, [1440, 60])
    db.commit()
    return campaign, poll, users, day


def test_move_changes_only_the_time_or_only_the_day(db):
    campaign, poll, _, day = soon_session(db)
    reply = actions.cmd_move(db, DM, GUILD, CHANNEL, None, "20:00")
    assert "Moved to" in reply.text
    local_time = poll.confirmed_start_utc.astimezone(SAT_11AM.tzinfo)
    assert (local_time.date(), local_time.hour) == (day, 20)
    new_day = day + timedelta(days=3)
    actions.cmd_move(db, DM, GUILD, CHANNEL, new_day.isoformat(), None)
    local_time = poll.confirmed_start_utc.astimezone(SAT_11AM.tzinfo)
    assert (local_time.date(), local_time.hour) == (new_day, 20)


def test_move_needs_a_day_or_a_time_and_an_organizer_and_a_session(db):
    campaign, poll, (dm, aria), _ = soon_session(db)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_move(db, DM, GUILD, CHANNEL, None, None)
    assert exc.value.status == 422 and "Say when" in exc.value.detail
    with pytest.raises(ServiceError) as exc:
        actions.cmd_move(db, DM, GUILD, CHANNEL, "soon", None)
    assert exc.value.status == 422 and "Day must look like" in exc.value.detail
    with pytest.raises(ServiceError) as exc:
        actions.cmd_move(db, DM, GUILD, CHANNEL, None, "8pm")
    assert exc.value.status == 422
    services.ensure_member(db, campaign.id, services.upsert_user(db, "2", "Aria").id)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_move(db, ARIA, GUILD, CHANNEL, None, "20:00")
    assert exc.value.status == 403
    services.cancel_poll(db, poll)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_move(db, DM, GUILD, CHANNEL, None, "20:00")
    assert exc.value.status == 409 and "no upcoming session" in exc.value.detail


# ------------------------------------------------ the web API


def api_session(client, days_ahead=20):
    login(client, "1", "Dana")
    campaign = client.post("/api/campaigns", json={"name": "x"}).json()
    with fresh() as db:
        poll = decided(db, db.get(services.Campaign, campaign["id"]),
                       datetime.now(UTC).replace(microsecond=0) + timedelta(days=days_ahead), duration=60)
        return campaign, poll.id, poll.confirmed_start_utc


def test_the_api_moves_a_session_for_the_organizer_only(client):
    campaign, pid, start = api_session(client)
    aria = make_client()
    login(aria, "2", "Aria")
    aria.post("/api/join", json={"invite_code": campaign["invite_code"]})
    new = (start + timedelta(days=1)).isoformat().replace("+00:00", "Z")
    assert aria.post(f"/api/polls/{pid}/move", json={"start": new}).status_code == 403
    r = client.post(f"/api/polls/{pid}/move", json={"start": new})
    assert r.status_code == 200 and r.json()["confirmed_start"].startswith(new[:19])
    assert client.post(f"/api/polls/{pid}/move", json={"start": "2020-01-01T00:00:00Z"}).status_code == 422
    assert client.post(f"/api/polls/{pid}/move", json={"start": "not a time"}).status_code == 422


# ------------------------------------------------ deleting called-off polls


def called_off_poll(db):
    campaign, poll, users = voting_poll(db)
    services.cancel_poll(db, poll)
    return campaign, poll, users


def count(db, model, **where):
    return len(db.scalars(select(model).filter_by(**where)).all())


def test_deleting_a_called_off_poll_removes_it_and_everything_attached(db):
    campaign, poll, users = called_off_poll(db)
    db.add(PollMessage(poll_id=poll.id, channel_id="1", message_id="2"))
    db.add(Reminder(poll_id=poll.id, offset_min=60, send_at=LONG_BEFORE))
    db.add(Attendance(poll_id=poll.id, user_id=users[0].id, answer="in"))
    db.commit()
    pid = poll.id
    services.delete_poll(db, poll)
    for model in (Availability, Candidate, Vote, Reminder, Attendance, PollMessage, Notification):
        assert count(db, model, poll_id=pid) == 0, model
    assert db.get(Poll, pid) is None


def test_only_called_off_polls_can_be_deleted(db):
    campaign, poll, _ = voting_poll(db)
    with pytest.raises(ServiceError) as exc:
        services.delete_poll(db, poll)
    assert exc.value.status == 409 and db.get(Poll, poll.id) is not None
    services.confirm_poll(db, poll)
    with pytest.raises(ServiceError):
        services.delete_poll(db, poll)                              # a held or upcoming session is history


def test_deleting_leaves_other_polls_and_forgets_the_replacement_link(db):
    campaign, first, users = called_off_poll(db)
    later = open_poll(db, campaign, date_start=date(2031, 1, 1))
    later.rescheduled_from = first.id
    db.commit()
    services.delete_poll(db, first)
    db.refresh(later)
    assert later.rescheduled_from is None and later.status == "collecting"


def test_a_deleted_polls_discord_event_and_live_buttons_are_queued_for_removal(db):
    campaign, poll, _ = called_off_poll(db)
    poll.discord_event_id = "777"
    db.add(PollMessage(poll_id=poll.id, channel_id="11", message_id="22"))
    db.add(Notification(poll_id=poll.id, kind="cancelled"))             # the buttons are still waiting to be retired
    db.commit()
    services.delete_poll(db, poll)
    rows = sorted((c.kind, c.target_id) for c in db.scalars(select(DiscordCleanup)))
    assert rows == [("event", "777"), ("message", "22")]


def test_clearing_deletes_every_called_off_poll_of_that_group_only(db):
    campaign, one, users = called_off_poll(db)
    two = open_poll(db, campaign, date_start=date(2031, 1, 1))
    services.cancel_poll(db, two)
    open_one = open_poll(db, campaign, date_start=date(2031, 2, 1))
    other, owner = make_campaign(db, guild="7000", channel="7001")
    elsewhere = open_poll(db, other)
    services.cancel_poll(db, elsewhere)
    assert services.clear_called_off(db, campaign) == 2
    assert db.get(Poll, one.id) is None and db.get(Poll, two.id) is None
    assert db.get(Poll, open_one.id) is not None and db.get(Poll, elsewhere.id) is not None


def test_the_api_clears_called_off_polls_for_the_organizer_only(client):
    login(client, "1", "Dana")
    campaign = client.post("/api/campaigns", json={"name": "x"}).json()
    body = {"timezone": "UTC", "date_start": "2031-03-03", "window_start": "12:00:00",
            "window_end": "18:00:00", "duration_min": 60}
    for _ in range(2):
        poll = client.post(f"/api/campaigns/{campaign['id']}/polls", json=body).json()
        client.post(f"/api/polls/{poll['id']}/cancel")
    assert client.get(f"/api/campaigns/{campaign['id']}").json()["polls_called_off"] == 2
    aria = make_client()
    login(aria, "2", "Aria")
    aria.post("/api/join", json={"invite_code": campaign["invite_code"]})
    assert aria.delete(f"/api/campaigns/{campaign['id']}/called-off").status_code == 403
    assert client.delete(f"/api/campaigns/{campaign['id']}/called-off").json() == {"removed": 2}
    assert client.get(f"/api/campaigns/{campaign['id']}").json()["polls_called_off"] == 0


# ------------------------------------------------ deleting them automatically


LONG_AFTER = datetime(2032, 1, 1, tzinfo=UTC)


def test_old_called_off_polls_nobody_needs_are_purged(db):
    campaign, poll, users = called_off_poll(db)
    db.execute(Availability.__table__.delete().where(Availability.poll_id == poll.id))
    db.query(Notification).update({"processed_at": LONG_BEFORE})
    db.commit()
    assert services.purge_called_off(db, now=LONG_AFTER) == 1
    assert db.get(Poll, poll.id) is None


def test_a_called_off_poll_that_still_holds_someones_answers_is_kept(db):
    """Those answers are the person's latest, and they pre-fill their next poll."""
    campaign, poll, users = called_off_poll(db)
    db.query(Notification).update({"processed_at": LONG_BEFORE})
    db.commit()
    assert services.purge_called_off(db, now=LONG_AFTER) == 0 and db.get(Poll, poll.id) is not None


def test_a_recent_poll_or_one_with_something_waiting_is_kept(db):
    campaign, poll, users = called_off_poll(db)
    db.execute(Availability.__table__.delete().where(Availability.poll_id == poll.id))
    db.commit()                                                          # a 'cancelled' notification is still pending
    assert services.purge_called_off(db, now=LONG_AFTER) == 0
    db.query(Notification).update({"processed_at": LONG_BEFORE})
    db.commit()
    soon = poll.date_end + timedelta(days=10)
    assert services.purge_called_off(db, now=datetime.combine(soon, time(0), tzinfo=UTC)) == 0
    assert services.purge_called_off(db, now=LONG_AFTER) == 1


def test_a_poll_holding_a_discord_event_is_never_purged(db):
    campaign, poll, users = called_off_poll(db)
    db.execute(Availability.__table__.delete().where(Availability.poll_id == poll.id))
    db.query(Notification).update({"processed_at": LONG_BEFORE})
    poll.discord_event_id = "9"
    db.commit()
    assert services.purge_called_off(db, now=LONG_AFTER) == 0


def test_held_sessions_are_never_purged(db):
    campaign, poll, users = voting_poll(db)
    services.confirm_poll(db, poll)
    db.execute(Availability.__table__.delete().where(Availability.poll_id == poll.id))
    db.commit()
    assert services.purge_called_off(db, now=LONG_AFTER) == 0 and db.get(Poll, poll.id) is not None


def test_the_background_sweep_includes_the_purge(db, monkeypatch):
    from app import background
    campaign, poll, users = called_off_poll(db)
    db.execute(Availability.__table__.delete().where(Availability.poll_id == poll.id))
    db.query(Notification).update({"processed_at": LONG_BEFORE})
    db.commit()
    pid = poll.id
    monkeypatch.setattr(services, "now_utc", lambda: LONG_AFTER)
    assert background._compact() >= 1
    db.expire_all()
    assert db.get(Poll, pid) is None


# ------------------------------------------------ a repeating event that would announce a called-off session


def test_the_repeating_event_goes_when_the_only_session_is_called_off(db):
    campaign, _ = repeating(db, "weekly")
    only = decided(db, campaign, SAT_11AM)
    services.enqueue(db, "event_sync", only.id)
    db.commit()
    world = World()
    run(world.processor.run_once())
    assert len(series_of(world)) == 1
    only.recurrence_handled = True
    only.status = "cancelled"                   # called off with nothing after it (for example after declines)
    services.enqueue(db, "event_sync", only.id)
    db.commit()
    run(world.processor.run_once())
    assert series_of(world) == []
    with fresh() as other:
        assert other.get(services.Campaign, campaign.id).series_event_id is None


def test_the_repeating_event_comes_back_when_a_new_session_is_decided(db):
    campaign, _ = repeating(db, "weekly")
    only = decided(db, campaign, SAT_11AM)
    services.enqueue(db, "event_sync", only.id)
    db.commit()
    world = World()
    run(world.processor.run_once())
    only.recurrence_handled = True
    only.status = "cancelled"
    services.enqueue(db, "event_sync", only.id)
    db.commit()
    run(world.processor.run_once())
    assert series_of(world) == []
    replacement = decided(db, campaign, SAT_11AM + timedelta(days=9))
    services.enqueue(db, "event_sync", replacement.id)
    db.commit()
    run(world.processor.run_once())
    assert len(series_of(world)) == 1


# ------------------------------------------------ the pages


def test_the_pages_have_the_move_form_and_the_delete_button():
    poll = (ROOT / "web" / "poll.html").read_text(encoding="utf-8")
    for needle in ('id="move-form"', 'type="datetime-local"', "/move`", "toISOString()"):
        assert needle in poll, needle
    campaign = (ROOT / "web" / "campaign.html").read_text(encoding="utf-8")
    for needle in ('id="clear-called-off"', "/called-off`", "Api.del"):
        assert needle in campaign, needle


def test_both_themes_word_the_move_announcement():
    from app.bot import wording
    for theme in wording.available_themes():
        words = wording.words(theme)
        assert "{old}" in words["botMovedBody"] and "{new}" in words["botMovedBody"]
        assert "{when}" in words["botMovedReply"] and words["botMovedTitle"]

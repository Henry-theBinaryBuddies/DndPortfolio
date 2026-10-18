"""People should know who is not coming: the /schedule answer and the reminders in the channel
name everyone who said 'Can't make it'. The session still goes ahead unless more than half decline."""
from datetime import datetime, timezone

from app import services
from app.bot import actions
from app.bot.actions import DUser
from app.bot.snapshots import load_poll_snapshot
from app.bot.views import reminder_dm_embed, reminder_embed

from helpers import CHANNEL, GUILD
from test_series_and_attendance import session_of

DM = DUser("1", "Dungeon Master", can_manage=True)
UTC = timezone.utc


def test_the_names_come_in_joining_order_and_only_for_active_members(db):
    campaign, poll, (dm, a, b, c) = session_of(db, players=4)
    services.record_attendance(db, poll, c, "out")
    services.record_attendance(db, poll, a, "out")
    assert services.declined_names(db, poll) == ["P0", "P2"]
    services.record_attendance(db, poll, c, "in")                       # changed their mind
    assert services.declined_names(db, poll) == ["P0"]
    services.get_member(db, campaign.id, a.id).left_at = datetime.now(UTC)
    db.commit()
    assert services.declined_names(db, poll) == []                      # someone who left is not listed


def test_schedule_names_who_cannot_make_it(db):
    _, poll, (dm, a, b) = session_of(db, players=3)
    assert "Cannot attend" not in actions.cmd_schedule(db, DM, GUILD, CHANNEL).text
    services.record_attendance(db, poll, a, "out")
    text = actions.cmd_schedule(db, DM, GUILD, CHANNEL).text
    assert "Cannot attend (1 of 3): P0" in text


def test_the_channel_reminder_names_them_and_says_how_many(db):
    _, poll, (dm, a, b) = session_of(db, players=3)
    services.record_attendance(db, poll, a, "out")
    embed = reminder_embed(load_poll_snapshot(db, poll.id))
    field = embed.fields[0]
    assert field.name == "Cannot attend (1 of 3)" and field.value == "P0"
    assert reminder_dm_embed(load_poll_snapshot(db, poll.id)).fields[0].name == "Cannot attend (1 of 3)"


def test_nothing_is_added_when_everyone_is_coming(db):
    _, poll, _ = session_of(db, players=3)
    assert reminder_embed(load_poll_snapshot(db, poll.id)).fields == []


def test_one_decline_in_five_keeps_the_session_and_opens_no_poll(db):
    _, poll, (dm, a, *rest) = session_of(db, players=5)
    result = services.record_attendance(db, poll, a, "out")
    assert result.rescheduled is None and poll.status == "confirmed"
    assert services.declined_names(db, poll) == ["P0"]


def test_names_cannot_inject_mentions_or_links(db):
    campaign, poll, (dm, a, b) = session_of(db, players=3)
    a.display_name = "@everyone [x](http://evil.test)"
    db.commit()
    services.record_attendance(db, poll, a, "out")
    shown = reminder_embed(load_poll_snapshot(db, poll.id)).fields[0].value
    bracket = chr(92) + "[x]"                      # the link bracket arrives escaped, so it is plain text
    broken_mention = "@" + chr(0x200B) + "everyone"
    assert broken_mention in shown and bracket in shown
    schedule = actions.cmd_schedule(db, DM, GUILD, CHANNEL).text
    assert broken_mention in schedule and bracket in schedule


def test_a_long_list_is_cut_short(db):
    _, poll, users = session_of(db, players=20)
    from app.models import Attendance
    for user in users[1:17]:
        db.add(Attendance(poll_id=poll.id, user_id=user.id, answer="out"))
    db.commit()
    shown = reminder_embed(load_poll_snapshot(db, poll.id)).fields[0].value
    assert shown.endswith("and 1 more") and shown.count(",") == 14


def test_both_themes_have_the_wording():
    from app.bot import wording
    for theme in wording.available_themes():
        words = wording.words(theme)
        assert "{n}" in words["botDeclinedTitle"] and "{names}" in words["botDeclinedLine"]

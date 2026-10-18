"""Builders shared by the service, bot and outbox tests."""
from datetime import date, time

from app import db as dbmod, services
from app.models import Availability

GUILD, CHANNEL = "5000", "6000"


def fresh():
    """A new session: sees what other sessions/threads committed."""
    return dbmod.SessionLocal()


def make_campaign(db, *, guild=GUILD, channel=CHANNEL, theme="dnd", organizer_id="1"):
    owner = services.upsert_user(db, organizer_id, "Dungeon Master")
    campaign, _ = services.create_campaign(
        db, owner, name="Curse of Strahd", guild_id=guild, channel_id=channel,
        theme=theme,
    )
    return campaign, owner


def make_player(db, campaign, discord_id, name):
    user = services.upsert_user(db, discord_id, name)
    services.ensure_member(db, campaign.id, user.id)
    return user


def open_poll(db, campaign, **overrides):
    args = dict(title="Session 5", tz="UTC", date_start=date(2026, 12, 1),
                window_start=time(18), window_end=time(22),
                duration_min=120)
    args.update(overrides)
    return services.create_poll(db, campaign, **args)


def mark_all_free(db, poll, user, level="free"):
    for slot in services.poll_slots(poll):
        db.add(Availability(poll_id=poll.id, user_id=user.id, slot_start_utc=slot, level=level))
    db.commit()


def voting_poll(db, *, guild=GUILD, channel=CHANNEL, theme="dnd", vote_hours=None):
    """A campaign with an organizer and two players, availability marked, poll in voting."""
    campaign, owner = make_campaign(db, guild=guild, channel=channel, theme=theme)
    aria = make_player(db, campaign, "2", "Aria")
    borin = make_player(db, campaign, "3", "Borin")
    poll = open_poll(db, campaign)
    for user in (owner, aria, borin):
        mark_all_free(db, poll, user)
    services.close_poll(db, poll, vote_hours=vote_hours)
    return campaign, poll, (owner, aria, borin)

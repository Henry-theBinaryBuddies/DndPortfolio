from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy import select

from app import services
from app.models import Candidate, Notification, Poll, Vote
from app.services import ServiceError

from helpers import (
    fresh, make_campaign, make_player, mark_all_free, open_poll, voting_poll,
)

NOW = lambda: datetime.now(timezone.utc)  # noqa: E731


def notifications(db, kind=None):
    q = select(Notification)
    if kind:
        q = q.where(Notification.kind == kind)
    return db.scalars(q).all()


def test_upsert_user_is_idempotent_and_updates_name(db):
    a = services.upsert_user(db, "9", "Old Name")
    b = services.upsert_user(db, "9", "New Name", avatar_url="https://x/y.png", tz="Europe/Paris")
    assert a.id == b.id
    assert (b.display_name, b.avatar_url, b.timezone) == ("New Name", "https://x/y.png", "Europe/Paris")


def test_upsert_truncates_absurd_display_names(db):
    assert len(services.upsert_user(db, "9", "x" * 500).display_name) == 100


def test_ensure_member_does_not_duplicate_or_demote(db):
    campaign, owner = make_campaign(db)
    first = services.ensure_member(db, campaign.id, owner.id)
    assert first.role == "organizer"
    player = services.upsert_user(db, "2", "Aria")
    a = services.ensure_member(db, campaign.id, player.id)
    b = services.ensure_member(db, campaign.id, player.id)
    assert a.id == b.id and a.role == "player"


def test_one_campaign_per_channel(db):
    make_campaign(db)
    with pytest.raises(ServiceError) as exc:
        make_campaign(db, organizer_id="2")
    assert exc.value.status == 409


def test_campaigns_without_a_channel_do_not_collide(db):
    owner = services.upsert_user(db, "1", "DM")
    services.create_campaign(db, owner, name="A")
    services.create_campaign(db, owner, name="B")  # both web-only: fine


def test_same_channel_id_in_different_guilds_is_allowed(db):
    make_campaign(db, guild="1", channel="9")
    make_campaign(db, guild="2", channel="9", organizer_id="2")


def test_link_requires_organizer_and_free_channel(db):
    owner = services.upsert_user(db, "1", "DM")
    web, _ = services.create_campaign(db, owner, name="Web campaign")
    stranger = services.upsert_user(db, "2", "Stranger")
    with pytest.raises(ServiceError) as exc:
        services.link_campaign(db, stranger, web.invite_code, "5", "6")
    assert exc.value.status == 404
    with pytest.raises(ServiceError):
        services.link_campaign(db, owner, "no-such-code", "5", "6")
    linked = services.link_campaign(db, owner, web.invite_code, "5", "6")
    assert (linked.guild_id, linked.channel_id) == ("5", "6")
    other, _ = services.create_campaign(db, owner, name="Second")
    with pytest.raises(ServiceError) as exc:
        services.link_campaign(db, owner, other.invite_code, "5", "6")
    assert exc.value.status == 409


def test_player_cannot_link_a_campaign_they_do_not_organize(db):
    owner = services.upsert_user(db, "1", "DM")
    web, _ = services.create_campaign(db, owner, name="Web")
    player = services.upsert_user(db, "2", "Aria")
    services.ensure_member(db, web.id, player.id)
    with pytest.raises(ServiceError) as exc:
        services.link_campaign(db, player, web.invite_code, "5", "6")
    assert exc.value.status == 404


def test_create_poll_validations(db):
    campaign, _ = make_campaign(db)
    with pytest.raises(ServiceError):
        open_poll(db, campaign, date_start=date(2026, 12, 5), date_end=date(2026, 12, 1))
    with pytest.raises(ServiceError):
        open_poll(db, campaign, date_end=date(2027, 6, 1))
    with pytest.raises(ServiceError):
        open_poll(db, campaign, window_start=time(22), window_end=time(18))
    with pytest.raises(ServiceError):
        open_poll(db, campaign, duration_min=600)
    with pytest.raises(ServiceError):
        open_poll(db, campaign, vote_deadline=NOW() - timedelta(hours=1))
    with pytest.raises(ServiceError):
        open_poll(db, campaign, vote_deadline=datetime(2099, 1, 1))  # naive


def test_close_queues_one_vote_open_notification(db):
    campaign, poll, _ = voting_poll(db)
    assert poll.status == "voting"
    assert [n.kind for n in notifications(db)] == ["vote_open"]
    assert 1 <= len(poll.candidates) <= poll.vote_top_n


def test_close_twice_is_refused(db):
    _, poll, _ = voting_poll(db)
    with pytest.raises(ServiceError) as exc:
        services.close_poll(db, poll)
    assert exc.value.status == 409
    assert len(notifications(db, "vote_open")) == 1


def test_failed_close_changes_nothing(db):
    campaign, _ = make_campaign(db)
    poll = open_poll(db, campaign)  # nobody marked availability
    with pytest.raises(ServiceError) as exc:
        services.close_poll(db, poll)
    assert exc.value.status == 409 and exc.value.detail["considered"] > 0
    assert poll.status == "collecting" and not poll.candidates and not notifications(db)


def test_vote_hours_sets_deadline_and_is_bounded(db):
    campaign, owner = make_campaign(db)
    p2 = make_player(db, campaign, "2", "Aria")
    poll = open_poll(db, campaign)
    for u in (owner, p2):
        mark_all_free(db, poll, u)
    with pytest.raises(ServiceError):
        services.close_poll(db, poll, vote_hours=0)
    with pytest.raises(ServiceError):
        services.close_poll(db, poll, vote_hours=10_000)
    services.close_poll(db, poll, vote_hours=48)
    assert timedelta(hours=47) < poll.vote_deadline - NOW() <= timedelta(hours=48)


def test_stale_creation_deadline_is_cleared_when_closing(db):
    campaign, owner = make_campaign(db)
    p2 = make_player(db, campaign, "2", "Aria")
    poll = open_poll(db, campaign, vote_deadline=NOW() + timedelta(hours=1))
    for u in (owner, p2):
        mark_all_free(db, poll, u)
    poll.vote_deadline = NOW() - timedelta(minutes=5)  # time passed while collecting
    db.commit()
    services.close_poll(db, poll)
    assert poll.vote_deadline is None  # otherwise it would auto-confirm with zero votes
    assert services.auto_confirm_due(db) == []


def test_vote_replaces_previous_vote(db):
    _, poll, (_, aria, _) = voting_poll(db)
    c1, c2 = poll.candidates[0], poll.candidates[-1]
    services.cast_vote(db, poll, aria, c1.id)
    services.cast_vote(db, poll, aria, c2.id)
    votes = db.scalars(select(Vote).where(Vote.poll_id == poll.id)).all()
    assert len(votes) == 1 and votes[0].candidate_id == c2.id


def test_vote_for_a_candidate_of_another_poll_is_refused(db):
    _, poll, (_, aria, _) = voting_poll(db)
    _, other, _ = voting_poll(db, guild="7", channel="8")
    with pytest.raises(ServiceError) as exc:
        services.cast_vote(db, poll, aria, other.candidates[0].id)
    assert exc.value.status == 404


def test_vote_after_deadline_or_after_confirm_is_refused(db):
    _, poll, (_, aria, _) = voting_poll(db, vote_hours=1)
    poll.vote_deadline = NOW() - timedelta(minutes=1)
    db.commit()
    with pytest.raises(ServiceError) as exc:
        services.cast_vote(db, poll, aria, poll.candidates[0].id)
    assert exc.value.status == 409
    poll.vote_deadline = None
    services.confirm_poll(db, poll)
    with pytest.raises(ServiceError):
        services.cast_vote(db, poll, aria, poll.candidates[0].id)


def test_confirm_picks_most_voted_then_queues_notification(db):
    _, poll, (owner, aria, borin) = voting_poll(db)
    pick = poll.candidates[-1]
    for u in (aria, borin):
        services.cast_vote(db, poll, u, pick.id)
    services.cast_vote(db, poll, owner, poll.candidates[0].id)
    services.confirm_poll(db, poll)
    assert poll.status == "confirmed" and poll.confirmed_start_utc == pick.start_utc
    assert len(notifications(db, "confirmed")) == 1


def test_confirm_with_no_votes_falls_back_to_best_score_then_earliest(db):
    _, poll, _ = voting_poll(db)
    best = min(poll.candidates, key=lambda c: (-c.score, c.start_utc))
    services.confirm_poll(db, poll)
    assert poll.confirmed_start_utc == best.start_utc


def test_confirm_twice_is_refused_and_queues_once(db):
    _, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    with pytest.raises(ServiceError):
        services.confirm_poll(db, poll)
    assert len(notifications(db, "confirmed")) == 1


def test_confirm_explicit_candidate_must_belong_to_poll(db):
    _, poll, _ = voting_poll(db)
    _, other, _ = voting_poll(db, guild="7", channel="8")
    with pytest.raises(ServiceError) as exc:
        services.confirm_poll(db, poll, other.candidates[0].id)
    assert exc.value.status == 404
    services.confirm_poll(db, poll, poll.candidates[-1].id)
    assert poll.confirmed_start_utc == poll.candidates[-1].start_utc


def test_auto_confirm_only_touches_due_polls(db):
    _, due, _ = voting_poll(db, vote_hours=1)
    _, later, _ = voting_poll(db, guild="7", channel="8", vote_hours=5)
    _, manual, _ = voting_poll(db, guild="9", channel="10")  # no deadline: never automatic
    due.vote_deadline = NOW() - timedelta(minutes=1)
    db.commit()
    assert services.auto_confirm_due(db) == [due.id]
    db.expire_all()
    assert {p.id: p.status for p in db.scalars(select(Poll))} == {
        due.id: "confirmed", later.id: "voting", manual.id: "voting"}
    assert services.auto_confirm_due(db) == []  # and it does not repeat
    assert len(notifications(db, "confirmed")) == 1


def test_current_poll_prefers_open_over_recent(db):
    campaign, owner = make_campaign(db)
    assert services.current_poll(db, campaign.id) is None
    first = open_poll(db, campaign, title="one")
    first.status = "confirmed"
    db.commit()
    second = open_poll(db, campaign, title="two")
    assert services.current_poll(db, campaign.id).id == second.id
    second.status = "cancelled"
    db.commit()
    assert services.current_poll(db, campaign.id).id == second.id  # newest when none are open

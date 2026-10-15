from collections import Counter
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import services
from ..auth import current_user, require_organizer
from ..db import get_db
from ..models import Availability, Member, Poll, User, Vote
from ..ratelimit import availability_limiter
from ..schemas import AvailabilityPut, CloseRequest, ConfirmRequest, PollCreate, VoteCast
from ..services import poll_slots

router = APIRouter(prefix="/api")


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def load_poll(db: Session, poll_id: int, user: User) -> tuple:
    """Return (poll, member). 404 unless the user belongs to the poll's campaign."""
    poll = db.get(Poll, poll_id)
    member = services.get_member(db, poll.campaign_id, user.id) if poll else None
    if poll is None or member is None:
        # One answer for "no such poll" and "not yours": do not reveal which ids exist.
        raise HTTPException(404, "poll not found")
    return poll, member


def load_poll_as_organizer(db: Session, poll_id: int, user: User) -> Poll:
    poll, member = load_poll(db, poll_id, user)
    if member.role != "organizer":
        raise HTTPException(403, "organizer only")
    return poll


def poll_json(db: Session, poll: Poll, member: Member, user: User) -> dict:
    rows = db.scalars(select(Availability).where(Availability.poll_id == poll.id)).all()
    counts = {}
    for row in rows:
        counts.setdefault(iso(row.slot_start_utc), Counter())[row.level] += 1
    votes = db.scalars(select(Vote).where(Vote.poll_id == poll.id)).all()
    vote_counts = Counter(v.candidate_id for v in votes)
    my_vote = next((v.candidate_id for v in votes if v.user_id == user.id), None)
    responded = {row.user_id for row in rows}
    return {
        "id": poll.id,
        "campaign_id": poll.campaign_id,
        "title": poll.title,
        "status": poll.status,
        "timezone": poll.timezone,
        "slot_minutes": poll.slot_minutes,
        "duration_min": poll.duration_min,
        "min_quorum": poll.min_quorum,
        "vote_deadline": iso(poll.vote_deadline) if poll.vote_deadline else None,
        "confirmed_start": iso(poll.confirmed_start_utc) if poll.confirmed_start_utc else None,
        "my_role": member.role,
        "slots": [iso(s) for s in poll_slots(poll)],
        "my_availability": {
            iso(r.slot_start_utc): r.level for r in rows if r.user_id == user.id
        },
        "slot_counts": {
            s: {"free": c["free"], "maybe": c["maybe"]} for s, c in counts.items()
        },
        "members": [
            {"user_id": m.user_id, "display_name": m.user.display_name,
             "required": m.required, "responded": m.user_id in responded}
            for m in poll.campaign.members if m.left_at is None
        ],
        "candidates": [
            {"id": c.id, "start": iso(c.start_utc), "rank": c.rank, "score": c.score,
             "free_count": c.free_count, "maybe_count": c.maybe_count,
             "votes": vote_counts.get(c.id, 0)}
            for c in poll.candidates
        ],
        "my_vote": my_vote,
    }


@router.post("/campaigns/{campaign_id}/polls", status_code=201)
def create_poll(campaign_id: int, body: PollCreate, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    member = require_organizer(db, campaign_id, user)
    poll = services.create_poll(
        db, member.campaign, title=body.title, tz=body.timezone,
        date_start=body.date_start,
        window_start=body.window_start, window_end=body.window_end,
        slot_minutes=body.slot_minutes, duration_min=body.duration_min,
        min_quorum=body.min_quorum, vote_top_n=body.vote_top_n,
        vote_deadline=body.vote_deadline,
    )
    return poll_json(db, poll, member, user)


@router.get("/polls/{poll_id}")
def get_poll(poll_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    poll, member = load_poll(db, poll_id, user)
    return poll_json(db, poll, member, user)


@router.put("/polls/{poll_id}/availability")
def put_availability(poll_id: int, body: AvailabilityPut, user: User = Depends(current_user),
                     db: Session = Depends(get_db)):
    availability_limiter.check(f"avail:{user.id}")
    poll, _ = load_poll(db, poll_id, user)
    if poll.status != "collecting":
        raise HTTPException(409, "availability is closed for this poll")
    valid = set(poll_slots(poll))
    marks = {}
    for mark in body.slots:
        if mark.start.tzinfo is None:
            raise HTTPException(422, "slot times must include a timezone")
        start = mark.start.astimezone(timezone.utc)
        if start not in valid:
            raise HTTPException(422, f"{iso(start)} is not a slot of this poll")
        marks[start] = mark.level
    db.execute(delete(Availability).where(Availability.poll_id == poll.id,
                                          Availability.user_id == user.id))
    db.add_all(
        Availability(poll_id=poll.id, user_id=user.id, slot_start_utc=s, level=lv)
        for s, lv in marks.items()
    )
    db.commit()
    return {"saved": len(marks)}


@router.post("/polls/{poll_id}/close")
def close_poll(poll_id: int, body: CloseRequest | None = None,
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Organizer closes availability; the top candidates are computed and voting opens."""
    poll = load_poll_as_organizer(db, poll_id, user)
    services.close_poll(db, poll, vote_hours=body.vote_hours if body else None)
    member = services.get_member(db, poll.campaign_id, user.id)
    return poll_json(db, poll, member, user)


@router.post("/polls/{poll_id}/votes")
def cast_vote(poll_id: int, body: VoteCast, user: User = Depends(current_user),
              db: Session = Depends(get_db)):
    poll, _ = load_poll(db, poll_id, user)
    candidate = services.cast_vote(db, poll, user, body.candidate_id)
    # Keep the tallies on the Discord vote message in step with web votes.
    services.enqueue_once(db, "vote_update", poll.id)
    db.commit()
    return {"candidate_id": candidate.id}


@router.post("/polls/{poll_id}/cancel")
def cancel_poll(poll_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Organizer abandons an open poll (for example to start over with different dates)."""
    poll = load_poll_as_organizer(db, poll_id, user)
    services.cancel_poll(db, poll)
    member = services.get_member(db, poll.campaign_id, user.id)
    return poll_json(db, poll, member, user)


@router.post("/polls/{poll_id}/confirm")
def confirm_poll(poll_id: int, body: ConfirmRequest | None = None,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Organizer confirms a time. Default: most votes, then best score, then earliest."""
    poll = load_poll_as_organizer(db, poll_id, user)
    services.confirm_poll(db, poll, body.candidate_id if body else None)
    member = services.get_member(db, poll.campaign_id, user.id)
    return poll_json(db, poll, member, user)

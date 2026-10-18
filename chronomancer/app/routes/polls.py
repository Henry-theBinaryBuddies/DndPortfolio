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
from ..schemas import AvailabilityPut, CloseRequest, ConfirmRequest, PollCreate, PollHours, VoteCast
from ..scheduling import rank_candidates
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
        raise HTTPException(403, "only the group manager can do that")
    return poll


def best_so_far(poll: Poll, rows: list, members: list) -> dict | None:
    """The best time the group could be offered right now, or None while there is none."""
    availability = {}
    for row in rows:
        availability.setdefault(row.user_id, {})[row.slot_start_utc] = row.level
    result = rank_candidates(
        slots=poll_slots(poll), availability=availability, players=[m.user_id for m in members],
        required=[m.user_id for m in members if m.required], slot_minutes=poll.slot_minutes,
        duration_min=poll.duration_min, top_n=1)
    if not result.candidates:
        return None
    top = result.candidates[0]
    return {"start": iso(top.start), "free_count": top.free_count, "maybe_count": top.maybe_count}


def poll_json(db: Session, poll: Poll, member: Member, user: User) -> dict:
    slots = poll_slots(poll)
    current = set(slots)
    # Marks outside the current hours are kept in the database but not shown or counted.
    rows = [r for r in db.scalars(select(Availability).where(Availability.poll_id == poll.id))
            if r.slot_start_utc in current]
    active = [m for m in poll.campaign.members if m.left_at is None]
    active_ids = {m.user_id for m in active}
    counts = {}
    people = {}  # slot -> level -> user ids, for the other members' marks (shown on the grid)
    for row in rows:
        if row.user_id not in active_ids:
            continue  # someone who left the group no longer counts towards the group's times
        counts.setdefault(iso(row.slot_start_utc), Counter())[row.level] += 1
        if row.user_id != user.id:  # the page adds the viewer's own, live, marks itself
            people.setdefault(iso(row.slot_start_utc), {}).setdefault(row.level, []).append(row.user_id)
    votes = db.scalars(select(Vote).where(Vote.poll_id == poll.id)).all()
    vote_counts = Counter(v.candidate_id for v in votes)
    my_vote = next((v.candidate_id for v in votes if v.user_id == user.id), None)
    # Who has answered only means something while availability is being collected or voted on; once a
    # session is closed its availability may have been compacted away, so say nothing then.
    live = poll.status in ("collecting", "voting")
    responded = {row.user_id for row in rows}
    best = best_so_far(poll, rows, active) if poll.status == "collecting" else None
    my_marks = {iso(r.slot_start_utc): r.level for r in rows if r.user_id == user.id}
    draft = None
    if poll.status == "collecting" and not my_marks:
        # A draft copied from their last answers, to look over and save. It is never stored.
        found = services.suggest_availability(db, poll, user)
        if found:
            draft = {"marks": {iso(s): level for s, level in found["marks"].items()},
                     "from_title": found["from_title"], "from_start": found["from_start"].isoformat(),
                     "outside": found["outside"]}
    return {
        "id": poll.id,
        "campaign_id": poll.campaign_id,
        "title": poll.title,
        "status": poll.status,
        "timezone": poll.timezone,
        "window_start": f"{poll.window_start:%H:%M}",
        "window_end": f"{poll.window_end:%H:%M}",  # 00:00 = end of the day
        "slot_minutes": poll.slot_minutes,
        "duration_min": poll.duration_min,
        "vote_deadline": iso(poll.vote_deadline) if poll.vote_deadline else None,
        "confirmed_start": iso(poll.confirmed_start_utc) if poll.confirmed_start_utc else None,
        "my_role": member.role,
        "slots": [iso(s) for s in slots],
        "my_availability": my_marks,
        "suggestion": draft,
        "slot_counts": {
            s: {"free": c["free"], "maybe": c["maybe"]} for s, c in counts.items()
        },
        "slot_people": people if live else {},
        "party_size": len(active),
        "my_user_id": user.id,
        "best_so_far": best,
        "members": [
            {"user_id": m.user_id, "display_name": m.user.display_name,
             "required": m.required, "responded": (m.user_id in responded) if live else None}
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
        db, member.campaign, title=body.title, tz=body.timezone or user.timezone,
        date_start=body.date_start,
        window_start=body.window_start, window_end=body.window_end,
        slot_minutes=body.slot_minutes, duration_min=body.duration_min,
        vote_top_n=body.vote_top_n,
        vote_deadline=body.vote_deadline,
    )
    return poll_json(db, poll, member, user)


@router.patch("/polls/{poll_id}")
def change_hours(poll_id: int, body: PollHours, user: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    poll = load_poll_as_organizer(db, poll_id, user)
    services.update_poll_hours(db, poll, body.window_start, body.window_end)
    return poll_json(db, poll, services.get_member(db, poll.campaign_id, user.id), user)


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
                                          Availability.user_id == user.id,
                                          Availability.slot_start_utc.in_(valid)))
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

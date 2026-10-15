from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import services
from ..auth import current_user, require_member, require_organizer
from ..db import get_db
from ..models import Campaign, Member, User
from ..schemas import CampaignCreate, CampaignUpdate, JoinRequest

router = APIRouter(prefix="/api")


def _themes() -> list:
    from ..bot.wording import available_themes

    return available_themes()


def campaign_json(db: Session, campaign: Campaign, member: Member) -> dict:
    history = services.recent_sessions(campaign)
    data = {
        "id": campaign.id,
        "name": campaign.name,
        "cadence": campaign.cadence,
        "events_enabled": campaign.events_enabled,
        "default_duration_min": campaign.default_duration_min,
        "min_quorum": campaign.min_quorum,
        "vote_top_n": campaign.vote_top_n,
        "reminder_offsets_min": campaign.reminder_offsets_min,
        "theme": campaign.theme,
        "discord_linked": bool(campaign.guild_id and campaign.channel_id),
        "my_role": member.role,
        "members": [
            {
                "user_id": m.user_id,
                "display_name": m.user.display_name,
                "role": m.role,
                "required": m.required,
            }
            for m in campaign.members if m.left_at is None
        ],
        "polls": [
            {"id": p.id, "title": p.title, "status": p.status, "phase": phase,
             "date_start": p.date_start.isoformat(), "date_end": p.date_end.isoformat(),
             "confirmed_start": p.confirmed_start_utc.isoformat().replace("+00:00", "Z")
             if p.confirmed_start_utc else None, "auto": p.recurred_from is not None}
            for p, phase in history["sessions"]
        ],
        "polls_hidden": history["hidden"],        # older held sessions that are kept but not listed
        "polls_called_off": history["called_off"],  # cancelled polls, counted instead of listed
    }
    if member.role == "organizer":
        data["invite_code"] = campaign.invite_code
    return data


@router.post("/campaigns", status_code=201)
def create_campaign(body: CampaignCreate, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    campaign, member = services.create_campaign(db, user, **body.model_dump())
    return campaign_json(db, campaign, member)


@router.get("/campaigns")
def list_campaigns(user: User = Depends(current_user), db: Session = Depends(get_db)):
    members = db.scalars(select(Member).where(Member.user_id == user.id, Member.left_at.is_(None))).all()
    return [
        {"id": m.campaign.id, "name": m.campaign.name, "my_role": m.role,
         "theme": m.campaign.theme}
        for m in members
    ]


@router.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: int, user: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    member = require_member(db, campaign_id, user)
    return campaign_json(db, member.campaign, member)


@router.patch("/campaigns/{campaign_id}")
def update_campaign(campaign_id: int, body: CampaignUpdate, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    """Change any of the campaign's settings (organizer only). One endpoint, not one per field."""
    member = require_organizer(db, campaign_id, user)
    services.update_campaign(db, member.campaign, available_themes=_themes(),
                             **body.model_dump(exclude_none=True))
    return campaign_json(db, member.campaign, member)


@router.post("/join")
def join_campaign(body: JoinRequest, user: User = Depends(current_user),
                  db: Session = Depends(get_db)):
    campaign = db.scalar(select(Campaign).where(Campaign.invite_code == body.invite_code))
    if campaign is None:
        raise HTTPException(404, "invalid invite code")
    if campaign.guild_id and campaign.channel_id:
        # A group that lives in Discord admits people through Discord (/schedule in its
        # channel), which is what proves they are in the server. An invite code cannot.
        raise HTTPException(409, "This group lives in Discord. Run /schedule in its channel to join.")
    services.ensure_member(db, campaign.id, user.id)
    return {"campaign_id": campaign.id}


@router.put("/campaigns/{campaign_id}/members/{user_id}/required")
def set_required(campaign_id: int, user_id: int, required: bool,
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_organizer(db, campaign_id, user)
    member = db.scalar(
        select(Member).where(Member.campaign_id == campaign_id, Member.user_id == user_id,
                             Member.left_at.is_(None))
    )
    if member is None:
        raise HTTPException(404, "member not found")
    member.required = required
    db.commit()
    return {"user_id": user_id, "required": required}


@router.delete("/campaigns/{campaign_id}", status_code=204)
def delete_campaign(campaign_id: int, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    require_organizer(db, campaign_id, user)
    services.delete_campaign(db, campaign_id)

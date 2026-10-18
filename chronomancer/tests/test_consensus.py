"""Everyone can see when the others are free; the best times are always offered; times that have
already begun are never offered."""
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

from conftest import login, make_client

ROOT = Path(__file__).resolve().parent.parent
DAY = "2031-03-03"


def poll_body(duration=120):
    return {"title": "Session", "timezone": "UTC", "date_start": DAY, "window_start": "12:00:00",
            "window_end": "18:00:00", "duration_min": duration}


def party(client, extra=4):
    """A manager plus `extra` players, each with their own session. Returns (campaign, [clients])."""
    login(client, "1", "Dana")
    campaign = client.post("/api/campaigns", json={"name": "Party"}).json()
    clients = [client]
    for i in range(extra):
        c = make_client()
        login(c, str(i + 2), f"Player{i + 2}")
        assert c.post("/api/join", json={"invite_code": campaign["invite_code"]}).status_code == 200
        clients.append(c)
    return campaign, clients


def mark(c, poll, hours, level="free"):
    """Mark the slots that start within [first, last) hours of the poll day."""
    first, last = hours
    picks = [s for s in poll["slots"] if s.startswith(DAY) and first <= int(s[11:13]) < last]
    r = c.put(f"/api/polls/{poll['id']}/availability",
              json={"slots": [{"start": s, "level": level} for s in picks]})
    assert r.status_code == 200, r.text


def user_id(c):
    return c.get("/api/me").json()["id"]


def test_the_manager_is_not_required_by_default(db):
    from app import services
    owner = services.upsert_user(db, "9", "Boss")
    _, member = services.create_campaign(db, owner, name="x")
    assert member.required is False


def test_others_answers_are_visible_but_your_own_come_from_the_page(client):
    campaign, (dana, aria, *_) = party(client)
    poll = client.post(f"/api/campaigns/{campaign['id']}/polls", json=poll_body()).json()
    mark(dana, poll, (12, 14))
    mark(aria, poll, (12, 13), "maybe")
    mine = client.get(f"/api/polls/{poll['id']}").json()
    slot = f"{DAY}T12:00:00Z"
    assert mine["party_size"] == 5 and mine["my_user_id"] == user_id(dana)
    assert mine["slot_people"][slot] == {"maybe": [user_id(aria)]}   # the viewer's own mark is left out
    assert aria.get(f"/api/polls/{poll['id']}").json()["slot_people"][slot] == {"free": [user_id(dana)]}


def test_a_member_who_left_no_longer_counts(client, db):
    from app.models import Member
    campaign, (dana, aria, *_) = party(client)
    poll = client.post(f"/api/campaigns/{campaign['id']}/polls", json=poll_body()).json()
    mark(aria, poll, (12, 14))
    member = db.query(Member).filter_by(campaign_id=campaign["id"], user_id=user_id(aria)).one()
    member.left_at = datetime.now(timezone.utc)
    db.commit()
    body = client.get(f"/api/polls/{poll['id']}").json()
    assert body["party_size"] == 4 and body["slot_people"] == {} and body["slot_counts"] == {}


def test_best_so_far_names_the_best_time_and_is_empty_when_nobody_fits(client):
    campaign, (dana, aria, borin, *_) = party(client)
    poll = client.post(f"/api/campaigns/{campaign['id']}/polls", json=poll_body()).json()
    assert client.get(f"/api/polls/{poll['id']}").json()["best_so_far"] is None
    mark(dana, poll, (13, 16))
    mark(aria, poll, (13, 16))
    mark(borin, poll, (14, 16), "maybe")
    best = client.get(f"/api/polls/{poll['id']}").json()["best_so_far"]
    assert best == {"start": f"{DAY}T14:00:00Z", "free_count": 2, "maybe_count": 1}


def test_five_people_with_a_short_overlap_get_the_best_times_not_a_refusal(client):
    """The reported failure: five people mark time, but not everyone fits."""
    campaign, people = party(client)
    poll = client.post(f"/api/campaigns/{campaign['id']}/polls", json=poll_body(120)).json()
    for c in people[:4]:
        mark(c, poll, (12, 15))            # four people have three hours together
    mark(people[4], poll, (12, 13))        # the fifth only an hour
    closed = client.post(f"/api/polls/{poll['id']}/close")
    assert closed.status_code == 200, closed.text
    top = closed.json()["candidates"][0]
    assert (top["free_count"], top["start"]) == (4, f"{DAY}T12:00:00Z")


def test_when_the_session_is_longer_than_every_block_the_message_says_how_close_they_got(client):
    campaign, people = party(client)
    poll = client.post(f"/api/campaigns/{campaign['id']}/polls", json=poll_body(180)).json()
    for c in people:
        mark(c, poll, (12, 14))            # everyone is free for two hours; the session needs three
    r = client.post(f"/api/polls/{poll['id']}/close")
    assert r.status_code == 409
    text = r.json()["detail"]["message"]
    assert "Nobody is free for a whole 3 hours session" in text
    assert "5 of 5 people are free together (2 hours)" in text and "12:00-14:00" in text
    assert client.get(f"/api/polls/{poll['id']}").json()["status"] == "collecting"   # still open


def test_nobody_has_answered(client):
    campaign, _ = party(client, extra=1)
    poll = client.post(f"/api/campaigns/{campaign['id']}/polls", json=poll_body()).json()
    r = client.post(f"/api/polls/{poll['id']}/close")
    assert r.status_code == 409
    assert r.json()["detail"]["message"] == "Nobody has marked any availability yet."


def test_a_required_person_who_cannot_make_it_is_named(client):
    campaign, (dana, aria, borin) = party(client, extra=2)
    r = client.put(f"/api/campaigns/{campaign['id']}/members/{user_id(aria)}/required", params={"required": "true"})
    assert r.status_code == 200
    poll = client.post(f"/api/campaigns/{campaign['id']}/polls", json=poll_body()).json()
    mark(dana, poll, (12, 15))
    mark(borin, poll, (12, 15))            # Player2 (required) marked nothing
    r = client.post(f"/api/polls/{poll['id']}/close")
    assert r.status_code == 409
    message = r.json()["detail"]["message"]
    assert "Player2" in message and "Untick Required" in message


def test_times_that_have_begun_are_not_offered(db):
    from app import services
    from app.models import Availability
    owner = services.upsert_user(db, "77", "Late")
    camp, _ = services.create_campaign(db, owner, name="late")
    start = (datetime.now(timezone.utc) - timedelta(days=2)).date()
    poll = services.create_poll(db, camp, title="t", date_start=start, window_start=time(0),
                                window_end=time(0), tz="UTC", duration_min=60)
    for slot in services.poll_slots(poll):
        db.add(Availability(poll_id=poll.id, user_id=owner.id, slot_start_utc=slot, level="free"))
    db.commit()
    services.close_poll(db, poll)
    now = datetime.now(timezone.utc)
    assert poll.candidates
    assert all(c.start_utc.replace(tzinfo=timezone.utc) > now for c in poll.candidates)


# ---- the pages


def test_the_grid_script_shows_counts_names_and_greys_out_the_past():
    js = (ROOT / "web" / "js" / "grid.js").read_text(encoding="utf-8")
    for needle in ("setConsensus", "slot_people", "cell-past", "isPast(iso)", "No answer", "of ${party} free"):
        assert needle in js, needle


def test_the_poll_page_refreshes_every_thirty_seconds_without_rebuilding_the_grid():
    page = (ROOT / "web" / "poll.html").read_text(encoding="utf-8")
    assert "setInterval(refreshConsensus, 30000)" in page and "grid.setConsensus(fresh)" in page
    assert "min_quorum" not in page and "best-so-far" in page


def test_no_page_or_command_mentions_the_removed_minimum():
    for rel in ("web/campaign.html", "web/poll.html", "app/bot/commands.py", "app/bot/actions.py",
                "web/themes/dnd.json", "web/themes/plain.json"):
        text = (ROOT / rel).read_text(encoding="utf-8").lower()
        assert "quorum" not in text and "minimum free" not in text, rel


def test_the_privacy_page_says_members_can_see_each_others_answers():
    text = (ROOT / "web" / "privacy.html").read_text(encoding="utf-8").lower()
    assert "see each other" in text and "hover" in text


def test_every_script_on_the_site_is_valid_javascript(tmp_path):
    """grid.js once shipped with a stray line break inside a string; only a real parser notices."""
    import re
    import shutil
    import subprocess

    import pytest
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    files = sorted((ROOT / "web" / "js").glob("*.js"))
    for page in sorted((ROOT / "web").glob("*.html")):
        for i, m in enumerate(re.finditer(r"<script>(.*?)</script>", page.read_text(encoding="utf-8"), re.S)):
            inline = tmp_path / f"{page.stem}-{i}.js"
            inline.write_text(m.group(1), encoding="utf-8")
            files.append(inline)
    assert files
    for f in files:
        result = subprocess.run([node, "--check", str(f)], capture_output=True, text=True)
        assert result.returncode == 0, f"{f.name}: {result.stderr[:300]}"

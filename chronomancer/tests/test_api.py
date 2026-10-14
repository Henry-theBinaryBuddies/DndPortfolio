from conftest import login, make_client

POLL = {
    "title": "Session 5",
    "timezone": "UTC",
    "date_start": "2026-03-02",
    "date_end": "2026-03-03",
    "window_start": "18:00:00",
    "window_end": "22:00:00",
    "duration_min": 120,
    "min_quorum": 2,
}


def setup_party(client):
    dm = login(client, "1", "Dungeon Master")
    campaign = client.post("/api/campaigns", json={"name": "Curse of Strahd"}).json()
    players = []
    for i, name in ((2, "Aria"), (3, "Borin")):
        c = make_client()
        login(c, str(i), name)
        assert c.post("/api/join", json={"invite_code": campaign["invite_code"]}).status_code == 200
        players.append(c)
    return campaign, players


def free_marks(slots, picks):
    return {"slots": [{"start": s, "level": lv} for s, lv in picks(slots)]}


def test_requires_login(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/campaigns").status_code == 401


def test_dev_login_disabled_outside_dev(client, monkeypatch):
    from app import config
    monkeypatch.setattr(config, "DEV_MODE", False)
    r = client.post("/api/dev/login", json={"discord_id": "9", "display_name": "x"})
    assert r.status_code == 404


def test_cross_origin_post_is_blocked(client):
    r = client.post("/api/dev/login", headers={"Origin": "http://evil.example"},
                    json={"discord_id": "9", "display_name": "x"})
    assert r.status_code == 403


def test_invite_code_visible_to_organizer_only(client):
    campaign, players = setup_party(client)
    assert "invite_code" in campaign
    seen = players[0].get(f"/api/campaigns/{campaign['id']}").json()
    assert "invite_code" not in seen and seen["my_role"] == "player"


def test_non_member_cannot_see_campaign_or_poll(client):
    campaign, _ = setup_party(client)
    poll = client.post(f"/api/campaigns/{campaign['id']}/polls", json=POLL).json()
    outsider = make_client()
    login(outsider, "99", "Stranger")
    assert outsider.get(f"/api/campaigns/{campaign['id']}").status_code == 404
    assert outsider.get(f"/api/polls/{poll['id']}").status_code == 404
    assert outsider.put(f"/api/polls/{poll['id']}/availability",
                        json={"slots": []}).status_code == 404


def test_player_cannot_create_poll_or_close(client):
    campaign, players = setup_party(client)
    assert players[0].post(f"/api/campaigns/{campaign['id']}/polls",
                           json=POLL).status_code == 403
    poll = client.post(f"/api/campaigns/{campaign['id']}/polls", json=POLL).json()
    assert players[0].post(f"/api/polls/{poll['id']}/close").status_code == 403


def test_poll_validation(client):
    campaign, _ = setup_party(client)
    url = f"/api/campaigns/{campaign['id']}/polls"
    assert client.post(url, json={**POLL, "date_end": "2026-01-01"}).status_code == 422
    assert client.post(url, json={**POLL, "duration_min": 600}).status_code == 422
    assert client.post(url, json={**POLL, "date_end": "2026-12-31"}).status_code == 422
    assert client.post(url, json={**POLL, "timezone": "Mars/Base"}).status_code == 422


def test_availability_rejects_foreign_slots(client):
    campaign, _ = setup_party(client)
    poll = client.post(f"/api/campaigns/{campaign['id']}/polls", json=POLL).json()
    bad = {"slots": [{"start": "2030-01-01T00:00:00Z", "level": "free"}]}
    assert client.put(f"/api/polls/{poll['id']}/availability", json=bad).status_code == 422
    naive = {"slots": [{"start": poll["slots"][0][:-1], "level": "free"}]}
    assert client.put(f"/api/polls/{poll['id']}/availability", json=naive).status_code == 422


def test_full_flow_to_confirmed_session(client):
    campaign, (aria, borin) = setup_party(client)
    poll = client.post(f"/api/campaigns/{campaign['id']}/polls", json=POLL).json()
    pid, slots = poll["id"], poll["slots"]
    day1 = [s for s in slots if s.startswith("2026-03-02")]
    day2 = [s for s in slots if s.startswith("2026-03-03")]

    everyone_day1 = {"slots": [{"start": s, "level": "free"} for s in day1]}
    only_day2 = {"slots": [{"start": s, "level": "free"} for s in day2]}
    for c in (client, aria):
        assert c.put(f"/api/polls/{pid}/availability", json=everyone_day1).status_code == 200
    assert borin.put(f"/api/polls/{pid}/availability", json=only_day2).status_code == 200

    closed = client.post(f"/api/polls/{pid}/close")
    assert closed.status_code == 200, closed.text
    body = closed.json()
    assert body["status"] == "voting"
    cands = body["candidates"]
    assert 1 <= len(cands) <= 3
    assert all(c["start"].startswith("2026-03-02") for c in cands)  # DM + Aria beat Borin alone

    assert aria.post(f"/api/polls/{pid}/votes", json={"candidate_id": cands[-1]["id"]}).status_code == 200
    assert client.post(f"/api/polls/{pid}/votes", json={"candidate_id": cands[-1]["id"]}).status_code == 200
    # changing a vote replaces it rather than adding another
    assert aria.post(f"/api/polls/{pid}/votes", json={"candidate_id": cands[0]["id"]}).status_code == 200
    state = aria.get(f"/api/polls/{pid}").json()
    assert state["my_vote"] == cands[0]["id"]
    assert sum(c["votes"] for c in state["candidates"]) == 2

    assert aria.post(f"/api/polls/{pid}/confirm").status_code == 403
    done = client.post(f"/api/polls/{pid}/confirm").json()
    assert done["status"] == "confirmed"
    assert done["confirmed_start"] in {c["start"] for c in cands}
    # closed polls reject further changes
    assert client.put(f"/api/polls/{pid}/availability", json=everyone_day1).status_code == 409
    assert aria.post(f"/api/polls/{pid}/votes", json={"candidate_id": cands[0]["id"]}).status_code == 409


def test_close_with_no_viable_time_explains_why(client):
    campaign, _ = setup_party(client)
    poll = client.post(f"/api/campaigns/{campaign['id']}/polls", json=POLL).json()
    r = client.post(f"/api/polls/{poll['id']}/close")
    assert r.status_code == 409
    assert r.json()["detail"]["considered"] > 0
    assert client.get(f"/api/polls/{poll['id']}").json()["status"] == "collecting"


def test_delete_campaign_removes_everything(client):
    campaign, (aria, _) = setup_party(client)
    poll = client.post(f"/api/campaigns/{campaign['id']}/polls", json=POLL).json()
    marks = {"slots": [{"start": s, "level": "free"} for s in poll["slots"]]}
    client.put(f"/api/polls/{poll['id']}/availability", json=marks)
    aria.put(f"/api/polls/{poll['id']}/availability", json=marks)
    client.post(f"/api/polls/{poll['id']}/close")
    assert aria.delete(f"/api/campaigns/{campaign['id']}").status_code == 403
    assert client.delete(f"/api/campaigns/{campaign['id']}").status_code == 204
    assert client.get(f"/api/campaigns/{campaign['id']}").status_code == 404
    assert client.get(f"/api/polls/{poll['id']}").status_code == 404


def test_close_with_vote_window_sets_a_deadline(client):
    campaign, (aria, _) = setup_party(client)
    poll = client.post(f"/api/campaigns/{campaign['id']}/polls", json=POLL).json()
    marks = {"slots": [{"start": s, "level": "free"} for s in poll["slots"]]}
    for c in (client, aria):
        c.put(f"/api/polls/{poll['id']}/availability", json=marks)
    assert client.post(f"/api/polls/{poll['id']}/close", json={"vote_hours": 0}).status_code == 422
    assert client.post(f"/api/polls/{poll['id']}/close", json={"vote_hours": 9999}).status_code == 422
    body = client.post(f"/api/polls/{poll['id']}/close", json={"vote_hours": 48}).json()
    assert body["status"] == "voting" and body["vote_deadline"]


def test_availability_saves_are_rate_limited(client):
    campaign, _ = setup_party(client)
    poll = client.post(f"/api/campaigns/{campaign['id']}/polls", json=POLL).json()
    codes = [client.put(f"/api/polls/{poll['id']}/availability", json={"slots": []}).status_code
             for _ in range(65)]
    assert codes[:60] == [200] * 60 and 429 in codes[60:]


def test_web_created_campaigns_reject_absurd_reminder_settings(client):
    login(client, "1", "DM")
    bad = client.post("/api/campaigns", json={"name": "x", "reminder_offsets_min": [1, 2, 3, 4, 5, 6]})
    assert bad.status_code == 422
    neg = client.post("/api/campaigns", json={"name": "x", "reminder_offsets_min": [-5]})
    assert neg.status_code == 422

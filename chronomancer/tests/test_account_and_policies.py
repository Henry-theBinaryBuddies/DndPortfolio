"""'Delete my data', and the privacy policy and terms pages that promise it. The policy must say what
the code really does, so its facts are checked against the code and config."""
import json
import re
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app import config, services
from app.models import Attendance, Availability, Campaign, Member, Poll, User, Vote, WebSession

from conftest import login, make_client
from helpers import fresh, make_campaign, voting_poll

WEB = Path(__file__).resolve().parent.parent / "web"
APP = WEB.parent / "app"
PRIVACY = (WEB / "privacy.html").read_text(encoding="utf-8")
TERMS = (WEB / "terms.html").read_text(encoding="utf-8")
PAGES = {n: (WEB / n).read_text(encoding="utf-8")
         for n in ("index.html", "campaign.html", "poll.html", "privacy.html", "terms.html")}
EMAIL = "henry@thebinarybuddies.com"


def count(model, **where):
    with fresh() as db:
        return db.scalar(select(func.count()).select_from(model).filter_by(**where))


# ------------------------------------------------ deleting a person's data


def setup_group(db):
    campaign, poll, (owner, aria, borin) = voting_poll(db)
    return campaign, poll, owner, aria, borin


def test_a_members_data_is_removed_and_everyone_elses_is_not(db):
    campaign, poll, owner, aria, borin = setup_group(db)
    cand = poll.candidates[0]
    services.cast_vote(db, poll, aria, cand.id)
    services.cast_vote(db, poll, borin, cand.id)
    db.add(Attendance(poll_id=poll.id, user_id=aria.id, answer="out"))
    services.create_web_session(db, aria)
    db.commit()
    mine, theirs = count(Availability, user_id=aria.id), count(Availability, user_id=borin.id)
    assert mine > 0
    removed = services.delete_user_data(db, aria)
    assert removed["availability"] == mine and removed["votes"] == 1 and removed["web_sessions"] == 1
    for model in (Availability, Vote, Attendance, Member, WebSession):
        assert count(model, user_id=aria.id) == 0
    with fresh() as other:
        assert other.get(User, aria.id) is None
        assert other.get(Campaign, campaign.id) is not None and other.get(Poll, poll.id) is not None
    assert count(Availability, user_id=borin.id) == theirs and count(Vote, user_id=borin.id) == 1
    assert count(Member, campaign_id=campaign.id) == 2  # the organizer and one player remain


def test_someone_who_runs_a_group_must_delete_it_first(db):
    campaign, poll, owner, aria, borin = setup_group(db)
    with pytest.raises(services.ServiceError) as err:
        services.delete_user_data(db, owner)
    assert err.value.status == 409 and '"Curse of Strahd"' in str(err.value.detail)
    assert count(User, id=owner.id) == 1 and count(Member, user_id=owner.id) == 1  # nothing was touched
    services.delete_campaign(db, campaign.id)
    services.delete_user_data(db, owner)
    assert count(User, id=owner.id) == 0


def test_a_group_the_person_owns_counts_even_if_their_role_row_says_player(db):
    campaign, owner = make_campaign(db)
    db.query(Member).filter_by(campaign_id=campaign.id, user_id=owner.id).update({"role": "player"})
    db.commit()
    with pytest.raises(services.ServiceError):
        services.delete_user_data(db, owner)


def test_the_message_names_every_group_they_run(db):
    owner = services.upsert_user(db, "1", "DM")
    for i in range(2):
        services.create_campaign(db, owner, name=f"Group {i}", guild_id=None, channel_id=None)
    with pytest.raises(services.ServiceError) as err:
        services.delete_user_data(db, owner)
    text = str(err.value.detail)
    assert '"Group 0"' in text and '"Group 1"' in text and "Delete them first" in text


def test_deleting_through_the_api_logs_out_every_device_and_forgets_the_person(client):
    login(client, "1", "DM")
    camp = client.post("/api/campaigns", json={"name": "x"}).json()
    member, phone = make_client(), make_client()
    login(member, "2", "Aria")
    login(phone, "2", "Aria")                             # a second device, same person
    member.post("/api/join", json={"invite_code": camp["invite_code"]})
    assert member.delete("/api/me").status_code == 204
    assert member.get("/api/me").status_code == 401       # this browser is logged out
    assert phone.get("/api/me").status_code == 401        # and so is the other one
    assert count(User, discord_id="2") == 0
    assert [m["display_name"] for m in client.get(f"/api/campaigns/{camp['id']}").json()["members"]] == ["DM"]


def test_logging_in_again_starts_from_nothing(client):
    login(client, "1", "DM")
    camp = client.post("/api/campaigns", json={"name": "x"}).json()
    member = make_client()
    login(member, "2", "Aria")
    member.post("/api/join", json={"invite_code": camp["invite_code"]})
    member.delete("/api/me")
    login(member, "2", "Aria")
    assert member.get("/api/campaigns").json() == []


def test_an_organizer_gets_a_409_through_the_api_and_stays_logged_in(client):
    login(client, "1", "DM")
    client.post("/api/campaigns", json={"name": "Mine"})
    r = client.delete("/api/me")
    assert r.status_code == 409 and "Mine" in r.json()["detail"]
    assert client.get("/api/me").status_code == 200


def test_deleting_data_requires_a_login(client):
    assert make_client().delete("/api/me").status_code == 401


def test_the_home_page_has_a_confirmed_delete_my_data_button():
    page = PAGES["index.html"]
    assert 'id="delete-data"' in page and 'Api.del("/api/me")' in page
    assert 'confirm(Theme.t("deleteMyDataConfirm"))' in page and "button.disabled = true" in page
    assert 'id="data-error"' in page
    for theme in ("dnd", "plain"):
        words = json.loads((WEB / "themes" / f"{theme}.json").read_text(encoding="utf-8"))
        assert {"yourData", "deleteMyDataIntro", "deleteMyData", "deleteMyDataConfirm"} <= set(words)
        assert "cannot be undone" in words["deleteMyDataConfirm"]


# ------------------------------------------------ the policy pages


def test_both_pages_exist_and_every_page_links_to_them():
    for name, page in PAGES.items():
        assert 'href="/privacy.html"' in page and 'href="/terms.html"' in page, name


def test_both_pages_give_the_contact_and_the_operator():
    for page in (PRIVACY, TERMS):
        assert EMAIL in page and "Henry Rudolph" in page


def test_the_policy_matches_the_login_permission_and_the_retention_settings():
    assert "<code>identify</code> permission only" in PRIVACY
    assert f"about {config.AVAILABILITY_KEEP_DAYS} days" in PRIVACY
    assert f"lasts {services.SESSION_LIFETIME.days} days" in PRIVACY


def test_the_login_really_asks_only_for_identify():
    assert '"scope": "identify"' in (APP / "discord_oauth.py").read_text(encoding="utf-8")


def test_the_policy_says_what_the_bot_can_and_cannot_see():
    bot = (APP / "bot" / "client.py").read_text(encoding="utf-8")
    assert "intents = discord.Intents.none()" in bot and "intents.guilds = True" in bot
    assert "intents.message_content" not in bot and "intents.members" not in bot
    assert "does not read the messages" in PRIVACY


def test_nothing_is_loaded_from_a_third_party_except_the_font_the_policy_discloses():
    for name, page in PAGES.items():
        assert not re.search(r'<script[^>]+src="https?://', page), name
    css = (WEB / "css" / "themes" / "dnd.css").read_text(encoding="utf-8")
    assert "fonts.googleapis.com" in css and "Google Fonts" in PRIVACY
    plain = (WEB / "css" / "themes" / "plain.css").read_text(encoding="utf-8")
    assert not re.search(r"@import|url\(\s*[\"']?https?:", plain)  # an SVG xmlns label is not a request


def test_the_policy_describes_the_delete_button_that_exists():
    assert "Delete my data" in PRIVACY and "Delete my data" in TERMS
    for what in ("profile", "group memberships", "availability", "votes", "attendance answers", "logins"):
        assert what in PRIVACY


def test_the_terms_disclaim_discord_and_wizards_of_the_coast():
    assert "Wizards of the Coast" in TERMS and "Discord Inc." in TERMS and "not made by" in TERMS


def test_the_pages_are_well_formed_and_titled():
    for name, title in (("privacy.html", "Privacy Policy"), ("terms.html", "Terms of Service")):
        page = PAGES[name]
        assert f"<title>{title} - Chronomancer</title>" in page and page.count("<h1>") == 1
        assert '<meta name="viewport"' in page

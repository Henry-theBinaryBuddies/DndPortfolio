"""Starting the real server from the environment, and the safety rails on the manual smoke tool."""

from fastapi.testclient import TestClient

from cauldron.service.main import create_default_app
from cauldron.service.smoke import main as smoke


def env(tmp_path, **extra) -> dict[str, str]:
    return {"CAULDRON_DATABASE": str(tmp_path / "test.sqlite3"), **extra}


def test_the_server_starts_without_a_key_and_serves_the_library_endpoints(tmp_path) -> None:
    client = TestClient(create_default_app(env(tmp_path)))
    assert client.get("/api/v1/health").json() == {"status": "ok"}
    assert client.get("/api/v1/library").json() == []


def test_without_a_key_generation_says_the_forge_cannot_be_reached(tmp_path) -> None:
    client = TestClient(create_default_app(env(tmp_path)))
    response = client.post("/api/v1/generate", json={"types": ["undead"], "crMin": 3, "crMax": 3})
    assert response.status_code == 502
    assert response.json()["reason"] == "error" and "could not be reached" in response.json()["message"]


def test_reskinning_a_known_srd_monster_reaches_the_ai_step_and_fails_the_same_way(tmp_path) -> None:
    client = TestClient(create_default_app(env(tmp_path)))
    response = client.post("/api/v1/reskin", json={"baseId": "srd-goblin", "template": "level_up"})
    assert response.status_code == 502  # the base was found in the static library; only the naming step is unavailable


def test_the_database_file_is_created_where_the_settings_say(tmp_path) -> None:
    create_default_app(env(tmp_path))
    assert (tmp_path / "test.sqlite3").exists()


def test_a_bad_setting_stops_start_up_with_a_clear_message(tmp_path) -> None:
    import pytest

    from cauldron.service.settings import SettingsError

    with pytest.raises(SettingsError, match="CAULDRON_DAILY_CAP"):
        create_default_app(env(tmp_path, CAULDRON_DAILY_CAP="0"))


def test_the_smoke_tool_refuses_to_spend_money_without_yes(capsys) -> None:
    assert smoke([], {"ANTHROPIC_API_KEY": "sk-ant-test"}) == 2
    assert "--yes" in capsys.readouterr().out


def test_the_smoke_tool_needs_a_key(capsys) -> None:
    assert smoke(["--yes"], {}) == 1
    assert "ANTHROPIC_API_KEY" in capsys.readouterr().out

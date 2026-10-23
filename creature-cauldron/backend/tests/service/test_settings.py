"""Settings come from environment variables, with safe defaults. The API key is deliberately not one of them."""

from pathlib import Path

import pytest

from cauldron.service.settings import Settings, SettingsError


def test_defaults_are_the_agreed_numbers() -> None:
    s = Settings.from_env({})
    assert s.daily_cap == 150
    assert (s.ip_per_minute, s.ip_per_hour) == (3, 10)
    assert s.max_retries == 2
    assert s.max_cr == "17"
    assert s.trusted_proxy_header is None
    assert s.allowed_origins == ("http://localhost:5199", "http://localhost:5173")


def test_values_are_read_from_the_environment() -> None:
    s = Settings.from_env(
        {
            "CAULDRON_DATABASE": "C:/data/cauldron.sqlite3",
            "CAULDRON_ALLOWED_ORIGINS": "https://example.github.io, http://localhost:5199",
            "CAULDRON_DAILY_CAP": "40",
            "CAULDRON_IP_PER_MINUTE": "1",
            "CAULDRON_IP_PER_HOUR": "5",
            "CAULDRON_MAX_RETRIES": "1",
            "CAULDRON_MAX_CR": "10",
            "CAULDRON_TRUSTED_PROXY_HEADER": "CF-Connecting-IP",
            "CAULDRON_MODEL": "claude-haiku-5-5",
        }
    )
    assert s.database_path == Path("C:/data/cauldron.sqlite3")
    assert s.allowed_origins == ("https://example.github.io", "http://localhost:5199")
    assert (s.daily_cap, s.ip_per_minute, s.ip_per_hour, s.max_retries, s.max_cr) == (40, 1, 5, 1, "10")
    assert s.trusted_proxy_header == "CF-Connecting-IP"
    assert s.model == "claude-haiku-5-5"


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("CAULDRON_DAILY_CAP", "0"),
        ("CAULDRON_DAILY_CAP", "lots"),
        ("CAULDRON_IP_PER_MINUTE", "-1"),
        ("CAULDRON_MAX_RETRIES", "9"),
        ("CAULDRON_MAX_CR", "31"),
        ("CAULDRON_ALLOWED_ORIGINS", "*"),
        ("CAULDRON_ALLOWED_ORIGINS", ""),
    ],
)
def test_bad_values_are_refused_with_a_clear_error(name: str, value: str) -> None:
    with pytest.raises(SettingsError) as error:
        Settings.from_env({name: value})
    assert name in str(error.value)


def test_the_api_key_is_not_part_of_the_settings() -> None:
    assert not hasattr(Settings.from_env({"ANTHROPIC_API_KEY": "secret"}), "api_key")
    assert "secret" not in repr(Settings.from_env({"ANTHROPIC_API_KEY": "secret"}))

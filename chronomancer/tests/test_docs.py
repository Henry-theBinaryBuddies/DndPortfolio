"""The written documentation stays true: links resolve, the command list matches the bot, the settings
and files it names exist, and the stale wording from earlier phases is gone."""
import asyncio
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
DOCS = {name: (ROOT / name).read_text(encoding="utf-8")
        for name in ("README.md", "DESIGN.md", "DEPLOY.md", "OPERATIONS.md")}
ENV_EXAMPLE = (ROOT / ".env.example").read_text(encoding="utf-8")
PROD_ENV = (ROOT / ".env.production.example").read_text(encoding="utf-8")


@pytest.mark.parametrize("name,text", list(DOCS.items()), ids=list(DOCS))
def test_every_relative_link_points_at_a_file_that_exists(name, text):
    for target in re.findall(r"\]\((?!https?:|mailto:|#)([^)#\s]+)", text):
        assert (ROOT / target).exists(), f"{name} links to {target}, which does not exist"


@pytest.mark.parametrize("name,text", list(DOCS.items()), ids=list(DOCS))
def test_no_wording_left_over_from_earlier_phases(name, text):
    for stale in ("/chronomancer link", "/repost", "Phase 2 as built", "## Phases", "## Open items",
                  "Python 3.11+", "docker-compose-v2", "/availability command"):
        assert stale not in text, f"{name} still says {stale!r}"
    for line in text.splitlines():  # quarterly is gone; it may only appear as the note that it was removed
        if "quarterly" in line.lower():
            assert "removed" in line.lower() or "no longer" in line.lower(), f"{name}: {line[:80]}"


def registered_commands():
    from discord import app_commands

    from app.bot import commands

    async def build():
        class Tree:
            pass
        import discord
        tree = app_commands.CommandTree(discord.Client(intents=discord.Intents.none()))
        commands.register(tree)
        top = {c.name: c for c in tree.get_commands()}
        return top, {c.name: c for c in top["chronomancer"].commands}

    return asyncio.run(build())


def test_the_readme_documents_exactly_the_commands_the_bot_registers():
    top, sub = registered_commands()
    real = {f"/{n}" for n in top if n != "chronomancer"} | {f"/chronomancer {n}" for n in sub}
    documented = set(re.findall(r"^\| `(/[a-z]+(?: [a-z]+)?)`", DOCS["README.md"], re.M))
    assert documented == real, (documented ^ real)


def test_the_readme_lists_the_real_options_of_setup_and_poll():
    _, sub = registered_commands()
    for command in ("setup", "poll"):
        for option in (p.name for p in sub[command].parameters):
            assert f"`{option}`" in DOCS["README.md"], f"README does not mention {command} option {option}"


def test_every_setting_the_readme_names_is_in_the_example_files():
    for name in re.findall(r"^\| `([A-Z_]+)(?:=0)?`", DOCS["README.md"], re.M):
        assert name in ENV_EXAMPLE + PROD_ENV, name


def test_the_files_the_design_layout_lists_exist():
    layout = DOCS["DESIGN.md"].split("## Layout")[1].split("## Data model")[0]
    for line in layout.splitlines():
        m = re.match(r"^\s+([A-Za-z_./\-]+\.(?:py|html|js|css|json|md|sh|yml|txt|ini))\b", line)
        if not m:
            continue
        base = Path(m.group(1)).name           # the layout nests folders by indentation, so match by file name
        found = [p for p in ROOT.rglob(base) if ".venv" not in p.parts and "__pycache__" not in p.parts]
        assert found, f"DESIGN lists {base}, which does not exist"


def test_the_design_data_model_names_every_table():
    from app import models
    from app.db import Base

    section = DOCS["DESIGN.md"].split("## Data model")[1].split("## Ranking")[0]
    for table in Base.metadata.tables:
        assert f"**{table}" in section or f"**{table.replace('_', ' ')}" in section or table in section, table


def test_the_operations_guide_names_only_things_that_exist():
    text = DOCS["OPERATIONS.md"]
    for needed in ("backup.sh", "docker compose", "delete_user_data", "BACKUP_BUCKET", "SITE_ADDRESS", "/api/config",
                   "chown 10001:10001"):
        assert needed in text, needed
    from app import services
    assert hasattr(services, "delete_user_data")
    assert (ROOT / "deploy" / "backup.sh").is_file()


def test_the_live_address_is_the_same_everywhere_it_is_written():
    addresses = {a for t in DOCS.values() for a in re.findall(r"https://(\d+-\d+-\d+-\d+\.sslip\.io)", t)}
    assert len(addresses) == 1, addresses

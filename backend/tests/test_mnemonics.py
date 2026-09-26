"""The mnemonic list (item e): one table in `constants.py`, equal to UI_SPEC section 5 in code and priority.

The test reads the table from `terminal/docs/UI_SPEC.md` itself, so a change on either side fails until both agree.
It also checks the command index resolves catalog-only roots (RTY has a 1m series but no dtsmom entry).
"""
from __future__ import annotations

import re

from fastapi.testclient import TestClient

from nq_terminal import constants
from nq_terminal.app import create_app
from nq_terminal.settings import TERMINAL_DIR, load_settings

UI_SPEC = TERMINAL_DIR / "docs" / "UI_SPEC.md"
ROW = re.compile(r"^\|\s*(?P<codes>(?:`[A-Z]+`\s*)+)\|[^|]*\|\s*(?P<pri>P\d)\s*\|\s*$")


def spec_table(text: str) -> dict[str, str]:
    section = text.split("### Mnemonics", 1)[1].split("###", 1)[0]
    table = {}
    for line in section.splitlines():
        match = ROW.match(line.strip())
        if match:
            for code in re.findall(r"`([A-Z]+)`", match["codes"]):
                table[code] = match["pri"]
    return table


def test_the_parser_is_born_failing():
    sample = "### Mnemonics\n| `HOME` | Launchpad | P0 |\n| `EQ` `DD` | tabs | P0 |\n### Keys\n"
    assert spec_table(sample) == {"HOME": "P0", "EQ": "P0", "DD": "P0"}


def test_the_mnemonic_table_equals_ui_spec_section_5():
    table = {code: priority for code, _, priority, _ in constants.MNEMONICS}
    assert len(table) == len(constants.MNEMONICS)  # no duplicate codes
    assert table == spec_table(UI_SPEC.read_text(encoding="utf-8"))


def test_commands_serve_the_constants_table():
    body = TestClient(create_app(load_settings({})), base_url="http://127.0.0.1",
                      client=("127.0.0.1", 50000)).get("/api/commands").json()
    assert [(m["code"], m["priority"]) for m in body["mnemonics"]] == [(c, p) for c, _, p, _ in constants.MNEMONICS]
    roots = {i["root"]: i["sector"] for i in body["instruments"]}
    assert roots["RTY"] == "equity" and roots["NQ"] == "equity" and len(roots) == 28

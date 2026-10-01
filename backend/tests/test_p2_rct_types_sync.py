"""The web types of RG2, EX5 and MV6 (`web/src/screens/p2rct/types.ts`) are aliases of the generated contract schema,
one for each response model of `models/regimes_capacity_term.py` (TASKS Phase 12).

The earlier guard compared a hand-written copy of the models field for field. Now that the copy is an alias of
`Schemas[...]`, `tsc -b` checks every field; what is left to check here is that no model lacks its alias and that
no hand-written `interface` has crept back in.

Born failing: a model with no alias, and an interface in the file, are each reported by the comparison that passes
on the real file.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
from pydantic import BaseModel

from nq_terminal.models import regimes_capacity_term as models

TYPES_TS = Path(__file__).resolve().parents[2] / "web" / "src" / "screens" / "p2rct" / "types.ts"
NAMES = ("GateInfo", "Context", "TrendRegimeRow", "TrendRegimeView", "CapacityInstrument", "CapacityRow",
         "CapacitySession", "RunCapacity", "TermPoint", "TermVoid", "TermSummary", "TermStructure")
ALIAS = re.compile(r"^export type (\w+) = Schemas\['(\w+)'\]$", re.MULTILINE)


def problems(text: str) -> list[str]:
    aliased = {name: schema for name, schema in ALIAS.findall(text)}
    out = [f"{name}: no alias of Schemas['{name}'] in types.ts" for name in NAMES if aliased.get(name) != name]
    out += [f"interface {name} written by hand" for name in re.findall(r"^export interface (\w+)", text, re.MULTILINE)]
    return out


@pytest.fixture(scope="module")
def text() -> str:
    return TYPES_TS.read_text(encoding="utf-8")


def test_every_name_is_the_name_of_a_response_model() -> None:
    for name in NAMES:
        model = getattr(models, name)
        assert isinstance(model, type) and issubclass(model, BaseModel), name


def test_every_model_has_its_alias_and_no_interface_is_written_by_hand(text: str) -> None:
    assert problems(text) == []


def test_a_missing_alias_is_caught_born_failing(text: str) -> None:
    dropped = text.replace("export type TermVoid = Schemas['TermVoid']\n", "")
    assert problems(dropped) == ["TermVoid: no alias of Schemas['TermVoid'] in types.ts"]


def test_a_hand_written_interface_is_caught_born_failing(text: str) -> None:
    planted = text + "\nexport interface Extra {\n  readonly a: number\n}\n"
    assert problems(planted) == ["interface Extra written by hand"]

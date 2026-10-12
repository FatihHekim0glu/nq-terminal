"""The `lab_only` marker contract of conftest.py: a lab_only item is skipped unless `-m` selects it.

A marker alone skips nothing; the collection hook is what makes a plain `pytest backend/tests` synthetic-only.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from conftest import lab_only_selected, pytest_collection_modifyitems


class _Item:
    def __init__(self, *names: str) -> None:
        self.names = set(names)
        self.added: list[object] = []

    def get_closest_marker(self, name: str):
        return object() if name in self.names else None

    def add_marker(self, marker) -> None:
        self.added.append(marker)


def _config(markexpr: str) -> SimpleNamespace:
    return SimpleNamespace(getoption=lambda name, default=None: markexpr if name == "markexpr" else default)


@pytest.mark.parametrize("expr", ["lab_only", "lab_only or slow", "slow or lab_only", "(lab_only)"])
def test_the_marker_expression_that_selects_lab_only_runs_it(expr):
    assert lab_only_selected(expr)


@pytest.mark.parametrize("expr", ["", None, "not lab_only", "slow", "not lab_only and slow", "lab_only and slow"])
def test_every_other_marker_expression_leaves_lab_only_skipped(expr):
    assert not lab_only_selected(expr)


def test_a_plain_run_skips_the_lab_only_items_and_only_those():
    lab, other = _Item("lab_only"), _Item("slow")
    pytest_collection_modifyitems(_config(""), [lab, other])
    assert len(lab.added) == 1 and other.added == []


def test_a_negated_expression_skips_the_lab_only_items():
    lab = _Item("lab_only")
    pytest_collection_modifyitems(_config("not lab_only"), [lab])
    assert len(lab.added) == 1


def test_the_lab_only_expression_keeps_the_lab_only_items():
    lab = _Item("lab_only")
    pytest_collection_modifyitems(_config("lab_only"), [lab])
    assert lab.added == []

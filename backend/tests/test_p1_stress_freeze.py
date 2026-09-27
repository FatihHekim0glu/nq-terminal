"""RK5 stress windows are frozen in `constants.py` before any display code (TASKS 10.4; ANALYTICS_CATALOG RK5).

The windows were derived once on 2026-09-27 from the gated NQ 1d vendor series (caller "terminal", in-sample) as the
five deepest NQ buy-and-hold drawdown episodes, before the stress display code existed. Two guards:

- the fingerprint below pins their exact content, so an edit after the display code landed fails here until it is
  made on purpose (and the change shows in review);
- the display code takes its windows only from `constants.STRESS_WINDOWS` and `STRESS_WINDOW_SPENT`: no date literal
  may appear in the modules that draw them.
"""
from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path

import pytest

from nq_terminal import constants

BACKEND = Path(__file__).resolve().parents[1]
DISPLAY_MODULES = (BACKEND / "nq_terminal" / "analytics" / "stress.py",
                   BACKEND / "nq_terminal" / "services" / "tearsheet_extended.py")
# sha256 of the canonical JSON of the frozen windows (written with the windows on 2026-09-27).
FROZEN_SHA256 = "6c2228048e262770e3d1815471072385bc450210e45c10c683aa7beb9024082e"


def canonical(windows) -> str:
    rows = [{"label": w.label, "peak": w.peak, "trough": w.trough, "recovery": w.recovery, "nq_depth": w.nq_depth,
             "source": w.source} for w in windows]
    return json.dumps(rows, sort_keys=True, separators=(",", ":"))


def fingerprint() -> str:
    text = canonical(constants.STRESS_WINDOWS) + "|" + canonical((constants.STRESS_WINDOW_SPENT,))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def test_stress_windows_are_the_frozen_ones():
    assert fingerprint() == FROZEN_SHA256, (
        "constants.STRESS_WINDOWS changed after the stress display code landed; they are frozen (RK5). If the change "
        f"is deliberate, update FROZEN_SHA256 to {fingerprint()} and say why in the review")


def test_born_failing_one_edited_date_changes_the_fingerprint():
    first = constants.STRESS_WINDOWS[0]
    edited = (type(first)(first.label, first.peak, "2020-03-23", first.recovery, first.nq_depth, first.source),
              *constants.STRESS_WINDOWS[1:])
    text = canonical(edited) + "|" + canonical((constants.STRESS_WINDOW_SPENT,))
    assert hashlib.sha256(text.encode("utf-8")).hexdigest() != FROZEN_SHA256


def test_the_five_windows_are_nq_drawdowns_deepest_first_inside_the_fence():
    windows = constants.STRESS_WINDOWS
    assert len(windows) == 5
    depths = [w.nq_depth for w in windows]
    assert depths == sorted(depths) and all(-1 < d < 0 for d in depths)
    for w in windows:
        assert w.peak < w.trough < w.recovery <= "2021-12-31"
        assert w.peak >= "2010-01-01"
    spent = constants.STRESS_WINDOW_SPENT
    assert spent.peak == "2021-12-31" and spent.trough.startswith("2022-") and spent.recovery is None
    assert "spent window" in spent.label


@pytest.mark.parametrize("path", DISPLAY_MODULES, ids=lambda p: p.name)
def test_display_code_has_no_date_literal(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    dated = [node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str)
             and any(node.value.startswith(y) for y in ("2010-", "2011-", "2015-", "2016-", "2018-", "2020-",
                                                        "2021-", "2022-"))]
    assert not dated, f"{path.name} carries window dates {dated}; windows come only from constants"


def test_born_failing_a_date_literal_is_caught():
    tree = ast.parse('WINDOW = ("2020-02-19", "2020-03-20")')
    found = [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)
             and n.value.startswith("2020-")]
    assert found

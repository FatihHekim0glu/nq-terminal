"""The web never asks for a bootstrap the API would refuse (TASKS Phase 10 on screen).

`/api/analytics/.../bootstrap` answers 422 below `analytics.bootstrap.MIN_N` observations, and a refused GET shows as a
console error in the browser. The tear sheet therefore asks only when its series has at least that many observations
and says why otherwise; its constant (`web/src/screens/tear/tearQueries.ts`, BOOTSTRAP_MIN_N) must equal the backend's.
Born failing: with the two numbers apart this test fails.
"""
from __future__ import annotations

import re
from pathlib import Path

from nq_terminal.analytics import bootstrap

WEB_QUERIES = Path(__file__).resolve().parents[2] / "web" / "src" / "screens" / "tear" / "tearQueries.ts"


def web_minimum(text: str) -> int:
    found = re.search(r"export const BOOTSTRAP_MIN_N = (\d+)\b", text)
    assert found, "tearQueries.ts has no BOOTSTRAP_MIN_N"
    return int(found.group(1))


def test_the_web_minimum_equals_the_backend_minimum():
    assert web_minimum(WEB_QUERIES.read_text(encoding="utf-8")) == bootstrap.MIN_N


def test_born_failing_a_different_number_is_caught():
    assert web_minimum("export const BOOTSTRAP_MIN_N = 20\n") != bootstrap.MIN_N

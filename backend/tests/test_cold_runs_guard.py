"""The cold-run tests check the lab's research files where the lab is built, not in a test that must run last."""
from __future__ import annotations

import ast
from pathlib import Path

SOURCE = Path(__file__).with_name("test_home_cold_runs.py")


def _tree() -> ast.Module:
    return ast.parse(SOURCE.read_text(encoding="utf-8"))


def test_the_grown_lab_fixture_checks_the_research_files_in_its_teardown():
    fixtures = [n for n in ast.walk(_tree()) if isinstance(n, ast.FunctionDef) and n.name == "grown"]
    assert len(fixtures) == 1
    body = ast.dump(fixtures[0])
    assert any(isinstance(n, ast.Yield) for n in ast.walk(fixtures[0])), "the fixture must yield, then check"
    assert body.count("_tree_digest") >= 2, "the digest is taken before and after"


def test_no_test_depends_on_running_last_or_on_a_module_global():
    names = [n.name for n in ast.walk(_tree()) if isinstance(n, ast.FunctionDef)]
    assert not [name for name in names if name.startswith("test_zz")]
    assert "_BEFORE" not in SOURCE.read_text(encoding="utf-8")

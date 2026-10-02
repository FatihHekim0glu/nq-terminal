"""The test-only fixture entry: `python -E -s -X utf8 -m nq_terminal.desktop.fixture_main` (W2A, review 1).

It serves the fixture lab (the synthetic prices and fake catalog of the browser fixture backend) through the same lock,
socket, stdin channel and NQT-READY line as `python -m nq_terminal`, so a test build's `--fixture` switch exercises the
real start path. It is honoured only when NQT_FIXTURE_DIR is set and resolves inside
`terminal/backend/tests/fixtures`; anything else is refused with exit code `EXIT_REFUSED` before any import of the
harness. `backend/tests/fixture_app.py` is loaded by its file path (`-E` makes Python ignore PYTHONPATH), with the tests
folder put on `sys.path` for its own imports, and `create_fixture_app` builds the app with the port bound here.

The release shell never launches this module: its spawn line is fixed to `-m nq_terminal`. The production code never
imports it.
"""
from __future__ import annotations

import importlib.util
import os
import sys
from collections.abc import Mapping
from pathlib import Path
from types import ModuleType

from fastapi import FastAPI

from nq_terminal.__main__ import serve
from nq_terminal.settings import FIXTURES_DIR, TERMINAL_DIR, Settings, load_settings

FIXTURE_ENV = "NQT_FIXTURE_DIR"
TESTS_DIR = TERMINAL_DIR / "backend" / "tests"
FIXTURE_APP = TESTS_DIR / "fixture_app.py"
EXIT_REFUSED = 2


class FixtureEntryError(ValueError):
    """NQT_FIXTURE_DIR is missing or names a folder outside terminal/backend/tests/fixtures."""


def fixture_folder(env: Mapping[str, str]) -> Path:
    """NQT_FIXTURE_DIR resolved strictly; refused unless it is the fixtures folder or inside it."""
    raw = (env.get(FIXTURE_ENV) or "").strip()
    if not raw:
        raise FixtureEntryError(f"{FIXTURE_ENV} is not set; the fixture entry serves only the fixture lab")
    try:
        folder = Path(raw).resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise FixtureEntryError(f"{FIXTURE_ENV} is not a folder: {raw}") from exc
    if not folder.is_dir() or not folder.is_relative_to(FIXTURES_DIR.resolve()):
        raise FixtureEntryError(f"{FIXTURE_ENV} must be inside {FIXTURES_DIR}: {folder}")
    return folder


def load_harness() -> ModuleType:
    """`backend/tests/fixture_app.py`, loaded by its file path."""
    if str(TESTS_DIR) not in sys.path:
        sys.path.insert(0, str(TESTS_DIR))
    spec = importlib.util.spec_from_file_location("nqt_fixture_app", FIXTURE_APP)
    if spec is None or spec.loader is None:
        raise FixtureEntryError(f"cannot load {FIXTURE_APP}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(env: Mapping[str, str] | None = None) -> int:
    source = dict(os.environ if env is None else env)
    try:
        fixture_folder(source)
    except FixtureEntryError as refused:
        print(f"nq_terminal fixture entry refused: {refused}", file=sys.stderr, flush=True)
        return EXIT_REFUSED
    harness = load_harness()
    prepared = harness.fixture_environment(source)  # its own state folder (never terminal/state), prewarm off

    def build(settings: Settings) -> FastAPI:
        return harness.create_fixture_app({**prepared, "NQT_PORT": str(settings.port)})

    return serve(load_settings(prepared), build)


if __name__ == "__main__":
    sys.exit(main())

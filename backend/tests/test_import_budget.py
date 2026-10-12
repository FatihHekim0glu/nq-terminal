"""Import budget of the start path (startup.md 7.4; metrics.md 2.1): modules only a late request needs stay unloaded.

A fresh interpreter imports `nq_terminal.app` and reports `sys.modules`. The modules below are used only by the RG2,
EX5 and MV6 handlers of `api/regimes_capacity_term.py` (and by nothing else on the start path), so they load on the first
request to one of those routes and not before. A second child proves the first such request still loads them and
answers.

`ResponseModel` builds its Pydantic schema on first use (`defer_build=True`, `models/common.py`): after `create_app` most
response models are still unbuilt, which is where the saving is (about 0.1 s of import and build, measured). A second
guard fails if FastAPI ever forces the build at route registration, since the saving would then vanish unseen.

Deliberately not on this list (the measurement said no, `docs/desktop/v04/w1-startup-backend__pre-ready.md`):
`nq_lab.sessions` and `exchange_calendars` (imported at module level by `services/research.py`, which `app.py`,
`api/audit.py` and `api/research.py` need), and everything `services/audit.py` imports (all of it is on the start path
through `api/audit.py` and `app.py` regardless).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

BACKEND = Path(__file__).resolve().parents[1]

LAZY_UNTIL_FIRST_USE = (
    "nq_terminal.services.regimes_capacity_term",
    "nq_terminal.analytics.capacity",
    "nq_terminal.analytics.term_structure",
    "nq_terminal.analytics.trend_regime",
)

IMPORT_SCRIPT = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
import nq_terminal.app  # noqa: F401
print(json.dumps(sorted(sys.modules)))
"""

FIRST_USE_SCRIPT = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
import nq_terminal.app  # noqa: F401
from fastapi import HTTPException
from nq_terminal.api import regimes_capacity_term as api
before = sorted(m for m in sys.modules if m in json.loads(sys.argv[2]))
try:
    api.market_term_structure("ZZ", services=None)
    status = None
except HTTPException as exc:
    status = exc.status_code
print(json.dumps({"before": before, "status": status, "after": sorted(m for m in sys.modules if m in json.loads(sys.argv[2]))}))
"""


def _env(state: Path) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("NQT_")}
    env.update({"NQT_STATE_DIR": str(state), "NQT_JOBS": "off", "PYTHONDONTWRITEBYTECODE": "1"})
    return env


def _run(script: str, args: list[str], tmp: Path) -> str:
    state = tmp / "state"
    state.mkdir(exist_ok=True)
    done = subprocess.run([sys.executable, "-c", script, str(BACKEND), *args], env=_env(state), cwd=str(tmp),
                          capture_output=True, text=True, encoding="utf-8", timeout=180,
                          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=False)
    assert done.returncode == 0, f"the child interpreter failed:\n{done.stderr[-3000:]}"
    return done.stdout.strip().splitlines()[-1]


@pytest.fixture(scope="module")
def loaded_after_app_import(tmp_path_factory: pytest.TempPathFactory) -> set[str]:
    return set(json.loads(_run(IMPORT_SCRIPT, [], tmp_path_factory.mktemp("import_budget"))))


@pytest.mark.parametrize("name", LAZY_UNTIL_FIRST_USE)
def test_the_module_is_absent_after_importing_the_app(loaded_after_app_import: set[str], name: str) -> None:
    """Born failing: `api/regimes_capacity_term.py` imported its service and analytics modules at the top."""
    assert name not in loaded_after_app_import, f"{name} loads before any request needs it"


def test_the_first_request_to_the_route_loads_them_and_answers(tmp_path: Path) -> None:
    report: dict[str, Any] = json.loads(_run(FIRST_USE_SCRIPT, [json.dumps(list(LAZY_UNTIL_FIRST_USE))], tmp_path))
    assert report["status"] == 404  # "ZZ" is outside the futures universe, known only to the service
    assert report["before"] == []
    assert set(report["after"]) == set(LAZY_UNTIL_FIRST_USE)


def test_the_lazy_modules_exist_and_import_here() -> None:
    """Guard for the guard: an absent module proves laziness only when the module can be imported."""
    import importlib

    for name in LAZY_UNTIL_FIRST_USE:
        importlib.import_module(name)


DEFER_SCRIPT = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
import nq_terminal.app as app_module
from dataclasses import replace
from nq_terminal.settings import load_settings
app_module.create_app(replace(load_settings(), port=54321))
from nq_terminal.models.common import ErrorDetail, ResponseModel

def subclasses(base):
    for sub in base.__subclasses__():
        yield sub
        yield from subclasses(sub)

models = list(dict.fromkeys(subclasses(ResponseModel)))
unbuilt = sum(1 for m in models if not m.__pydantic_complete__)
before = ErrorDetail.__pydantic_complete__
dumped = ErrorDetail(detail="x").model_dump()
print(json.dumps({"models": len(models), "unbuilt": unbuilt, "before": before, "dumped": dumped,
                  "after": ErrorDetail.__pydantic_complete__}))
"""


def test_response_models_stay_unbuilt_after_the_app_is_built_and_build_on_first_use(tmp_path: Path) -> None:
    """Born failing: every model built its schema when its module was imported."""
    report = json.loads(_run(DEFER_SCRIPT, [], tmp_path))
    assert report["models"] > 200
    assert report["unbuilt"] > report["models"] * 0.9, "FastAPI or a config change built the response models early"
    assert report["before"] is False and report["after"] is True
    assert report["dumped"] == {"detail": "x"}


# ---- the merge note must not credit pre-READY savings to the HOME stage ------------------------------------------------------------
# The prewarm (HOME) stage starts after READY and the first proof, so import and app-build savings shorten spawn to READY only;
# `defer_build=True` moves the schema builds of HOME's response models into the HOME window instead.

MERGE_NOTE = Path(__file__).resolve().parents[2] / "docs" / "desktop" / "v04" / "w1-startup-backend__merge.md"


def _estimate_paragraph() -> str:
    text = MERGE_NOTE.read_text(encoding="utf-8")
    start = text.index('"HOME stage 1.0 s or less on a first launch"')
    end = text.index("\n\n", start)
    return re.sub(r"\s+", " ", text[start:end])


def test_pre_ready_saving_is_not_credited_to_the_home_stage() -> None:
    paragraph = _estimate_paragraph()
    assert "0.2 s from the pre-READY work" not in paragraph


def test_pre_ready_saving_is_placed_before_ready_and_deferred_builds_in_the_home_window() -> None:
    paragraph = _estimate_paragraph()
    assert "spawn to READY" in paragraph
    assert "deferred" in paragraph and "HOME window" in paragraph

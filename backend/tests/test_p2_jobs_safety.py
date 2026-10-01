"""Static safety for the JOBS files (ARCHITECTURE sections 8 and 9), using the scanner of `test_safety_ast.py`.

Only `services/jobs.py` may start a process and write under the state folder, so it is the one module that needs
a `WRITE_ALLOWED` entry (the merge step adds it). The model and the router must scan clean with no allowance, and
no JOBS file may name an order call, import an IB client or the research scripts, or touch the sealed door.
"""
from __future__ import annotations

import re

import pytest

import test_safety_ast as rules

PACKAGE = rules.PACKAGE
SERVICE = "backend/nq_terminal/services/jobs.py"
JOB_FILES = {"services/jobs.py": SERVICE, "models/jobs.py": "backend/nq_terminal/models/jobs.py",
             "api/jobs.py": "backend/nq_terminal/api/jobs.py"}


def source(relative: str) -> str:
    return (PACKAGE / relative).read_text(encoding="utf-8")


def test_the_service_is_flagged_only_for_its_process_and_state_writes(monkeypatch) -> None:
    monkeypatch.setattr(rules, "WRITE_ALLOWED", frozenset())
    found = rules.scan_source(source("services/jobs.py"), SERVICE, rules.PROD)
    assert {v.rule for v in found} == {"write"}, [str(v) for v in found]


def test_the_service_scans_clean_on_the_write_allow_list() -> None:
    assert SERVICE in rules.WRITE_ALLOWED
    assert rules.scan_source(source("services/jobs.py"), SERVICE, rules.PROD) == []


@pytest.mark.parametrize("relative", ["models/jobs.py", "api/jobs.py"])
def test_the_model_and_the_router_need_no_write_allowance(relative: str) -> None:
    assert rules.scan_source(source(relative), JOB_FILES[relative], rules.PROD) == []


def test_only_the_service_may_be_on_the_allow_list() -> None:
    assert rules.WRITE_ALLOWED == {SERVICE}


def test_the_service_never_starts_a_shell_or_runs_anything_but_the_runner() -> None:
    text = source("services/jobs.py")
    assert "shell=True" not in text and "os.system" not in text and "subprocess.run" not in text
    assert text.count("Popen") >= 1 and "run_base.py" in text


@pytest.mark.parametrize("relative", sorted(JOB_FILES))
def test_no_job_file_names_an_order_call_or_a_banned_import(relative: str) -> None:
    text = source(relative)
    names = re.compile(r"\b(" + "|".join(sorted(rules.ORDER_NAMES)) + r")\b")
    assert not names.findall(text)
    for banned in ("ibapi", "nautilus_trader.live", "interactive_brokers", "ledger" + "_append", "serve" + "_sealed",
                   "scripts."):
        assert banned not in text, banned


def test_the_service_never_writes_where_the_research_files_live() -> None:
    text = source("services/jobs.py")
    for folder in ("results", "ledger", "registry.csv", "oos_openings", "live/"):
        assert f'"{folder}' not in text and f"'{folder}" not in text
    assert "backtests" in text  # read only: the runner path and an exists() check on the output folder
    assert "output" in text and not re.search(r"output.*\.(mkdir|write_text|unlink|rmdir)\(", text)


def test_state_is_written_only_inside_the_state_folder() -> None:
    text = source("services/jobs.py")
    writes = re.findall(r"\.(write_text|write_bytes|mkdir|replace|unlink)\(", text)
    assert writes, "the service is expected to persist state"
    assert "state_dir" in text and "STATE_FILE" in text

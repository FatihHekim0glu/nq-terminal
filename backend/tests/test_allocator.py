"""Arrow uses the platform allocator in every form (W5C D2).

pyarrow's default pool on Windows is mimalloc, which keeps its high-water mark after a load: a year of 1m bars read
and dropped left its pages with the process. `create_app` calls `services.allocator.use_system_pool()` first, so every
form (`python -m nq_terminal`, the fixture entry, the uvicorn factories and the tests) hands freed memory back to the
operating system. The call is idempotent, never raises (it logs once when pyarrow refuses), writes no file and starts
no process. No environment variable is involved, so the shell's allow-list needs none.
"""
from __future__ import annotations

import logging

import pyarrow as pa
import pytest

from nq_terminal.app import create_app
from nq_terminal.services import allocator
from nq_terminal.settings import load_settings

from fakes import FIXTURES

SYSTEM = "system"


def other_pool() -> pa.MemoryPool:
    """A pool that is not the system one (mimalloc where this pyarrow has it, else jemalloc)."""
    for make in (pa.mimalloc_memory_pool, pa.jemalloc_memory_pool):
        try:
            return make()
        except (NotImplementedError, pa.ArrowNotImplementedError):
            continue
    pytest.skip("this pyarrow build has no pool other than the system one")


@pytest.fixture
def non_system_pool():
    setter = pa.set_memory_pool  # kept: a test may patch it, and the shared monkeypatch outlives this fixture
    setter(other_pool())
    assert pa.default_memory_pool().backend_name != SYSTEM
    yield
    setter(pa.system_memory_pool())  # what every app in this process uses


@pytest.fixture
def fresh_warning(monkeypatch):
    monkeypatch.setattr(allocator, "_warned", False)


def test_create_app_sets_system_pool(non_system_pool):
    create_app(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)}))
    assert pa.default_memory_pool().backend_name == SYSTEM


def test_use_system_pool_switches_a_non_system_pool(non_system_pool):
    assert allocator.use_system_pool() is True
    assert pa.default_memory_pool().backend_name == SYSTEM


def test_use_system_pool_idempotent(non_system_pool, monkeypatch):
    allocator.use_system_pool()
    calls = []
    monkeypatch.setattr(pa, "set_memory_pool", lambda pool: calls.append(pool))
    assert allocator.use_system_pool() is True
    assert allocator.use_system_pool() is True
    assert calls == [] and pa.default_memory_pool().backend_name == SYSTEM


def test_a_refusal_never_raises_and_is_logged_once(non_system_pool, fresh_warning, monkeypatch, caplog):
    def refuse(pool):
        raise RuntimeError("pool refused")

    monkeypatch.setattr(pa, "set_memory_pool", refuse)
    with caplog.at_level(logging.WARNING, logger=allocator.LOG.name):
        assert allocator.use_system_pool() is False
        assert allocator.use_system_pool() is False
    warnings = [r for r in caplog.records if r.name == allocator.LOG.name]
    assert len(warnings) == 1 and "pool refused" in warnings[0].getMessage()


def test_a_silent_no_op_switch_is_logged_once_with_the_pool_left_in_place(
    non_system_pool, fresh_warning, monkeypatch, caplog
):
    before = pa.default_memory_pool().backend_name
    monkeypatch.setattr(pa, "set_memory_pool", lambda pool: None)  # returns without raising and changes nothing
    with caplog.at_level(logging.WARNING, logger=allocator.LOG.name):
        assert allocator.use_system_pool() is False
        assert allocator.use_system_pool() is False
    warnings = [r for r in caplog.records if r.name == allocator.LOG.name]
    assert len(warnings) == 1
    message = warnings[0].getMessage()
    assert before in message and "set_memory_pool" in message


def test_create_app_leaves_the_refusal_in_the_log(non_system_pool, fresh_warning, monkeypatch, caplog):
    monkeypatch.setattr(pa, "set_memory_pool", lambda pool: None)
    with caplog.at_level(logging.WARNING, logger=allocator.LOG.name):
        create_app(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)}))
    assert [r for r in caplog.records if r.name == allocator.LOG.name]


def test_the_module_names_no_environment_variable():
    source = allocator.__file__
    with open(source, encoding="utf-8") as handle:
        text = handle.read()
    assert "ARROW_DEFAULT_MEMORY_POOL" not in text
    assert "os.environ" not in text and "getenv" not in text and "import os" not in text

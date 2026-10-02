"""The desktop file-cache cap (03 section 2.6, item 1.5b): 128 MiB in desktop mode, each cache's own size otherwise.

`settings.file_cache_bytes` is 128 MiB in desktop mode and None in the browser terminal. Every FileCache an app builds
from its settings must honour it; a cache that asks for less keeps its own smaller size.
"""
from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from nq_terminal.api import audit, data, events, live
from nq_terminal.app import create_app
from nq_terminal.services import files, research
from nq_terminal.services.files import FileCache, file_cache
from nq_terminal.services.runs import CACHE_BYTES
from nq_terminal.api.runs import run_service_for
from nq_terminal.settings import load_settings

DESKTOP_CAP = 128 * 1024**2


def _state(settings):
    return SimpleNamespace(settings=settings)


def _request(settings):
    return SimpleNamespace(app=SimpleNamespace(state=_state(settings)))


def _events_cache(settings):
    """The calendar read builds the cache first, then fails on the empty data root; the cache stays on the state."""
    request = _request(settings)
    with pytest.raises(HTTPException):
        events._calendar(request)
    return getattr(request.app.state, events.FILES_STATE)


@pytest.fixture
def desktop(tmp_path):
    return replace(load_settings({}), file_cache_bytes=DESKTOP_CAP, root=tmp_path)


@pytest.fixture
def browser(tmp_path):
    return replace(load_settings({}), file_cache_bytes=None, root=tmp_path)


def test_the_helper_caps_a_larger_request_and_keeps_a_smaller_one(tmp_path):
    assert file_cache(DESKTOP_CAP, roots=[tmp_path]).max_bytes == DESKTOP_CAP
    assert file_cache(DESKTOP_CAP, roots=[tmp_path], max_bytes=CACHE_BYTES).max_bytes == DESKTOP_CAP
    assert file_cache(DESKTOP_CAP, roots=[tmp_path], max_bytes=1024).max_bytes == 1024


def test_without_a_cap_the_helper_changes_nothing(tmp_path):
    assert file_cache(None, roots=[tmp_path]).max_bytes == files.DEFAULT_MAX_BYTES
    assert file_cache(None, roots=[tmp_path], max_bytes=CACHE_BYTES).max_bytes == CACHE_BYTES
    assert FileCache(roots=[tmp_path]).max_bytes == files.DEFAULT_MAX_BYTES


@pytest.mark.parametrize(("make", "label"), [
    (lambda s: audit._files(_request(s)), "audit"),
    (lambda s: _events_cache(s), "events"),
    (lambda s: live._files(_request(s)), "live"),
    (lambda s: data.build_services(s, lambda *a, **k: None).files, "data"),
    (lambda s: run_service_for(_state(s)).cache, "runs"),
])
def test_every_cache_built_from_the_settings_honours_the_desktop_cap(desktop, make, label):
    assert make(desktop).max_bytes == DESKTOP_CAP, label


@pytest.mark.parametrize(("make", "expected"), [
    (lambda s: audit._files(_request(s)), files.DEFAULT_MAX_BYTES),
    (lambda s: live._files(_request(s)), files.DEFAULT_MAX_BYTES),
    (lambda s: data.build_services(s, lambda *a, **k: None).files, files.DEFAULT_MAX_BYTES),
    (lambda s: run_service_for(_state(s)).cache, CACHE_BYTES),
])
def test_the_browser_terminal_keeps_each_cache_its_own_size(browser, make, expected):
    assert make(browser).max_bytes == expected


def _file_caches(*owners):
    """Every FileCache reachable one level down from the given objects (services keep theirs on `.cache`/`.files`)."""
    found = []
    for owner in owners:
        for value in (owner, *vars(owner).values()):
            if isinstance(value, FileCache):
                found.append(value)
    return found


@pytest.fixture
def research_cap_reset():
    """The research services are shared per data root for the process; leave them as the browser terminal has them."""
    yield
    research.set_file_cache_cap(None)


def test_the_research_service_cache_honours_the_desktop_cap(desktop, research_cap_reset):
    create_app(desktop)
    assert research.service_for_root(desktop.data_root).cache.max_bytes == DESKTOP_CAP


def test_an_app_in_desktop_mode_holds_no_file_cache_above_the_cap(desktop, research_cap_reset):
    """Walks the app's services: the run service, the research service it reads through, and the per-root one."""
    app = create_app(desktop)
    runs_service = run_service_for(app.state)
    owners = [runs_service, runs_service.research, research.service_for_root(desktop.data_root)]
    caches = _file_caches(*owners)
    assert len(caches) >= 3
    assert all(cache.max_bytes <= DESKTOP_CAP for cache in caches)


def test_the_browser_terminal_keeps_the_research_cache_its_own_size(browser, research_cap_reset):
    create_app(browser)
    assert research.service_for_root(browser.data_root).cache.max_bytes == files.DEFAULT_MAX_BYTES


def test_a_new_cap_replaces_services_built_under_the_old_one(desktop, browser, research_cap_reset):
    create_app(browser)
    first = research.service_for_root(browser.data_root)
    create_app(desktop)
    assert research.service_for_root(desktop.data_root) is not first

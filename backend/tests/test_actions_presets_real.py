"""Launch presets over the real lab (read only): the volmanaged_bh preset and the spec hashes.

The real ledger's volmanaged_bh row (`nt_volmanaged_v0_final_bh1`) records `t0`, the first session the sizing feed
holds (`nq_lab.sizing_nt`). `t0` is a feed key of volmanaged_bh (`models.jobs.FEED_PARAM_KEYS`), so the preset is
launchable as it stands; a `t0` at or after 2022-01-01, or before 2010-01-01, is refused by the launch rules and by
the job spec. Without `t0` as a feed key the same preset is refused (the broken state the guard must catch).

Each real preset carries the sha256 of `experiments/<exp_id>.json` when that file exists and None when it does not.
Nothing the terminal reads under `experiments/` or `results/` changes: the spec files are byte-identical before
and after and the session guard records no write. The folders are not hashed whole (research writes them live).
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from nq_lab.config import ROOT
from nq_terminal.models import jobs as jobs_models
from nq_terminal.services import presets as presets_service
from nq_terminal.services.runs import RunService

from test_runs_support import FakeClock

LEDGER = ROOT / "results" / "ledger.csv"
EXPERIMENTS = ROOT / "experiments"
pytestmark = pytest.mark.skipif(not LEDGER.is_file(), reason="the lab's ledger is not on this machine")


def real_runs() -> RunService:
    return RunService(data_root=ROOT, project_root=ROOT, clock=FakeClock())


def digest(folder: Path) -> dict[str, str]:
    """Every file under `folder` (relative path -> sha256 of its bytes)."""
    return {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.rglob("*")) if p.is_file()}


@pytest.fixture(scope="module")
def listing():
    return presets_service.list_presets(real_runs())


@pytest.fixture(scope="module")
def bh(listing):
    found = [p for p in listing.presets if p.strategy == "volmanaged_bh"]
    if not found:
        pytest.skip("the real ledger holds no volmanaged_bh row")
    return found[0]


def reasons_with_t0(preset, t0: str) -> list[str]:
    params = {**preset.params, "t0": t0}
    return presets_service.spec_reasons(preset.strategy, params, preset.variant, preset.start, preset.end)


def test_the_real_volmanaged_bh_preset_is_launchable_with_its_in_sample_t0(bh) -> None:
    assert "t0" in bh.params and "2010-01-01" <= bh.params["t0"] < "2022-01-01"
    assert bh.launchable is True and bh.reasons == []


@pytest.mark.parametrize("t0", ["2010-01-01", "2010-01-04", "2021-12-31"])
def test_an_in_sample_t0_keeps_the_real_preset_launchable(bh, t0) -> None:
    assert reasons_with_t0(bh, t0) == []


@pytest.mark.parametrize("t0", ["2022-01-01", "2022-01-03", "2026-10-05", "2009-12-31", "2001-01-02"])
def test_a_t0_outside_the_in_sample_window_is_refused(bh, t0) -> None:
    reasons = reasons_with_t0(bh, t0)
    assert reasons and all("t0" in reason for reason in reasons)


@pytest.mark.parametrize("t0", ["2021-13-01", "2011-04", "20110421", 20110421])
def test_a_t0_that_is_not_an_iso_date_is_refused(bh, t0) -> None:
    assert any("t0" in reason for reason in reasons_with_t0(bh, t0))


def test_without_t0_as_a_feed_key_the_real_preset_is_refused(bh, monkeypatch) -> None:
    """Rule 5: the broken state (volmanaged_bh's feed keys without t0) refuses the real preset, so the launchable
    result above rests on the feed key and not on a check that never runs."""
    monkeypatch.setitem(jobs_models.FEED_PARAM_KEYS, "volmanaged_bh", ("ticks",))
    broken = presets_service.find_preset(real_runs(), bh.preset_id)
    assert broken.launchable is False
    assert any("t0" in reason for reason in broken.reasons)


def test_real_presets_carry_the_sha256_of_their_spec_file_or_none(listing) -> None:
    assert listing.presets
    with_spec = 0
    for preset in listing.presets:
        path = EXPERIMENTS / f"{preset.exp_id}.json" if preset.exp_id else None
        if path is not None and path.is_file():
            assert preset.spec_sha256 == hashlib.sha256(path.read_bytes()).hexdigest(), preset.preset_id
            with_spec += 1
        else:
            assert preset.spec_sha256 is None, preset.preset_id
    assert with_spec > 0


def test_the_real_volmanaged_bh_preset_is_bound_to_its_spec(bh) -> None:
    path = EXPERIMENTS / f"{bh.exp_id}.json"
    if not path.is_file():
        pytest.skip("the volmanaged_bh row's spec file is not on this machine")
    assert bh.spec_sha256 == hashlib.sha256(path.read_bytes()).hexdigest()


def spec_digest(listing) -> dict[str, str]:
    """sha256 of the spec file of each listed preset: the only files under experiments/ the preset code reads."""
    paths = {EXPERIMENTS / f"{p.exp_id}.json" for p in listing.presets if p.exp_id}
    return {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths) if path.is_file()}


def assert_listing_wrote_nothing(bh, listing, research_files_guard) -> None:
    """No whole-folder digest: research workflows write results/ and experiments/ concurrently. The session guard
    refuses and records any write this process makes under its protected folders, and the files the preset code
    reads are compared by content."""
    specs, blocked = spec_digest(listing), list(research_files_guard.blocked)
    runs = real_runs()
    presets_service.list_presets(runs)
    presets_service.find_preset(runs, bh.preset_id)
    reasons_with_t0(bh, "2022-01-03")
    assert spec_digest(listing) == specs
    assert research_files_guard.blocked == blocked


def test_listing_real_presets_writes_nothing_under_experiments_or_results(bh, listing, research_files_guard) -> None:
    assert_listing_wrote_nothing(bh, listing, research_files_guard)


def test_the_no_write_check_reads_only_the_ledger_and_the_spec_files(bh, listing, research_files_guard, monkeypatch) -> None:
    """A research workflow appends to results/ (the 41 MB access log) and writes experiments/ while the tests run, so
    a check that hashes whole folders fails falsely: it may read the ledger and spec files, nothing else."""
    read: list[Path] = []
    original = Path.read_bytes

    def recording(self: Path) -> bytes:
        read.append(self)
        return original(self)

    monkeypatch.setattr(Path, "read_bytes", recording)
    assert_listing_wrote_nothing(bh, listing, research_files_guard)
    monkeypatch.undo()
    stray = [p for p in read if p != LEDGER and p.parent != EXPERIMENTS]
    assert stray == [], [p.as_posix() for p in stray[:5]]
    assert all(p.suffix == ".json" for p in read if p.parent == EXPERIMENTS)

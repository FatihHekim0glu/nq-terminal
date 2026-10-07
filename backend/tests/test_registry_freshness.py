"""V031: registry freshness on `/api/registry`, read only.

The registry response says when the registry was last written and whether a result or spec it is built from is newer:
- `generated_at`: the modification time of `results/registry.md` (UTC, to the second), null when the file is missing;
- `newest_input_at` and `newest_input_path`: the newest modification time among `results/screens/*.json` and
  `experiments/*.json` (drafts excluded: nothing under a subfolder such as `experiments/drafts/`, and no `*.draft.*`
  name), with that file's path under the data root; both null when there is no such file;
- `stale`: true only when both times are known and the newest input is newer than the registry.

REG shows a banner from `stale`; the default look does not change when it is false. Nothing here writes a research
file: the fixture labs are built under pytest's tmp_path, and the real lab's results/ and experiments/ files are the
same, byte for byte and to the nanosecond of their modification times, after the real-lab reads.
"""
from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest

from nq_lab.config import ROOT
from nq_terminal.app import create_app
from nq_terminal.services.registry_freshness import registry_freshness
from nq_terminal.services.research import ResearchService
from nq_terminal.settings import load_settings

from conftest import api_client
from test_research_support import build_root

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
NAME = "overnight_v0"
SCREEN = f"results/screens/{NAME}.json"
BASE_NS = 1_780_000_000 * 10**9  # 2026-05-28 20:26:40 UTC: every fixture file starts here
STEP_NS = 60 * 10**9
FIELDS = ("generated_at", "newest_input_at", "newest_input_path", "stale")


def iso(ns: int) -> str:
    return datetime.fromtimestamp(ns / 1e9, tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def set_mtime(root: Path, relative: str, ns: int) -> None:
    os.utime(root / relative, ns=(ns, ns))


def write(root: Path, relative: str, text: str, ns: int) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    set_mtime(root, relative, ns)


@pytest.fixture
def lab(tmp_path: Path) -> Path:
    """A research root with one registry row, its screen and spec, and a registry.md; every file at BASE_NS."""
    root = build_root(tmp_path / "lab", (NAME,))
    write(root, "results/registry.md", "# Registry\n", BASE_NS)
    for path in root.rglob("*"):
        if path.is_file():
            os.utime(path, ns=(BASE_NS, BASE_NS))
    return root


def spec_of(root: Path) -> str:
    specs = sorted(p.name for p in (root / "experiments").glob("*.json"))
    assert specs, "the fixture lab has a spec"
    return f"experiments/{specs[0]}"


def snapshot(*folders: Path) -> dict[str, tuple[int, int, str]]:
    """{path: (size, mtime_ns, sha256)} for every file under the folders."""
    out: dict[str, tuple[int, int, str]] = {}
    for folder in folders:
        for path in sorted(folder.rglob("*")):
            if path.is_file():
                stat = path.stat()
                out[str(path)] = (stat.st_size, stat.st_mtime_ns, hashlib.sha256(path.read_bytes()).hexdigest())
    return out


# ---------------------------------------------------------------- the service


def test_born_failing_a_registry_newer_than_every_input_is_fresh(lab):
    write(lab, "results/registry.md", "# Registry\n", BASE_NS + 2 * STEP_NS)
    set_mtime(lab, SCREEN, BASE_NS + STEP_NS)
    view = ResearchService(lab).registry()
    assert view.generated_at == iso(BASE_NS + 2 * STEP_NS)
    assert (view.newest_input_at, view.newest_input_path) == (iso(BASE_NS + STEP_NS), SCREEN)
    assert view.stale is False


def test_born_failing_a_screen_written_after_the_registry_makes_it_stale(lab):
    set_mtime(lab, SCREEN, BASE_NS + 3 * STEP_NS)
    view = ResearchService(lab).registry()
    assert view.generated_at == iso(BASE_NS)
    assert (view.newest_input_at, view.newest_input_path) == (iso(BASE_NS + 3 * STEP_NS), SCREEN)
    assert view.stale is True


def test_a_spec_written_after_the_registry_makes_it_stale_and_is_named(lab):
    spec = spec_of(lab)
    set_mtime(lab, SCREEN, BASE_NS + STEP_NS)
    set_mtime(lab, spec, BASE_NS + 5 * STEP_NS)
    fresh = registry_freshness(lab)
    assert (fresh.newest_input_path, fresh.stale) == (spec, True)


def test_drafts_are_not_inputs(lab):
    write(lab, "experiments/drafts/next_v0.json", "{}\n", BASE_NS + 9 * STEP_NS)
    write(lab, "experiments/next_v0.DRAFT.json", "{}\n", BASE_NS + 9 * STEP_NS)
    write(lab, "results/screens/next_v0.draft.json", "{}\n", BASE_NS + 9 * STEP_NS)
    write(lab, "results/registry.md", "# Registry\n", BASE_NS + STEP_NS)
    fresh = registry_freshness(lab)
    assert fresh.newest_input_at == iso(BASE_NS) and fresh.stale is False
    assert "draft" not in (fresh.newest_input_path or "").lower()


def test_other_files_are_not_inputs(lab):
    """Only the screens' and specs' JSON counts: a CSV, a hash file or a run log written later changes nothing."""
    for relative in ("results/screens/x_monthly.csv", "experiments/x_v0.sha256", "results/screens/x_run_log.jsonl",
                     "results/ledger.csv"):
        write(lab, relative, "x\n", BASE_NS + 9 * STEP_NS)
    write(lab, "results/registry.md", "# Registry\n", BASE_NS + STEP_NS)
    assert registry_freshness(lab).stale is False


def test_an_equal_time_is_not_stale(lab):
    assert registry_freshness(lab).stale is False


def test_a_missing_registry_report_is_unknown_never_stale(lab):
    (lab / "results" / "registry.md").unlink()
    set_mtime(lab, SCREEN, BASE_NS + STEP_NS)
    fresh = registry_freshness(lab)
    assert fresh.generated_at is None and fresh.newest_input_path == SCREEN and fresh.stale is False


def test_no_inputs_is_never_stale(tmp_path):
    write(tmp_path, "results/registry.md", "# Registry\n", BASE_NS)
    fresh = registry_freshness(tmp_path)
    assert fresh.generated_at == iso(BASE_NS)
    assert (fresh.newest_input_at, fresh.newest_input_path, fresh.stale) == (None, None, False)


def test_the_freshness_reads_change_no_file(lab):
    set_mtime(lab, SCREEN, BASE_NS + STEP_NS)
    before = snapshot(lab)
    for _ in range(3):
        ResearchService(lab).registry()
        registry_freshness(lab)
    assert snapshot(lab) == before


# ---------------------------------------------------------------- the route


def test_born_failing_the_registry_route_serves_the_freshness(lab):
    set_mtime(lab, SCREEN, BASE_NS + STEP_NS)
    with api_client(create_app(load_settings({"NQT_FIXTURE_DIR": str(lab)})), base_url=LOCAL,
                    client=LOOPBACK) as client:
        body = client.get("/api/registry").json()
    assert {key: body[key] for key in FIELDS} == {
        "generated_at": iso(BASE_NS), "newest_input_at": iso(BASE_NS + STEP_NS), "newest_input_path": SCREEN,
        "stale": True}
    assert body["counts"]["rows"] == 1 and len(body["rows"]) == 1  # the rest of the view is unchanged


def test_the_freshness_fields_are_in_the_contract():
    schema = create_app(load_settings({})).openapi()["components"]["schemas"]["RegistryView"]
    assert set(FIELDS) <= set(schema["properties"]) and set(FIELDS) <= set(schema.get("required", []))


def test_the_real_lab_registry_answers_with_its_freshness_and_writes_nothing():
    folders = (ROOT / "results" / "screens", ROOT / "experiments")
    watched = [ROOT / "results" / "registry.md", ROOT / "results" / "registry.csv"]
    before = snapshot(*folders), {str(p): p.stat().st_mtime_ns for p in watched if p.exists()}
    with api_client(create_app(load_settings({})), base_url=LOCAL, client=LOOPBACK) as client:
        response = client.get("/api/registry")
    if response.status_code == 503:  # the registry is being rebuilt at this moment
        pytest.skip("results/registry.csv is half written")
    body = response.json()
    assert set(FIELDS) <= set(body)
    if (ROOT / "results" / "registry.md").exists():
        assert body["generated_at"] is not None
    if body["newest_input_path"] is not None:
        assert body["newest_input_path"].startswith(("results/screens/", "experiments/"))
        assert not Path(body["newest_input_path"]).is_absolute() and "\\" not in body["newest_input_path"]
    assert (snapshot(*folders), {str(p): p.stat().st_mtime_ns for p in watched if p.exists()}) == before

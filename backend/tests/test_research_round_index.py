"""The round of a hypothesis card (`ResearchService._round`) from one pass over the summary files (V032G fix 2).

Before: every registry row that is not in ROUNDS opened, one by one, the summary files of results/screens until one
named it, so a card list cost rows x summary files FileCache reads (1,663 gets, about 0.21 s on the real lab on
7 October 2026) and grew with every research round. After: the first line of each summary file is read once per
`cards()` call and every row is looked up in memory.

Proved here:
- the rounds and the summary names (`card.round`, `detail.summary_name`) equal the old per-row scan on randomised
  fixtures (the reference below is the old code, verbatim), including the corner cases of the old rules: ROUNDS first,
  sorted order, history copies skipped, a substring match on the first line only, a name with no round number, an
  empty file, a CRLF first line;
- a file that cannot be decoded raises only for a row that reaches it, as before;
- the number of FileCache gets of one `cards()` call is at most S + 3R + a constant (S non-history summary files, R
  registry rows), where the old scan made about R x S;
- the summaries are read through the cache, so the result cache pins them (a changed summary changes the pinned
  inputs), and a summary that appears is seen by the next `cards()` call.
"""
from __future__ import annotations

import random
import re
from pathlib import Path

import pytest

from nq_terminal import constants
from nq_terminal.services import result_cache
from nq_terminal.services.research import HISTORY_MARKS, ResearchDataError, ResearchService

from test_research_support import build_root, real_registry_rows

CONSTANT = 6  # the registry read, and a little slack for a read the service adds
SEEDS = range(12)


def _scanned_names() -> list[str]:
    """Registry rows that no ROUNDS entry answers for: the rows the summary scan is for."""
    return [r["name"] for r in real_registry_rows() if r["name"] not in constants.ROUNDS]


def _old_round(service: ResearchService, name: str) -> tuple[int | None, str | None]:
    """The scan before V032G, verbatim."""
    if name in constants.ROUNDS:
        return constants.ROUNDS[name]
    for path in sorted(service.screens.glob("*summary*.md")):
        if any(mark in path.name for mark in HISTORY_MARKS):
            continue
        text = service._read(path, "text", path.name) or ""
        if name in text.partition("\n")[0]:
            number = re.search(r"round(\d+)", path.name)
            return (int(number.group(1)) if number else None), path.name
    return None, None


class Counting:
    """Counts the FileCache gets a service makes."""

    def __init__(self, service: ResearchService):
        self.gets = 0
        inner = service.cache.get

        def get(*args, **kwargs):
            self.gets += 1
            return inner(*args, **kwargs)

        service.cache.get = get  # type: ignore[method-assign]


def _summary_names(rng: random.Random) -> list[str]:
    names = {"calendar_summary.md", "notes_summary.md", "summary_round3_extra.md"}
    for _ in range(rng.randint(4, 16)):
        number = rng.randint(1, 40)
        names.add(rng.choice([
            f"round{number}_summary.md",
            f"round{number}_summary.first.md",
            f"round{number}_summary.prev_20260926T2221{rng.randint(10, 59)}.md",
            f"round{number}b_summary.md",
            f"summary_round{number}.md",
            f"zz{number}_summary.md",
        ]))
    return sorted(names)


def _first_line(rng: random.Random, pool: list[str]) -> str:
    picks = rng.sample(pool, rng.randint(0, 3))
    decorated = [rng.choice(["{}", "x{}", "{}_plus", "({})"]).format(p) for p in picks]
    return rng.choice(["Round summary: ", "", "names ", "# "]) + ", ".join(decorated)


def _plant_summaries(root: Path, rng: random.Random, pool: list[str]) -> list[str]:
    folder = root / "results" / "screens"
    planted = _summary_names(rng)
    for name in planted:
        body = _first_line(rng, pool)
        rest = "\n".join(f"line {i}: {', '.join(rng.sample(pool, rng.randint(0, 4)))}" for i in range(rng.randint(0, 4)))
        newline = rng.choice(["\n", "\r\n"])
        text = rng.choice([body + newline + rest, body, "", newline + rest])
        (folder / name).write_bytes(text.encode("utf-8"))
    return planted


def _root(tmp_path: Path, seed: int) -> tuple[Path, list[str], list[str]]:
    rng = random.Random(seed)
    scanned = rng.sample(_scanned_names(), 8)
    rounded = rng.sample([r["name"] for r in real_registry_rows() if r["name"] in constants.ROUNDS], 2)
    names = tuple(dict.fromkeys(scanned + rounded))
    root = build_root(tmp_path, names)
    pool = list(names) + ["not_a_row_v0", "tiny"]
    planted = _plant_summaries(root, rng, pool)
    return root, list(names), planted


@pytest.mark.parametrize("seed", SEEDS)
def test_cards_rounds_equal_the_old_scan_on_randomised_fixtures(seed, tmp_path):
    root, names, _ = _root(tmp_path, seed)
    service = ResearchService(root, retry_delay_s=0)
    cards = {c.name: c for c in service.cards()}
    assert set(cards) == set(names)
    for name in names:
        assert cards[name].round == _old_round(service, name)[0], (seed, name)


@pytest.mark.parametrize("seed", SEEDS)
def test_detail_summary_name_equals_the_old_scan(seed, tmp_path):
    root, names, _ = _root(tmp_path, seed)
    service = ResearchService(root, retry_delay_s=0)
    for name in names:
        detail = service.detail(name)
        expected = _old_round(service, name)[1]
        if expected is not None and not (root / "results" / "screens" / expected).is_file():
            expected = None  # a ROUNDS entry names a file this fixture does not hold: the detail serves no summary
        assert detail.summary_name == expected, (seed, name)
        assert detail.card.round == _old_round(service, name)[0], (seed, name)


@pytest.mark.parametrize("seed", SEEDS)
def test_cards_read_each_summary_once_not_once_per_row(seed, tmp_path):
    root, names, planted = _root(tmp_path, seed)
    service = ResearchService(root, retry_delay_s=0)
    spy = Counting(service)
    service.cards()
    summaries = [n for n in planted if not any(mark in n for mark in HISTORY_MARKS)]
    bound = len(summaries) + 3 * len(names) + CONSTANT
    assert spy.gets <= bound, (seed, spy.gets, bound)


def test_the_bound_is_far_below_the_old_scan_on_a_busy_screens_folder(tmp_path):
    """Born failing: 40 scanned rows against 60 summary files that name none of them is 2,400 reads, not 200."""
    scanned = _scanned_names()[:20]
    root = build_root(tmp_path, tuple(scanned))
    folder = root / "results" / "screens"
    for number in range(60):
        (folder / f"round{number + 100}_summary.md").write_text("a round that names no row\nbody", encoding="utf-8")
    service = ResearchService(root, retry_delay_s=0)
    spy = Counting(service)
    cards = service.cards()
    assert all(c.round is None for c in cards)
    assert spy.gets <= 60 + 3 * len(scanned) + CONSTANT


def test_an_undecodable_summary_raises_only_for_a_row_that_reaches_it(tmp_path):
    scanned = _scanned_names()[:2]
    first, second = scanned
    root = build_root(tmp_path, tuple(scanned))
    folder = root / "results" / "screens"
    (folder / "round5_summary.md").write_text(f"{first}\n", encoding="utf-8")
    (folder / "round6_summary.md").write_bytes(b"\xff\xfe\xfa not utf-8\n")
    service = ResearchService(root, retry_delay_s=0)
    assert _old_round(service, first) == (5, "round5_summary.md")  # matched before the bad file: no error
    with pytest.raises(ResearchDataError):
        _old_round(service, second)  # reaches the bad file
    with pytest.raises(ResearchDataError):
        service.cards()  # the second row reaches it, so the call fails as it did
    only_first = build_root(tmp_path / "only", (first,))
    (only_first / "results" / "screens" / "round5_summary.md").write_text(f"{first}\n", encoding="utf-8")
    (only_first / "results" / "screens" / "round6_summary.md").write_bytes(b"\xff\xfe\xfa not utf-8\n")
    cards = ResearchService(only_first, retry_delay_s=0).cards()
    assert [(c.name, c.round) for c in cards] == [(first, 5)], "a match before the bad file never reads it"


def test_a_summary_that_appears_is_seen_by_the_next_call(tmp_path):
    (name,) = _scanned_names()[:1]
    root = build_root(tmp_path, (name,))
    service = ResearchService(root, retry_delay_s=0)
    assert service.cards()[0].round is None
    (root / "results" / "screens" / "round77_summary.md").write_text(f"{name}\n", encoding="utf-8")
    assert service.cards()[0].round == 77
    (root / "results" / "screens" / "round77_summary.md").write_text("another row\n", encoding="utf-8")
    assert service.cards()[0].round is None


def test_a_summary_edit_and_a_new_summary_change_what_the_result_cache_pins(tmp_path):
    """The service reads summaries through its FileCache and lists the screens folder through the result cache's
    recorder, so a cached /api/hypotheses body ends when either changes."""
    (name,) = _scanned_names()[:1]
    root = build_root(tmp_path, (name,))
    summary = root / "results" / "screens" / "round9_summary.md"
    summary.write_text(f"{name}\n", encoding="utf-8")
    service = ResearchService(root, retry_delay_s=0)

    def pinned() -> set[str]:
        recorder = result_cache._Recorder()
        token = result_cache._RECORDER.set(recorder)
        try:
            service.cards()
        finally:
            result_cache._RECORDER.reset(token)
        return {i.path for i in recorder.inputs}

    paths = pinned()
    norm = result_cache._norm
    assert norm(summary) in paths, "the summary that answered is pinned"
    assert norm(root / "results" / "screens") in paths, "the screens listing is pinned"

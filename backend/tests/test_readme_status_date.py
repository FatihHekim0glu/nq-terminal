"""The README's Status section is dated at or after the release it reports, and the desktop README holds no release
number that the next release would leave stale (V032 cleanup, 0.3.1 audit).

0.3.1's release left `As of 4 October 2026` above a bullet that says `Released on 7 October 2026`. The release step
rewrites the Status section after each release; this test fails when it forgets the date. `desktop/README.md` is not
touched by `bump-version.ps1`, so its commands carry a placeholder instead of the version of the last release.
"""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path

import pytest

TERMINAL = Path(__file__).resolve().parents[2]
README = TERMINAL / "README.md"
DESKTOP_README = TERMINAL / "desktop" / "README.md"
MONTHS = {name: number for number, name in enumerate(
    ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
     "December"), start=1)}
DATE = r"(\d{1,2}) (" + "|".join(MONTHS) + r") (\d{4})"


def _status(text: str) -> str:
    match = re.search(r"^## Status\s*\n(.*?)(?=^## )", text, re.M | re.S)
    assert match, "README.md has no Status section"
    return match.group(1)


def _date(match: re.Match) -> date:
    return date(int(match.group(3)), MONTHS[match.group(2)], int(match.group(1)))


def _dates(pattern: str, text: str) -> list[date]:
    return [_date(m) for m in re.finditer(pattern, text)]


def test_the_status_section_is_dated_at_or_after_its_newest_release():
    section = _status(README.read_text(encoding="utf-8"))
    (as_of,) = _dates(r"^As of " + DATE + r":", section.replace("\r", "")) or [None]
    assert as_of is not None, "the Status section has no 'As of <date>:' line"
    released = _dates(r"Released on " + DATE, section)
    assert released, "the Status section names no release date"
    assert as_of >= max(released), f"As of {as_of} is earlier than the release on {max(released)}"


def test_the_date_reader_reads_a_planted_status_section():
    text = "## Status\n\nAs of 4 October 2026:\n\n- x. Released on 7 October 2026 as the tag.\n\n## Next\n"
    section = _status(text)
    assert _dates(r"^As of " + DATE + ":", section) == [date(2026, 10, 4)]
    assert _dates(r"Released on " + DATE, section) == [date(2026, 10, 7)]


# a release number that is written out where a placeholder belongs
FIXED = (
    ("-Version", re.compile(r"-Version\s+\d+\.\d+\.\d+")),
    ("a release folder", re.compile(r"release[\\/]\d+\.\d+\.\d+")),
    ("-Tag", re.compile(r"-Tag\s+desktop-v\d+\.\d+\.\d+")),
)


@pytest.mark.parametrize(("what", "pattern"), FIXED, ids=[name for name, _ in FIXED])
def test_the_desktop_readme_holds_no_fixed_release_number_in_its_commands(what, pattern):
    hits = [line.strip()[:90] for line in DESKTOP_README.read_text(encoding="utf-8").splitlines()
            if pattern.search(line)]
    assert hits == [], f"{what} is a fixed number, use <version>: {hits}"


@pytest.mark.parametrize(("what", "pattern"), FIXED, ids=[name for name, _ in FIXED])
def test_the_number_scan_trips_on_a_planted_line(what, pattern):
    planted = {"-Version": "run build-release.ps1 -Version 0.3.1 now", "a release folder": r"D:\dev\release\0.3.1",
               "-Tag": "release_check.ps1 -Tag desktop-v0.1.1"}[what]
    assert pattern.search(planted)
    assert not pattern.search(planted.replace("0.3.1", "<version>").replace("0.1.1", "<version>"))

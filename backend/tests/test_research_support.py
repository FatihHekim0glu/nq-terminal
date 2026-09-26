"""Shared helpers for the research tests (TASKS 2.2): temporary research roots copied from the real tree.

No tests live here. Every copy is read from the real project and written under pytest's `tmp_path`, so a
test can tamper with a spec, a registry row or a sealed file without touching `results/` or `experiments/`.
"""
from __future__ import annotations

import csv
import io
import json
import shutil
from pathlib import Path

from nq_lab.config import ROOT

REAL_RESULTS = ROOT / "results"
REAL_SCREENS = REAL_RESULTS / "screens"
REAL_SEALED = REAL_RESULTS / "sealed"
REAL_EXPERIMENTS = ROOT / "experiments"
SCREEN_OF = {"za_v0": "za_v0_repaired", "za_v0_C3_gao_momentum": "za_v0_repaired"}
PRICE_PATTERN = r"(?i:px|raw|price)|_c$|^[OHLC]$"


def real_registry_rows() -> list[dict[str, str]]:
    """The real registry.csv as read now (another workflow may rebuild it; read counts at run time)."""
    text = (REAL_RESULTS / "registry.csv").read_text(encoding="utf-8")
    return list(csv.DictReader(io.StringIO(text)))


def write_registry(root: Path, rows: list[dict[str, str]]) -> Path:
    path = root / "results" / "registry.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = list(rows[0]) if rows else ["name"]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return path


def copy_file(src: Path, root: Path, *parts: str) -> Path:
    dest = root.joinpath(*parts)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)
    return dest


def build_root(tmp: Path, names: tuple[str, ...], series: tuple[str, ...] = ()) -> Path:
    """A research root holding the named registry rows, their screens and specs, plus the listed series CSVs."""
    rows = [row for row in real_registry_rows() if row["name"] in names]
    assert {row["name"] for row in rows} == set(names), "a requested row is missing from the real registry"
    write_registry(tmp, rows)
    for row in rows:
        stem = SCREEN_OF.get(row["name"], row["name"])
        copy_file(REAL_SCREENS / f"{stem}.json", tmp, "results", "screens", f"{stem}.json")
        copy_file(REAL_EXPERIMENTS / f"{row['spec']}.json", tmp, "experiments", f"{row['spec']}.json")
    for file_name in series:
        copy_file(REAL_SCREENS / file_name, tmp, "results", "screens", file_name)
    return tmp


def build_sealed_root(tmp: Path) -> Path:
    """The openings file, the confirmation spec and every file in results/sealed (read-only copies)."""
    copy_file(REAL_RESULTS / "oos_openings.json", tmp, "results", "oos_openings.json")
    openings = json.loads((REAL_RESULTS / "oos_openings.json").read_text(encoding="utf-8"))["openings"]
    for entry in openings:
        copy_file(ROOT / entry["spec"], tmp, *Path(entry["spec"]).parts)
    for src in REAL_SEALED.iterdir():
        if src.is_file():
            copy_file(src, tmp, "results", "sealed", src.name)
    return tmp


def flip_one_byte(path: Path) -> None:
    """Change exactly one byte of a text file (a space becomes a tab), keeping its size."""
    raw = bytearray(path.read_bytes())
    index = raw.index(ord(" "))
    raw[index] = ord("\t")
    path.write_bytes(bytes(raw))

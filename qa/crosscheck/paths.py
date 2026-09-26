"""Where the backend's dump test writes and the cross-check reads.

Order: the `--dir` argument, then the `NQT_QA_DUMP_DIR` environment variable, then the default below:
`terminal/qa/.dumps` (git-ignored by `terminal/qa/.gitignore`). `terminal/backend/tests/test_dump_for_qa.py`
resolves the same way, and a test there checks that both defaults name the same folder. The cross-check only
reads, but it refuses the same folders the dump test refuses (under `results/`, `backtests/output/`, `data/` or
`live/`, the project root or above it), so a stray variable is caught on both sides.
"""
from __future__ import annotations

import os
from pathlib import Path

ENV = "NQT_QA_DUMP_DIR"
DUMP_FOLDER = ".dumps"
QA_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DUMP_DIR = QA_ROOT / DUMP_FOLDER
PROJECT_ROOT = QA_ROOT.parents[1]  # terminal/qa -> nq-lab
PROTECTED = ("results", "backtests/output", "data", "live")


def checked(folder: Path) -> Path:
    """`folder`, unless it is inside a protected folder of the project, or the project root or above it."""
    target = Path(os.path.realpath(folder))
    root = Path(os.path.realpath(PROJECT_ROOT))
    if target == root or root.is_relative_to(target) or any(target.is_relative_to(root / part)
                                                             for part in PROTECTED):
        raise ValueError(f"refused dump folder {target}: dumps never live under results/, backtests/output/, "
                         "data/ or live/, nor in the project root or above it")
    return folder


def dump_dir(explicit: str | None = None) -> Path:
    if explicit:
        return checked(Path(explicit))
    from_env = os.environ.get(ENV, "").strip()
    return checked(Path(from_env)) if from_env else DEFAULT_DUMP_DIR

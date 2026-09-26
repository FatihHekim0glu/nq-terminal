"""The opening's spec fixture: `experiments/rebal_v1_confirm.json`, copied byte for byte from the nq-lab project.

The spec is kept out of version control (its text names a local file outside this repository), but the pinned
openings file (`results/oos_openings.json`, hash-pinned by the gate) records its sha256, so it cannot be reworded.
`ensure_opening_spec_fixture` writes the copy only when the project's file hashes to the opening's recorded
`spec_sha256`, and leaves an existing copy alone. It is called from `conftest.py` before the session guard starts
(the fixtures folder is write-protected during the tests) and by `fixture_app.py`.
"""
from __future__ import annotations

from pathlib import Path

from nq_lab import oos_gate
from nq_lab.config import ROOT

FIXTURES = Path(__file__).resolve().parent / "fixtures"
OPENING_SPEC = "experiments/rebal_v1_confirm.json"


def ensure_opening_spec_fixture() -> Path:
    target = FIXTURES.joinpath(*OPENING_SPEC.split("/"))
    if target.is_file():
        return target
    openings = oos_gate.load_openings(FIXTURES / "results" / "oos_openings.json")
    recorded = next(o["spec_sha256"] for o in openings if o.get("spec") == OPENING_SPEC)
    source = ROOT.joinpath(*OPENING_SPEC.split("/"))
    if source.is_file() and oos_gate.file_sha256(source) == recorded:
        target.write_bytes(source.read_bytes())
    return target

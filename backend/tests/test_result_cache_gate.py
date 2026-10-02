"""The gate block of a cached price body describes the request being served, not the computation that made the entry.

`gate.cached` and `gate.reads_this_process` are process state: a repeat of /api/market/two-day or of the SEAS
instrument route after another gated read must carry what a fresh computation would carry at that moment. The byte
equality checks in test_result_cache_routes compare a hit with a cold body taken at the same moment, so they cannot
see a stale gate; these compare with a cache-off body taken after another gated read.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from nq_terminal.api import data
from nq_terminal.models.data import GateInfo, TwoDay
from nq_terminal.models.seasonality import Seasonality

from test_result_cache_routes import CASES, Lab, uncached

OTHER_READ = "/api/bars?symbol=ZN.V.0&timeframe=1d&variant=vendor"


def sequence(lab: Lab, url: str) -> bytes:
    """The request, another gated read, then the request again; the last body."""
    assert lab.client.get(url).status_code == 200
    assert lab.client.get(OTHER_READ).status_code == 200
    again = lab.client.get(url)
    assert again.status_code == 200
    return again.content


@pytest.mark.parametrize("case", ["two_day", "seasonality"])
def test_a_hit_carries_the_gate_a_fresh_computation_would_carry_now(case, tmp_path, monkeypatch):
    url = CASES[case]["url"]
    cached_lab = Lab(tmp_path, "cached").build()
    hit = sequence(cached_lab, url)
    assert cached_lab.cache.stats().hits >= 1, "the repeat must really be a hit"
    with monkeypatch.context() as patch:
        uncached(patch)
        fresh = sequence(Lab(tmp_path, "fresh").build(), url)
    assert json.loads(hit)["gate"]["reads_this_process"] > 0
    assert hit == fresh


@pytest.mark.parametrize("case", ["two_day", "seasonality"])
def test_the_gate_of_a_hit_moves_with_the_process_while_the_rest_of_the_body_stays(case, tmp_path):
    lab = Lab(tmp_path).build()
    url = CASES[case]["url"]
    first = lab.client.get(url).json()
    assert lab.client.get(OTHER_READ).status_code == 200
    second = lab.client.get(url).json()
    assert lab.cache.stats().hits >= 1
    assert first["gate"]["cached"] is False and second["gate"]["cached"] is True
    assert second["gate"]["reads_this_process"] == first["gate"]["reads_this_process"] + 1
    assert second["gate"]["served_years"] == first["gate"]["served_years"]
    assert {k: v for k, v in first.items() if k != "gate"} == {k: v for k, v in second.items() if k != "gate"}


def test_the_gate_is_the_last_field_of_both_cached_models():
    assert list(TwoDay.model_fields)[-1] == "gate"
    assert list(Seasonality.model_fields)[-1] == "gate"


def test_current_gate_refuses_a_body_without_a_trailing_gate_block():
    class Service:
        def stats(self):  # noqa: ANN201
            return (7, 0)

    with pytest.raises(ValueError):
        data.current_gate(b'{"gate":{"caller":"terminal"},"rows":[]}', Service())
    body = GateInfo(caller="terminal", served_years=[2020], cached=False, reads_this_process=1)
    wrapped = b'{"rows":[],"gate":' + body.model_dump_json(by_alias=True).encode() + b"}"
    refreshed = json.loads(data.current_gate(wrapped, Service()))
    assert refreshed["gate"] == {"caller": "terminal", "served_years": [2020], "cached": True, "reads_this_process": 7}


# ---------------------------------------------------------------- the literal reading of "byte-equal to fresh"

CACHED_FALSE = b'"cached":false'
CACHED_TRUE = b'"cached":true'


def literal_difference(cold: bytes, hit: bytes) -> list[int]:
    """Offsets at which two bodies differ; same length is not assumed (the flag changes the length)."""
    if cold == hit:
        return []
    start = next((i for i, (a, b) in enumerate(zip(cold, hit)) if a != b), min(len(cold), len(hit)))
    return [start]


def test_the_difference_probe_is_born_failing_on_a_planted_change():
    assert literal_difference(b"abc", b"abc") == []
    assert literal_difference(b'{"x":1,"cached":false}', b'{"x":2,"cached":true}') == [5]


@pytest.mark.parametrize("case", sorted(CASES))
def test_a_hit_equals_the_cold_body_literally_except_the_one_cached_flag_of_the_gated_routes(case, tmp_path):
    """The accepted reading of the D1 exit criterion, pinned byte for byte.

    Six routes: the hit is the cold body. Two (two-day, seasonality) end with a gate block: the hit is the cold body
    with `"cached":false` turned into `"cached":true` and nothing else, so a hit is one byte shorter.
    """
    lab = Lab(tmp_path).build()
    url = CASES[case]["url"]
    cold = lab.client.get(url)
    hit = lab.client.get(url)
    assert cold.status_code == hit.status_code == 200 and lab.cache.stats().hits == 1
    if case not in ("two_day", "seasonality"):
        assert hit.content == cold.content
        return
    assert cold.content.count(CACHED_FALSE) == 1 and hit.content.count(CACHED_TRUE) == 1
    assert cold.content.replace(CACHED_FALSE, CACHED_TRUE) == hit.content
    assert len(hit.content) == len(cold.content) - 1

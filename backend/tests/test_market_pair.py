"""Rolling pair correlation for the CORR click-through (UI_SPEC s7 CORR; contract finding C9).

`/api/market/pair-corr?a=&b=&window=` uses the same gated, cached 1d frames and the same return convention as
`/api/market/universe`, so its last value equals the universe's windowed correlation for the pair. Every price read
goes through the fake serve with a temporary log.
"""
from __future__ import annotations

import math
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nq_terminal.app import create_app
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve


@pytest.fixture(scope="module")
def client(tmp_path_factory) -> TestClient:
    app = create_app(load_settings({"NQT_FIXTURE_DIR": str(FIXTURES)}))
    app.state.serve_fn = make_fake_serve(Path(tmp_path_factory.mktemp("log")) / "oos_access_log.jsonl")
    app.state.catalog = FakeCatalog()
    return TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000))


def test_the_last_rolling_value_equals_the_universe_matrix(client):
    body = client.get("/api/market/pair-corr", params={"a": "NQ.V.0", "b": "ES.V.0", "window": 63}).json()
    assert body["label"].startswith("[POST HOC]") and body["window"] == 63
    assert len(body["t"]) == len(body["date"]) == len(body["corr"]) and body["date"][-1] <= "2021-12-31"
    assert all(v is None for v in body["corr"][:62])
    universe = client.get("/api/market/universe", params={"window": 63}).json()["correlation_window"]
    i, j = universe["symbols"].index("NQ.V.0"), universe["symbols"].index("ES.V.0")
    assert math.isclose(body["corr"][-1], universe["matrix"][i][j], rel_tol=0, abs_tol=1e-12)
    assert body["gate"]["caller"] == "terminal"


@pytest.mark.parametrize("params, status", [({"a": "NQ.V.0", "b": "NQ.V.0"}, 422),
                                            ({"a": "NQ.V.0", "b": "RTY.V.0"}, 404),
                                            ({"a": "NQ.V.0", "b": "ES.V.0", "window": 5}, 422)])
def test_bad_pairs_are_refused(client, params, status):
    assert client.get("/api/market/pair-corr", params=params).status_code == status

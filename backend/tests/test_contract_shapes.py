"""Contract shape rules (Phase 2 contract review, C6 and C7), checked on `app.openapi()`.

- Every error a router raises is declared with a typed body (`ErrorDetail`), so the generated client has types for
  the gate's 403 refusal, 404s, 503s and the rest.
- Response fields that always carry a value are required in the schema (no `field?:` in the generated types),
  including ones with defaults such as `basis`.
"""
from __future__ import annotations

import pytest

from nq_terminal.app import create_app
from nq_terminal.settings import load_settings

ERROR_REF = "#/components/schemas/ErrorDetail"
EXPECTED_ERRORS = {
    "/api/bars": {"403", "404", "422", "503"},
    "/api/qa/{name}": {"404", "502"},
    "/api/market/universe": {"403", "503"},
    "/api/runs/{run_id}": {"404", "503"},
    "/api/hypotheses/{name}": {"404", "500", "503"},
    "/api/audit/spec-hashes": {"503"},
    "/api/live/log": {"404", "413"},
}


@pytest.fixture(scope="module")
def schema() -> dict:
    return create_app(load_settings({})).openapi()


def _declared(schema: dict, path: str) -> dict:
    return schema["paths"][path]["get"]["responses"]


@pytest.mark.parametrize("path, codes", sorted(EXPECTED_ERRORS.items()))
def test_errors_are_declared_with_a_typed_body(schema, path, codes):
    declared = _declared(schema, path)
    for code in codes:
        assert code in declared, (path, code)
        ref = declared[code]["content"]["application/json"]["schema"]["$ref"]
        assert ref == ERROR_REF, (path, code, ref)


def test_fields_with_defaults_are_required_in_responses(schema):
    parts = schema["components"]["schemas"]
    run = set(parts["RunSummary"]["required"])
    assert {"balance_ok", "is_probe", "is_anchor", "usable", "kind", "sidecars"} <= run
    assert "basis" in parts["EquitySeries"]["required"]
    assert "basis" in parts["CompareStats"]["required"]
    assert {"basis", "r_bench", "bench_label"} <= set(parts["HypothesisSeries"]["required"])


def test_every_response_schema_requires_all_its_fields(schema):
    parts = schema["components"]["schemas"]
    loose = {name: sorted(set(s.get("properties", {})) - set(s.get("required", [])))
             for name, s in parts.items()
             if name not in {"HTTPValidationError", "ValidationError"} and s.get("type") == "object"}
    assert {k: v for k, v in loose.items() if v} == {}

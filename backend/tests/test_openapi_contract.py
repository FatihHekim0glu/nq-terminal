"""API contract snapshot (ARCHITECTURE section 4, "Contract discipline"; TASKS Phase 2, owner 2.1).

`terminal/contract/openapi.json` is written from `app.openapi()` on the first run (when the file is missing)
and compared on every later run, so a backend change that alters the API fails until the snapshot is
regenerated on purpose: delete the file, or set `NQT_UPDATE_CONTRACT=1` for one run, then regenerate the
front-end types (`pnpm gen:api`, Phase 4). The failure message lists what changed.
"""
from __future__ import annotations

import copy
import json
import os
import re
from pathlib import Path
from typing import Any

from nq_terminal.app import create_app
from nq_terminal.settings import TERMINAL_DIR, load_settings

CONTRACT = TERMINAL_DIR / "contract" / "openapi.json"
UPDATE_ENV = "NQT_UPDATE_CONTRACT"
METHODS = ("get", "put", "post", "delete", "options", "head", "patch", "trace")


def current_schema() -> dict:
    return create_app(load_settings({})).openapi()


def render(schema: dict) -> str:
    return json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def _keyed_differences(kind: str, saved: dict, current: dict) -> list[str]:
    out = [f"{kind} removed: {k}" for k in sorted(set(saved) - set(current))]
    out += [f"{kind} added: {k}" for k in sorted(set(current) - set(saved))]
    out += [f"{kind} changed: {k}" for k in sorted(set(saved) & set(current)) if saved[k] != current[k]]
    return out


def contract_differences(saved: dict, current: dict) -> list[str]:
    """Human-readable differences between two OpenAPI documents; [] when they are equal."""
    out = _keyed_differences("path", saved.get("paths", {}), current.get("paths", {}))
    out += _keyed_differences("schema", saved.get("components", {}).get("schemas", {}),
                              current.get("components", {}).get("schemas", {}))
    if not out and saved != current:
        out = _keyed_differences("top-level key", saved, current)
    return out


def _write(schema: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render(schema), encoding="utf-8", newline="\n")


def test_contract_matches_the_app():
    schema = current_schema()
    if os.environ.get(UPDATE_ENV) == "1" or not CONTRACT.exists():
        _write(schema, CONTRACT)
    saved = json.loads(CONTRACT.read_text(encoding="utf-8"))
    differences = contract_differences(saved, json.loads(render(schema)))
    assert not differences, (f"the API no longer matches {CONTRACT} (delete it or set {UPDATE_ENV}=1 to accept, "
                             "then regenerate the web types):\n" + "\n".join(differences))


def test_contract_file_is_canonical():
    """The file is exactly what `render` writes, so a hand edit shows up as a change too."""
    if not CONTRACT.exists():
        _write(current_schema(), CONTRACT)
    text = CONTRACT.read_text(encoding="utf-8")
    assert text == render(json.loads(text))


JOB_WRITES = {"/api/jobs": {"post"}, "/api/jobs/{job_id}": {"delete"}}  # PRD U3: the only writes in the contract


def non_get_operations(schema: dict) -> dict[str, set[str]]:
    """Every path with a method other than get, minus the two job writes (which must be exactly those methods)."""
    found = {path: {m for m in ops if m in METHODS and m != "get"} for path, ops in schema["paths"].items()}
    return {path: methods for path, methods in found.items() if methods and methods != JOB_WRITES.get(path)}


def test_contract_is_get_only_bar_the_two_job_writes():
    saved = json.loads(CONTRACT.read_text(encoding="utf-8")) if CONTRACT.exists() else current_schema()
    assert non_get_operations(saved) == {}
    for path, methods in JOB_WRITES.items():
        assert methods <= {m for m in saved["paths"][path] if m in METHODS}, path


def test_the_non_get_scan_is_born_failing():
    planted = {"paths": {"/api/jobs": {"get": {}, "post": {}, "put": {}}, "/api/jobs/{job_id}": {"delete": {}},
                         "/api/orders": {"post": {}}, "/api/jobs/other": {"delete": {}}}}
    assert non_get_operations(planted) == {"/api/jobs": {"post", "put"}, "/api/orders": {"post"},
                                           "/api/jobs/other": {"delete"}}


def _mutations(schema: dict) -> list[tuple[str, dict[str, Any]]]:
    dropped = copy.deepcopy(schema)
    dropped["paths"].pop(sorted(dropped["paths"])[0])
    added = copy.deepcopy(schema)
    added["paths"]["/api/orders"] = {"post": {"responses": {}}}
    retyped = copy.deepcopy(schema)
    name = sorted(retyped["components"]["schemas"])[0]
    retyped["components"]["schemas"][name]["title"] = "Changed"
    titled = copy.deepcopy(schema)
    titled["info"]["version"] = "9.9.9"
    return [("path removed", dropped), ("path added", added), ("schema changed", retyped),
            ("top-level key changed", titled)]


def test_contract_difference_is_born_failing():
    schema = json.loads(render(current_schema()))
    assert contract_differences(schema, copy.deepcopy(schema)) == []
    for label, mutated in _mutations(schema):
        found = contract_differences(schema, mutated)
        assert any(line.startswith(label) for line in found), (label, found)


# ---------------------------------------------------------------- no order-path names (ARCHITECTURE s9)

ACTION_STEM = re.compile(r"^(order|submit|cancel|modif)", re.IGNORECASE)


def name_words(name: str) -> list[str]:
    """The words of a name as `web/e2e/flows/scan.ts` splits them: separators, then camelCase and PascalCase."""
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name)
    spaced = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", spaced)
    return [w for w in re.split(r"[^A-Za-z0-9]+", spaced) if w]


def action_names(schema: dict) -> list[str]:
    """Route paths, operation ids and schema names with a word that starts with order, submit, cancel or modif."""
    named = [("route", path) for path in schema.get("paths", {})]
    named += [("operation", op["operationId"]) for ops in schema.get("paths", {}).values()
              for method, op in ops.items() if method in METHODS and "operationId" in op]
    named += [("schema", name) for name in schema.get("components", {}).get("schemas", {})]
    return sorted({f"{kind}: {name}" for kind, name in named
                   if any(ACTION_STEM.match(word) for word in name_words(name))})


def test_action_name_scan_is_born_failing():
    planted = {"paths": {"/api/live/orders": {"get": {"operationId": "orders_api_live_orders_get"}},
                         "/api/runs": {"get": {"operationId": "runs_api_runs_get"}}},
               "components": {"schemas": {"LiveOrders": {}, "OrdersSummary": {}, "CancelRequest": {},
                                          "LiveRouteRow": {}, "BorderInfo": {}, "RecorderPane": {}}}}
    assert action_names(planted) == ["operation: orders_api_live_orders_get", "route: /api/live/orders",
                                     "schema: CancelRequest", "schema: LiveOrders", "schema: OrdersSummary"]


def test_no_route_operation_or_schema_name_reads_as_an_order_action():
    assert action_names(current_schema()) == []
    if CONTRACT.exists():
        assert action_names(json.loads(CONTRACT.read_text(encoding="utf-8"))) == []

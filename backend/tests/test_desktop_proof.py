"""The proof route in the real app (03 section 2.2; 04 D2.2; review 2 blocker 1; 05 G08).

`GET /api/desktop/proof?nonce=<64 hex>` is the one /api path that needs neither a cookie nor a token: it takes no
secret and gives none, so the shell can call it before it trusts the backend, and a planted backend learns nothing
from the call. These tests use the app `create_app` builds, with the session middleware in place, and check that the
route never reads an Authorization header: not in its signature, not in its source, not in what it answers.
"""
from __future__ import annotations

import ast
import dataclasses
import inspect
from pathlib import Path

import pytest

from nq_terminal.api import desktop as desktop_api
from nq_terminal.app import create_app
from nq_terminal.desktop import handshake, lifecycle, proof, sessions
from nq_terminal.desktop.lifecycle import Runtime
from nq_terminal.security import SESSION_EXEMPT
from nq_terminal.settings import load_settings

from conftest import bare_client

TOKEN = "6b" * 32
PORT = 8798
NONCE = "c4" * 32
PACKAGE = Path(__file__).resolve().parents[1] / "nq_terminal"


@pytest.fixture
def app(tmp_path):
    made = create_app(dataclasses.replace(load_settings({}), port=PORT, web_dist=tmp_path / "no_dist"))
    lifecycle.set_runtime(made, Runtime(token=TOKEN, port=PORT, pid=4120, mode="desktop"))
    return made


def test_the_proof_answers_with_no_cookie_and_no_token(app):
    r = bare_client(app).get("/api/desktop/proof", params={"nonce": NONCE})
    assert r.status_code == 200 and "set-cookie" not in r.headers and r.headers["cache-control"] == "no-store"
    assert handshake.verify_proof(r.json(), TOKEN, NONCE, PORT) is True
    assert TOKEN not in r.text


@pytest.mark.parametrize("authorization", [f"NQT {TOKEN}", f"NQT {'00' * 32}", "Bearer x", "NQT", "é"])
def test_any_authorization_header_changes_nothing(app, authorization):
    client = bare_client(app)
    plain = client.get("/api/desktop/proof", params={"nonce": NONCE})
    sent = client.get("/api/desktop/proof", params={"nonce": NONCE},
                      headers={"Authorization": authorization.encode("utf-8")})
    assert (sent.status_code, sent.content, "set-cookie" in sent.headers) == (plain.status_code, plain.content, False)


def _code_words(source: str) -> set[str]:
    """Every name, attribute, argument and string constant in the code, docstrings left out."""
    tree = ast.parse(source)
    docstrings = {id(node.body[0].value) for node in ast.walk(tree)
                  if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.body
                  and isinstance(node.body[0], ast.Expr) and isinstance(node.body[0].value, ast.Constant)}
    words: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            words.add(node.id.lower())
        elif isinstance(node, ast.Attribute):
            words.add(node.attr.lower())
        elif isinstance(node, ast.arg):
            words.add(node.arg.lower())
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
            words.add(node.value.lower())
    return words


def test_the_proof_route_and_its_module_never_name_the_authorization_header():
    params = inspect.signature(desktop_api.desktop_proof).parameters
    assert set(params) == {"request", "nonce"}
    route = _code_words(inspect.getsource(desktop_api.desktop_proof).strip())
    module = _code_words(Path(proof.__file__).read_text(encoding="utf-8"))
    for words in (route, module):
        assert not {w for w in words if "authorization" in w or w in ("headers", "header", "cookies")}
    assert "authorization" in _code_words("def f(authorization):\n    return authorization\n")  # born failing


def test_the_proof_route_reads_no_request_header_at_all():
    tree = ast.parse(inspect.getsource(desktop_api.desktop_proof).strip())
    reads = [ast.unparse(n) for n in ast.walk(tree) if isinstance(n, ast.Attribute) and n.attr in ("headers", "cookies")]
    assert reads == []


def test_the_proof_is_exempt_from_the_cookie_but_a_write_to_it_is_refused(app):
    assert "/api/desktop/proof" in SESSION_EXEMPT
    r = bare_client(app).post("/api/desktop/proof", params={"nonce": NONCE},
                              headers={"Origin": f"http://127.0.0.1:{PORT}"})
    assert r.status_code in (403, 405) and "proof" not in r.text


def test_the_proof_opens_no_session(app):
    for _ in range(3):
        bare_client(app).get("/api/desktop/proof", params={"nonce": NONCE})
    assert sessions.store(app).counts() == (0, 0)


def test_a_fresh_nonce_per_call_means_an_old_answer_does_not_verify(app):
    client = bare_client(app)
    old = client.get("/api/desktop/proof", params={"nonce": NONCE}).json()
    assert handshake.verify_proof(old, TOKEN, "d5" * 32, PORT) is False

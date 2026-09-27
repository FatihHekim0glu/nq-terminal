"""The CSP for the Perspective pivot grid (TASKS 9.1; ARCHITECTURE section 9).

The pivot engine is WebAssembly, and Chrome refuses to compile WebAssembly under a policy whose script
sources lack 'wasm-unsafe-eval'. The policy adds exactly that keyword to 'self' scripts and nothing else:
no 'unsafe-eval' (which would allow JavaScript eval and new Function), no blob: or data: scripts or
workers (the engine worker is a same-origin file), and every earlier directive stays as it was.
"""
from __future__ import annotations

from nq_terminal.security import CONTENT_SECURITY_POLICY


def _directives(policy: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for part in policy.split(";"):
        words = part.split()
        if words:
            out[words[0]] = words[1:]
    return out


def test_scripts_are_self_plus_wasm_compilation_only():
    d = _directives(CONTENT_SECURITY_POLICY)
    assert d["script-src"] == ["'self'", "'wasm-unsafe-eval'"]


def test_no_eval_blob_or_data_script_and_no_separate_worker_source():
    d = _directives(CONTENT_SECURITY_POLICY)
    assert "'unsafe-eval'" not in CONTENT_SECURITY_POLICY
    assert "blob:" not in CONTENT_SECURITY_POLICY
    assert "data:" not in " ".join(d["script-src"])
    # Workers fall back to script-src: same-origin files only.
    assert "worker-src" not in d and "child-src" not in d


def test_the_earlier_directives_are_unchanged():
    d = _directives(CONTENT_SECURITY_POLICY)
    assert d["default-src"] == ["'self'"]
    assert d["style-src"] == ["'self'", "'unsafe-inline'"]
    assert d["img-src"] == ["'self'", "data:"]
    assert d["object-src"] == ["'none'"]
    assert d["base-uri"] == ["'none'"]
    assert d["form-action"] == ["'none'"]
    assert d["frame-ancestors"] == ["'none'"]
    assert "connect-src" not in d  # fetches stay under default-src 'self'


def test_born_failing_an_eval_policy_is_caught():
    bad = CONTENT_SECURITY_POLICY.replace("'wasm-unsafe-eval'", "'unsafe-eval'")
    assert _directives(bad).get("script-src") != ["'self'", "'wasm-unsafe-eval'"]

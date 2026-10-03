"""The served-JSON comparison (`crosscheck.served`; 03 section 15.3, 02 section 6.3), each rule with its born-failing twin.

A body that differs by one byte must be caught, a gate block may differ only in the fields that follow the process, a body that
cannot be served (a status other than 200) fails, the comparison talks to loopback and never to 8765, and a session that cannot
start is exit code 2, not a pass. The last two tests run the whole command line against a small local server that answers with
the real `cached` dump's own bodies, once clean and once with one byte of one route planted.
"""
from __future__ import annotations

import base64
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from crosscheck import paths, served
from crosscheck.dumps import DumpError

GATE_TAIL = b',"gate":{"caller":"terminal","served_years":[2021],"cached":false,"reads_this_process":2}}'
PLAIN = b'{"rows":[1,2,3],"missing":[]}'
GATED = b'{"symbols":["NQ.V.0"],"missing":[]' + GATE_TAIL


def b64(body: bytes) -> str:
    return base64.b64encode(body).decode("ascii")


def doc_of(**bodies: bytes) -> dict:
    names = list(bodies)
    return {"inputs": {"routes": names,
                       "queries": {n: {"path": f"/api/{n}", "params": {"k": n}} for n in names},
                       "fresh": {n: b64(b) for n, b in bodies.items()}}}


def case(name: str = "plain", body: bytes = PLAIN) -> served.Case:
    return served.Case(name=name, path=f"/api/{name}", params={"k": name}, expected=body)


def flip(body: bytes, at: int = 5) -> bytes:
    return body[:at] + bytes([body[at] ^ 1]) + body[at + 1:]


def test_cases_are_built_from_the_dump_in_its_route_order() -> None:
    cases = served.cases_from_doc(doc_of(plain=PLAIN, two_day=GATED))
    assert [c.name for c in cases] == ["plain", "two_day"]
    assert cases[0].target == "/api/plain?k=plain"
    assert cases[1].expected == GATED


def test_a_dump_with_no_route_is_refused() -> None:
    with pytest.raises(DumpError):
        served.cases_from_doc({"inputs": {"routes": [], "queries": {}, "fresh": {}}})


def test_an_equal_body_passes() -> None:
    assert served.compare_body(case(), PLAIN).status == served.PASS


def test_born_failing_one_planted_byte_is_caught_and_located() -> None:
    result = served.compare_body(case(), flip(PLAIN, 7))
    assert result.status == served.FAIL
    assert "byte 7" in result.detail


def test_born_failing_a_shorter_or_longer_body_is_caught() -> None:
    assert served.compare_body(case(), PLAIN[:-1]).status == served.FAIL
    assert served.compare_body(case(), PLAIN + b" ").status == served.FAIL


def test_a_gate_block_may_differ_only_in_the_fields_that_follow_the_process() -> None:
    served_body = GATED.replace(b'"cached":false,"reads_this_process":2', b'"cached":true,"reads_this_process":57')
    result = served.compare_body(case("two_day", GATED), served_body)
    assert result.status == served.PASS and result.mode == "gate"


def test_born_failing_a_plain_body_does_not_get_the_gate_allowance() -> None:
    body = b'{"rows":[1],"gate":{"caller":"terminal","cached":false,"reads_this_process":2}}'
    assert served.compare_body(case("ledger", body), body.replace(b"2}}", b"9}}")).status == served.FAIL


@pytest.mark.parametrize("planted", [
    lambda b: flip(b, 5),
    lambda b: b.replace(b'"served_years":[2021]', b'"served_years":[2020]'),
    lambda b: b.replace(b'"caller":"terminal"', b'"caller":"za_screen"'),
])
def test_born_failing_a_gate_body_differing_before_the_gate_or_in_a_data_field_is_caught(planted) -> None:
    assert served.compare_body(case("two_day", GATED), planted(GATED)).status == served.FAIL


def test_born_failing_a_gate_body_whose_block_lost_a_process_field_is_caught() -> None:
    served_body = GATED.replace(b',"reads_this_process":2', b"")
    assert served.compare_body(case("two_day", GATED), served_body).status == served.FAIL


def test_born_failing_a_body_that_lost_its_gate_block_is_caught() -> None:
    assert served.compare_body(case("two_day", GATED), b'{"symbols":["NQ.V.0"],"missing":[]}').status == served.FAIL


def test_run_fails_a_route_that_is_not_served_with_200() -> None:
    answers = {"/api/a?k=a": (200, PLAIN), "/api/b?k=b": (503, b'{"detail":"down"}')}
    report = served.run([case("a"), case("b")], lambda target: answers[target])
    assert [r.status for r in report.results] == [served.PASS, served.FAIL]
    assert "503" in report.results[1].detail


def test_run_is_green_only_when_every_route_is_equal() -> None:
    cases = [case("a", PLAIN), case("b", PLAIN)]
    assert not served.run(cases, lambda target: (200, PLAIN)).failed
    assert len(served.run(cases, lambda target: (200, PLAIN if target.endswith("a") else flip(PLAIN))).failed) == 1


@pytest.mark.parametrize("origin", [
    "http://127.0.0.1:8765", "http://localhost:8800", "https://127.0.0.1:8800", "http://127.0.0.1", "http://10.0.0.5:8800",
    "http://127.0.0.1:8800.evil.example",
])
def test_the_comparison_refuses_anything_but_a_loopback_port_other_than_the_owners(origin) -> None:
    with pytest.raises(ValueError):
        served.check_origin(origin)


def test_a_loopback_origin_is_accepted_as_written() -> None:
    assert served.check_origin("http://127.0.0.1:8800/") == "http://127.0.0.1:8800"


def test_main_refuses_the_owners_backend_and_a_half_given_session(capsys) -> None:
    assert served.main(["--origin", "http://127.0.0.1:8765", "--cookie", "a=b"]) == 2
    assert served.main(["--origin", "http://127.0.0.1:8800"]) == 2
    capsys.readouterr()


def test_main_without_the_session_script_is_exit_two_not_a_pass(monkeypatch, capsys) -> None:
    session = served.AppSession
    monkeypatch.setattr(served, "AppSession", lambda: session(Path("D:/dev/none/served-session.ts")))
    if not (paths.DEFAULT_DUMP_DIR.is_dir() and any(paths.DEFAULT_DUMP_DIR.glob("*cached*.json"))):
        pytest.skip("no cached dump yet (run the backend test test_dump_for_qa.py)")
    assert served.main([]) == 2
    assert "no session" in capsys.readouterr().out


# ---------------------------------------------------------------- the command line against a local server


def real_cases() -> tuple[str, list[served.Case]]:
    folder = paths.DEFAULT_DUMP_DIR
    if not folder.is_dir() or not any(folder.glob("*cached*.json")):
        pytest.skip("no cached dump yet (run the backend test test_dump_for_qa.py)")
    return served.load_cases(folder)


def serve_answers(answers: dict[str, bytes], seen: list[str]) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 (the http.server name)
            seen.append(self.headers.get("Cookie", ""))
            body = answers.get(self.path)
            self.send_response(200 if body is not None else 404)
            self.end_headers()
            self.wfile.write(body if body is not None else b"{}")

        def log_message(self, *args) -> None:
            return None

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def run_main(server: ThreadingHTTPServer) -> int:
    return served.main(["--origin", f"http://127.0.0.1:{server.server_address[1]}", "--cookie", "nqt_s_1=abc"])


def test_the_command_line_is_green_on_the_dumps_own_bodies(capsys) -> None:
    _, cases = real_cases()
    seen: list[str] = []
    server = serve_answers({c.target: c.expected for c in cases}, seen)
    try:
        assert run_main(server) == 0
    finally:
        server.shutdown()
    out = capsys.readouterr().out
    assert f"{len(cases)} routes" in out and "served: OK" in out
    assert set(seen) == {"nqt_s_1=abc"}, "every request carries the session cookie"


def test_born_failing_the_command_line_catches_one_planted_byte_in_one_route(capsys) -> None:
    _, cases = real_cases()
    target = next(c for c in cases if c.name == "ledger")
    answers = {c.target: c.expected for c in cases}
    answers[target.target] = flip(target.expected, len(target.expected) // 2)
    server = serve_answers(answers, [])
    try:
        assert run_main(server) == 1
    finally:
        server.shutdown()
    out = capsys.readouterr().out
    assert "FAIL  ledger" in out and "served: FAILED (1 of" in out


def test_the_real_dump_names_eight_routes_and_two_of_them_end_in_a_gate_block() -> None:
    _, cases = real_cases()
    gated = sorted(c.name for c in cases if served._split_gate(c.expected) is not None)
    assert len(cases) == 8
    assert gated == ["seasonality_nq", "two_day"]
    assert json.loads(cases[0].expected)


# ---------------------------------------------------------------- the window-watch verdict must never be missing


ORIGIN_LINE = 'print(json.dumps({"origin": "http://127.0.0.1:9", "cookie": "nqt_s_9=a"}), flush=True)'


def fake_session(tmp_path: Path, tail: str) -> served.AppSession:
    """A stand-in for served-session.ts: prints the origin line, waits for stdin to close, then runs `tail`."""
    script = tmp_path / "fake_session.py"
    script.write_text(f"import json, sys\n{ORIGIN_LINE}\nsys.stdin.read()\n{tail}\n", encoding="utf-8")
    return served.AppSession(script, node=sys.executable)


def watch_failures_of(session: served.AppSession) -> list[str]:
    with session as app:
        assert app.origin == "http://127.0.0.1:9"
    return session.watch_failures


def test_a_session_that_prints_a_clean_watch_line_and_exits_zero_has_no_failures(tmp_path) -> None:
    session = fake_session(tmp_path, 'print(json.dumps({"watch": []}))')
    assert watch_failures_of(session) == []


def test_a_session_that_reports_a_window_exits_one_and_keeps_that_failure(tmp_path) -> None:
    session = fake_session(tmp_path, 'print(json.dumps({"watch": ["a window was shown"]}))\nsys.exit(1)')
    assert watch_failures_of(session) == ["a window was shown"]


def test_born_failing_a_session_that_exits_two_without_the_watch_line_is_a_failure(tmp_path) -> None:
    failures = watch_failures_of(fake_session(tmp_path, "sys.exit(2)"))
    assert failures and any("window-watch" in f for f in failures)


def test_born_failing_a_session_that_exits_zero_without_the_watch_line_is_a_failure(tmp_path) -> None:
    assert watch_failures_of(fake_session(tmp_path, "pass"))


def test_born_failing_a_session_that_exits_nonzero_after_a_clean_watch_line_is_a_failure(tmp_path) -> None:
    assert watch_failures_of(fake_session(tmp_path, 'print(json.dumps({"watch": []}))\nsys.exit(2)'))


def test_born_failing_two_watch_lines_are_a_failure(tmp_path) -> None:
    assert watch_failures_of(fake_session(tmp_path, 'print(json.dumps({"watch": []}))\nprint(json.dumps({"watch": []}))'))


def test_born_failing_a_session_that_never_ends_is_killed_and_is_a_failure(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(served, "SESSION_EXIT_WAIT_S", 1)
    assert watch_failures_of(fake_session(tmp_path, "import time\ntime.sleep(60)"))


def test_born_failing_main_is_not_green_when_the_watch_verdict_is_missing(tmp_path, monkeypatch, capsys) -> None:
    _, cases = real_cases()
    server = serve_answers({c.target: c.expected for c in cases}, [])
    script = tmp_path / "fake_session.py"
    script.write_text("import json, sys\n"
                      f'print(json.dumps({{"origin": "http://127.0.0.1:{server.server_address[1]}", "cookie": "nqt_s_1=a"}}), flush=True)\n'
                      "sys.stdin.read()\nsys.exit(2)\n", encoding="utf-8")
    session = served.AppSession
    monkeypatch.setattr(served, "AppSession", lambda: session(script, node=sys.executable))
    try:
        assert served.main([]) == 1
    finally:
        server.shutdown()
    assert "window watch" in capsys.readouterr().out

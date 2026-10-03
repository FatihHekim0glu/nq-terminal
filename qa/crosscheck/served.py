"""`uv run --project terminal/qa python -m crosscheck.served [--dir DIR] [--origin URL --cookie NAME=VALUE]`

The served-JSON comparison (03 sections 15.3; 02 section 6.3, G2; 04 D5.2). The crosscheck reads dumps that in-process
backend tests wrote, so it never sees the bytes the running app serves. This reads the one dump that holds response bodies
(the `cached` bundle of `test_dump_for_qa.py`: every cached slow route of the fixture app, as exact base64 bodies), asks the
app-launched fixture backend for the same routes with the same queries through the app's own session, and compares each served
body with the in-process body byte for byte. Equal bodies plus a green crosscheck mean the numbers on screen are the
crosschecked numbers.

Two routes (two-day and seasonality) end with a gate block that describes the process as well as the computation: whether the
answer came from the result cache and how many price reads the process has made (03 section 15.2, result cache). The app has
read prices for HOME before this asks, so those two fields differ by design. For them every byte before the gate's `cached`
field must be equal and the gate's other fields must be equal; every other route must be equal byte for byte.

Where the session comes from: by default this starts the hidden smoke build through `web/e2e/desktop/served-session.ts`
(Node: the app is launched with --fixture, under the global window watch, and the page's own session cookie is read over the
debugging protocol), compares, and ends the app. `--origin` and `--cookie` name a session that already exists instead.

Exit codes: 0 every route equal; 1 a route differs (or could not be served); 2 no usable dump or no session.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from crosscheck import paths
from crosscheck.dumps import DumpError, decode_body

PASS, FAIL = "PASS", "FAIL"
CLIENT_HEADER = ("X-NQT-Client", "nq-lab-terminal")
REQUEST_TIMEOUT_S = 120
SESSION_WAIT_S = 360
SESSION_EXIT_WAIT_S = 120
# The gate block is the last object of these bodies; the fields below follow the process, not the data.
GATE_MARKER = b',"gate":{'
GATE_PROCESS_FIELDS = ("cached", "reads_this_process")
GATE_ROUTES = frozenset({"two_day", "seasonality_nq"})  # the dump routes whose body ends with the process gate block
TERMINAL_DIR = paths.QA_ROOT.parent
SESSION_SCRIPT = TERMINAL_DIR / "web" / "e2e" / "desktop" / "served-session.ts"
CREATE_NO_WINDOW = 0x08000000


@dataclass(frozen=True)
class Case:
    name: str
    path: str
    params: dict
    expected: bytes

    @property
    def target(self) -> str:
        query = urllib.parse.urlencode(self.params)
        return f"{self.path}?{query}" if query else self.path


@dataclass(frozen=True)
class Result:
    name: str
    status: str
    detail: str
    mode: str = "bytes"


@dataclass
class Report:
    results: list[Result] = field(default_factory=list)

    @property
    def failed(self) -> list[Result]:
        return [r for r in self.results if r.status != PASS]


def cases_from_doc(doc: dict, name: str = "dump") -> list[Case]:
    """Per route, the request and the in-process body (the cold `fresh` take) of a `cached` dump."""
    inputs = doc["inputs"]
    cases = []
    for route in inputs["routes"]:
        query = inputs["queries"][route]
        body = decode_body(inputs["fresh"][route], f"{name} fresh/{route}")
        cases.append(Case(name=route, path=query["path"], params=dict(query.get("params") or {}), expected=body))
    if not cases:
        raise DumpError(f"{name} lists no routes")
    return cases


def load_cases(folder: Path) -> tuple[str, list[Case]]:
    """The first `cached` dump of the folder: its file name and its cases."""
    for path in sorted(folder.glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        if doc.get("kind") == "cached":
            return path.name, cases_from_doc(doc, path.name)
    raise DumpError(f"no `cached` dump in {folder}: run the backend test test_dump_for_qa.py first")


def first_difference(a: bytes, b: bytes) -> int:
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return i
    return min(len(a), len(b))


def _context(body: bytes, at: int) -> str:
    return body[max(0, at - 30):at + 40].decode("utf-8", "replace")


def _split_gate(body: bytes) -> tuple[bytes, dict] | None:
    """The bytes before the gate block, and the gate block parsed, or None when the body has none."""
    at = body.rfind(GATE_MARKER)
    if at < 0:
        return None
    try:
        gate = json.loads(body[at + len(b',"gate":'):-1])
    except ValueError:
        return None
    return body[:at], gate


def compare_gate_body(case: Case, served: bytes) -> Result:
    """Equal before the gate block; in the gate block every field but the process's own must be equal."""
    want, got = _split_gate(case.expected), _split_gate(served)
    if want is None or got is None:
        return Result(case.name, FAIL, "the body has no gate block to compare", "gate")
    if want[0] != got[0]:
        at = first_difference(want[0], got[0])
        return Result(case.name, FAIL, f"differs before the gate block at byte {at}: {_context(want[0], at)!r} against {_context(got[0], at)!r}", "gate")
    names = (set(want[1]) | set(got[1])) - set(GATE_PROCESS_FIELDS)
    other = sorted(n for n in names if want[1].get(n) != got[1].get(n))
    if other:
        return Result(case.name, FAIL, f"gate fields differ: {other}", "gate")
    if not all(f in got[1] for f in GATE_PROCESS_FIELDS):
        return Result(case.name, FAIL, f"the gate block lacks {GATE_PROCESS_FIELDS}", "gate")
    return Result(case.name, PASS, f"{len(want[0])} bytes before the gate block equal; gate fields equal except {GATE_PROCESS_FIELDS}", "gate")


def compare_body(case: Case, served: bytes) -> Result:
    """Byte for byte, except the process fields of a gate block."""
    if served == case.expected:
        return Result(case.name, PASS, f"{len(served)} bytes equal")
    if case.name in GATE_ROUTES:
        return compare_gate_body(case, served)
    at = first_difference(case.expected, served)
    return Result(case.name, FAIL, f"differs at byte {at} (in-process {len(case.expected)} bytes, served {len(served)}): "
                                   f"{_context(case.expected, at)!r} against {_context(served, at)!r}")


Fetch = Callable[[str], tuple[int, bytes]]


def http_fetch(origin: str, cookie: str) -> Fetch:
    """GET `origin + target` with the session cookie and the client header; (status, exact body bytes)."""
    def fetch(target: str) -> tuple[int, bytes]:
        request = urllib.request.Request(origin + target, headers={"Cookie": cookie, CLIENT_HEADER[0]: CLIENT_HEADER[1]})
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as reply:  # noqa: S310 (loopback only, see check_origin)
                return reply.status, reply.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()
    return fetch


def check_origin(origin: str) -> str:
    """Loopback only, never the owner's backend on 8765."""
    parsed = urllib.parse.urlparse(origin)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.port in (None, 8765):
        raise ValueError(f"the served comparison talks to http://127.0.0.1:<port> other than 8765, not {origin!r}")
    return f"http://127.0.0.1:{parsed.port}"


def run(cases: list[Case], fetch: Fetch) -> Report:
    report = Report()
    for case in cases:
        status, body = fetch(case.target)
        if status != 200:
            report.results.append(Result(case.name, FAIL, f"{case.target} answered {status}: {body[:120]!r}"))
            continue
        report.results.append(compare_body(case, body))
    return report


def print_report(source: str, report: Report, origin: str) -> None:
    print(f"served: {len(report.results)} routes of {source} against {origin}")
    for r in report.results:
        print(f"  {r.status}  {r.name:<22} [{r.mode}] {r.detail}")
    print("served: " + ("OK" if not report.failed else f"FAILED ({len(report.failed)} of {len(report.results)})"))


class AppSession:
    """The hidden smoke build, launched by Node with --fixture under the window watch; ended on exit."""

    def __init__(self, script: Path = SESSION_SCRIPT, node: str = "node") -> None:
        self.script, self.node = script, node
        self.origin, self.cookie = "", ""
        self.watch_failures: list[str] = []
        self._process: subprocess.Popen | None = None

    def __enter__(self) -> "AppSession":
        if not self.script.is_file():
            raise FileNotFoundError(f"missing: {self.script}")
        self._process = subprocess.Popen([self.node, str(self.script)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                         stderr=subprocess.PIPE, creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0,
                                         text=True, encoding="utf-8")
        line = self._first_line()
        info = json.loads(line)
        self.origin, self.cookie = check_origin(info["origin"]), info["cookie"]
        return self

    def _first_line(self) -> str:
        assert self._process is not None and self._process.stdout is not None
        box: list[str] = []
        reader = threading.Thread(target=lambda: box.append(self._process.stdout.readline()), daemon=True)  # type: ignore[union-attr]
        reader.start()
        reader.join(SESSION_WAIT_S)
        if not box or not box[0].strip().startswith("{"):
            self._kill()
            error = self._process.stderr.read() if self._process.stderr else ""
            raise RuntimeError(f"the app session did not start within {SESSION_WAIT_S} s: {error[-600:]}")
        return box[0]

    def _kill(self) -> None:
        if self._process is not None and self._process.poll() is None:
            self._process.kill()

    def __exit__(self, *exc) -> None:
        process = self._process
        if process is None:
            return
        self.watch_failures = self._judge_exit(process)

    @staticmethod
    def _judge_exit(process: subprocess.Popen) -> list[str]:
        """The window-watch verdict, fail closed: a verdict that is missing, doubled, unreadable or from a session that
        did not exit cleanly is a failure, because nothing then proves that no window was shown or focus taken."""
        try:
            if process.stdin:
                process.stdin.close()
            out, _ = process.communicate(timeout=SESSION_EXIT_WAIT_S)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            return [f"the session did not end within {SESSION_EXIT_WAIT_S} s and was killed: no window-watch verdict"]
        except OSError as exc:
            return [f"the session's output could not be read: no window-watch verdict ({exc})"]
        verdicts: list[list[str]] = []
        for line in out.splitlines():
            if line.startswith("{") and '"watch"' in line:
                try:
                    verdicts.append([str(f) for f in json.loads(line)["watch"]])
                except (ValueError, KeyError, TypeError):
                    return ["the window-watch line could not be read: no window-watch verdict"]
        if len(verdicts) != 1:
            return [f"the session printed {len(verdicts)} window-watch lines, not one: no window-watch verdict (exit code {process.returncode})"]
        failures = verdicts[0]
        # The session exits 1 exactly when it reports watch failures; any other non-zero exit is a failed teardown.
        if process.returncode != 0 and not (process.returncode == 1 and failures):
            failures = [*failures, f"the session exited with code {process.returncode} (window watch)"]
        return failures


def _parse(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="crosscheck.served", description=__doc__.splitlines()[0])
    parser.add_argument("--dir", help=f"dump folder (default: ${paths.ENV} or {paths.DEFAULT_DUMP_DIR})")
    parser.add_argument("--origin", help="an existing session: the backend page's origin (http://127.0.0.1:<port>)")
    parser.add_argument("--cookie", help="an existing session: NAME=VALUE of the session cookie")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse(argv)
    folder = paths.dump_dir(args.dir)
    try:
        source, cases = load_cases(folder)
    except (DumpError, OSError, ValueError, KeyError) as exc:
        print(f"served: no usable dump in {folder}: {exc}")
        return 2
    if bool(args.origin) != bool(args.cookie):
        print("served: --origin and --cookie go together")
        return 2
    try:
        if args.origin:
            origin = check_origin(args.origin)
            report = run(cases, http_fetch(origin, args.cookie))
            print_report(source, report, origin)
            return 1 if report.failed else 0
        with AppSession() as app:
            report = run(cases, http_fetch(app.origin, app.cookie))
            print_report(source, report, app.origin)
        for failure in app.watch_failures:
            print(f"served: window watch: {failure}")
        return 1 if report.failed or app.watch_failures else 0
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"served: no session: {exc}")
        return 2


if __name__ == "__main__":
    sys.exit(main())

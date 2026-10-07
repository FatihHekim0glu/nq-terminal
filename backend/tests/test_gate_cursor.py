"""The sealed digest from a cursor (services/gate_cursor.py): a reader that remembers how far it got re-parses only the
bytes appended since, and its answer is exactly the gate's whole-file answer (V032G, growth fix 1).

The terminal checks the sealed-log pin on every health poll, and the gate's whole-file digest grew linearly with the log
(43 MB, 0.3 s a call on 7 October 2026). Every comparison below is against the gate's own unchanged functions
(`oos_gate.sealed_log_digest`, `check_sealed_log_pin`): random appends, CRLF, blank lines, an escaped sealed key, torn
fragments, half-written last lines, edits, truncation, bytes that are not UTF-8, and a 50-chunk sweep over a copy of the
real log. Born failing: before the change services/gate_cursor.py did not exist.

tmp files only; the real log is read or copied, never written."""
from __future__ import annotations

import hashlib
import json
import random
import shutil
import uuid
from pathlib import Path

import pytest

from nq_lab import oos_gate
from nq_lab.config import OOS_LOG
from nq_lab.oos_gate import OOSAccessError
from nq_terminal.services import gate_cursor

SCRATCH = Path("D:/dev/tmp")  # big copies go to D: when it exists (the system drive is kept free)


def reference_digest(log_path):
    """The gate's whole-file digest, unchanged (the frozen experiment specs pin its source by sha256)."""
    return oos_gate.sealed_log_digest(log_path)


def reference_pin(log_path):
    oos_gate.check_sealed_log_pin(log_path)


def outcome(fn, *args):
    """("ok", value) or ("err", exception type name, message), so a refusal compares as exactly as a digest."""
    try:
        return ("ok", fn(*args))
    except Exception as exc:  # noqa: BLE001 - the comparison is the point
        return ("err", type(exc).__name__, str(exc))


def sealed_line(caller="confirm_x", symbol="NQ.V.0"):
    return json.dumps({"caller": caller, "sealed": True, "symbol": symbol, "rows": 3, "spec_sha256": "ab" * 32})


def other_line(n=0):
    return json.dumps({"caller": "terminal", "reason": f"terminal display: row {n}", "rows": 9})


def append(path, raw: bytes):
    with open(path, "ab") as fh:
        fh.write(raw)


def real_sealed_lines() -> list[str]:
    """The real log's sealed lines (what the pin covers), read as the gate reads them."""
    return [x for x in OOS_LOG.read_text(encoding="utf-8").splitlines()
            if not oos_gate.parse_log(x)[1] and any(e.get("sealed") is True for e in oos_gate.parse_log(x)[0])]


def pinned_log(path, extra=()):
    """A log the pin accepts: other lines around the real sealed lines, plus `extra` lines at the end."""
    sealed = real_sealed_lines()
    lines = [other_line(1), sealed[0], other_line(2), "}", *sealed[1:], other_line(3), *extra]
    path.write_bytes("".join(x + "\n" for x in lines).encode("utf-8"))


# ---------------------------------------------------------------- the random appends

HARMLESS = [
    lambda r: sealed_line(symbol=r.choice(["NQ.V.0", "ES.V.0", "ZT.V.0"])).encode() + b"\n",
    lambda r: sealed_line().encode() + b"\r\n",
    lambda r: other_line(r.randrange(1000)).encode() + b"\n",
    lambda r: other_line(r.randrange(1000)).encode() + b"\r\n",
    lambda r: b"\n",
    lambda r: b"\r\n",
    lambda r: b"   \n",
    lambda r: b'{"\\u0073ealed": true, "caller": "escaped"}\n',   # a sealed entry whose text never says sealed
    lambda r: b'{"sealed": "true", "caller": "string"}\n',       # not sealed: the value is a string
    lambda r: b'{"sealed": 1, "caller": "one"}\n',               # not sealed: 1 is not True
    lambda r: b"}\n",                                            # a harmless torn fragment
    lambda r: b"[1, 2]\n",                                       # JSON, but not an entry
    lambda r: b"\r",                                             # a lone CR is a line break when read as text
    lambda r: "\u2028".encode(),                                 # str.splitlines breaks here too
    lambda r: "\x85".encode(),
    lambda r: b"\x0c\x1c",
    lambda r: "caf\u00e9 \u00fc\n".encode(),
]
FLAGGED = [
    lambda r: b'"rows": 3, "sealed": true, "symbol": "ZT.V.0"}\n',
    lambda r: b'"spec_sha256": "ab"}\n',
    lambda r: b'x, "Sealed": true}\r\n',
]


def random_stream(seed: int) -> bytes:
    r = random.Random(seed)
    out = [b"\xef\xbb\xbf"] if r.random() < 0.15 else []
    for _ in range(r.randrange(20, 120)):
        out.append(r.choice(FLAGGED)(r) if r.random() < 0.02 else r.choice(HARMLESS)(r))
    if r.random() < 0.2:
        out.append(b'{"caller": "rebal_v0", "sealed": tr')   # a half-written sealed line at the very end
    if r.random() < 0.05:
        out.insert(r.randrange(len(out)), b"\xff\n")             # not UTF-8: the whole-file read refuses it
    return b"".join(out)


def chunks(raw: bytes, r: random.Random, count: int) -> list[bytes]:
    """`raw` cut at `count - 1` random byte offsets: mid-line, mid-CRLF and mid-character cuts included."""
    cuts = sorted(r.randrange(len(raw) + 1) for _ in range(count - 1)) if raw else []
    edges = [0, *cuts, len(raw)]
    return [raw[a:b] for a, b in zip(edges, edges[1:])]


@pytest.mark.parametrize("seed", range(60))
def test_after_every_random_append_the_cursor_answer_equals_the_whole_file_answer(tmp_path, seed):
    log = tmp_path / "log.jsonl"
    r = random.Random(1000 + seed)
    cursor = None
    for piece in chunks(random_stream(seed), r, r.randrange(1, 25)):
        append(log, piece)
        want = outcome(reference_digest, log)
        scan = outcome(gate_cursor.scan_sealed_log, log, cursor)
        if scan[0] == "ok":
            assert outcome(scan[1].digest, log) == want
            assert outcome(lambda: gate_cursor.sealed_log_digest_from(log, cursor)[0]) == want
            cursor = scan[1].cursor
        else:
            assert scan == want, "a read the whole-file rule refuses is refused the same way"


def test_the_random_streams_reach_every_case():
    """The generator is not vacuous: across the seeds it makes ok digests, refusals, sealed lines and decode errors."""
    kinds = set()
    for seed in range(60):
        raw = random_stream(seed)
        kinds.add("bom" if raw.startswith(b"\xef\xbb\xbf") else "plain")
        kinds.add("flagged" if b'"sealed": true, "symbol": "ZT.V.0"}\n' in raw or b'"spec_sha256": "ab"}' in raw else "-")
        kinds.add("bad utf-8" if b"\xff" in raw else "-")
        kinds.add("partial" if raw.endswith(b"tr") else "-")
    assert {"bom", "plain", "flagged", "bad utf-8", "partial"} <= kinds


# ---------------------------------------------------------------- the named cases


def test_an_escaped_sealed_key_counts_as_a_sealed_line(tmp_path):
    log = tmp_path / "log.jsonl"
    log.write_bytes(b'{"caller": "a"}\n{"\\u0073ealed": true, "caller": "b"}\n')
    _, cursor = gate_cursor.sealed_log_digest_from(log)
    append(log, b'{"\\u0073ealed": true, "caller": "c"}\r\n')
    got, _ = gate_cursor.sealed_log_digest_from(log, cursor)
    assert got == reference_digest(log) and got["lines"] == 2


def test_a_partial_last_line_is_evaluated_but_never_committed(tmp_path):
    log = tmp_path / "log.jsonl"
    whole = (other_line() + "\n" + sealed_line() + "\r\n").encode()
    log.write_bytes(whole + sealed_line(caller="late").encode())     # complete JSON, no line end yet
    scan = gate_cursor.scan_sealed_log(log)
    assert scan.digest(log) == reference_digest(log) and len(scan.sealed) == 2
    assert scan.cursor.offset == len(whole) and scan.cursor.next_line == 3 and len(scan.cursor.sealed) == 1
    log.write_bytes(whole + b'{"caller": "late", "sea')              # the writer had not finished: a torn tail
    later = gate_cursor.scan_sealed_log(log, scan.cursor)
    assert not later.full_pass and later.digest(log) == reference_digest(log) and len(later.sealed) == 1
    append(log, b'led": true}\n')
    last = gate_cursor.scan_sealed_log(log, later.cursor)
    assert not last.full_pass and last.digest(log) == reference_digest(log) and len(last.sealed) == 2


def test_a_half_written_line_that_could_be_sealed_is_refused_like_the_whole_file(tmp_path):
    log = tmp_path / "log.jsonl"
    log.write_bytes((other_line() + "\n").encode())
    _, cursor = gate_cursor.sealed_log_digest_from(log)
    append(log, b'{"caller": "rebal_v0", "sealed": tr')
    with pytest.raises(OOSAccessError, match="fragment") as caught:
        gate_cursor.sealed_log_digest_from(log, cursor)
    assert outcome(reference_digest, log) == ("err", "OOSAccessError", str(caught.value))


def test_a_cr_split_from_its_lf_by_an_append_reads_as_one_line_end(tmp_path):
    log = tmp_path / "log.jsonl"
    log.write_bytes((sealed_line() + "\r").encode())
    first = gate_cursor.scan_sealed_log(log)
    assert first.cursor.offset == 0 and first.digest(log) == reference_digest(log)
    append(log, ("\n" + other_line() + "\n").encode())
    second = gate_cursor.scan_sealed_log(log, first.cursor)
    assert second.digest(log) == reference_digest(log) and second.cursor.next_line == 3


def test_editing_the_prefix_forces_a_full_pass(tmp_path):
    log = tmp_path / "log.jsonl"
    pinned_log(log)
    scan = gate_cursor.scan_sealed_log(log)
    raw = log.read_bytes()
    log.write_bytes(raw.replace(b"row 1", b"row 7", 1))                # same size, one byte changed in the prefix
    again = gate_cursor.scan_sealed_log(log, scan.cursor)
    assert again.full_pass and again.digest(log) == reference_digest(log)


def test_removing_a_sealed_line_forces_a_full_pass_and_the_pin_fails(tmp_path):
    log = tmp_path / "log.jsonl"
    pinned_log(log)
    scan = gate_cursor.scan_sealed_log(log)
    gate_cursor.check_sealed_digest_pin(scan.digest(log), log)            # the pinned copy passes
    sealed = real_sealed_lines()
    log.write_bytes(log.read_bytes().replace((sealed[0] + "\n").encode(), b"", 1))
    append(log, (other_line(9) + "\n").encode() * 40)                  # grown past the old cursor again
    again = gate_cursor.scan_sealed_log(log, scan.cursor)
    assert again.full_pass
    got = outcome(lambda: gate_cursor.check_sealed_digest_pin(again.digest(log), log))
    assert got[0] == "err" and got == outcome(reference_pin, log) == outcome(oos_gate.check_sealed_log_pin, log)


def test_truncation_forces_a_full_pass(tmp_path):
    log = tmp_path / "log.jsonl"
    pinned_log(log, extra=[sealed_line()])
    scan = gate_cursor.scan_sealed_log(log)
    log.write_bytes(log.read_bytes()[: scan.cursor.offset // 2])
    again = gate_cursor.scan_sealed_log(log, scan.cursor)
    assert again.full_pass and outcome(again.digest, log) == outcome(reference_digest, log)
    log.write_bytes(b"")
    empty = gate_cursor.scan_sealed_log(log, again.cursor)
    assert empty.full_pass and empty.digest(log) == reference_digest(log) == {"lines": 0,
                                                                            "sha256": hashlib.sha256(b"").hexdigest()}


def test_a_flagged_fragment_in_the_committed_prefix_still_raises(tmp_path):
    log = tmp_path / "log.jsonl"
    log.write_bytes((other_line() + "\n" + '"spec_sha256": "ab"}' + "\n" + sealed_line() + "\n").encode())
    scan = gate_cursor.scan_sealed_log(log)
    assert scan.cursor.flagged == ((2, '"spec_sha256": "ab"}'),)
    for n in range(3):
        append(log, (other_line(n) + "\n").encode())
        later = gate_cursor.scan_sealed_log(log, scan.cursor)
        assert not later.full_pass
        with pytest.raises(OOSAccessError, match="fragment") as caught:
            gate_cursor.sealed_log_digest_from(log, scan.cursor)
        assert outcome(reference_digest, log) == ("err", "OOSAccessError", str(caught.value))
        scan = later


def test_the_first_flagged_fragment_is_the_one_reported(tmp_path):
    log = tmp_path / "log.jsonl"
    log.write_bytes(b'"sealed": 1}\n')
    cursor = gate_cursor.scan_sealed_log(log).cursor
    append(log, b'"spec_sha256": "cd"}\n')
    got = outcome(lambda: gate_cursor.scan_sealed_log(log, cursor).digest(log))
    assert got[0] == "err" and "line 1 " in got[2] and got == outcome(reference_digest, log)


def test_parse_log_sees_no_more_than_the_appended_lines_plus_one(tmp_path, monkeypatch):
    log = tmp_path / "log.jsonl"
    log.write_bytes("".join(other_line(n) + "\n" for n in range(500)).encode())
    cursor = gate_cursor.scan_sealed_log(log).cursor
    seen = []
    real = oos_gate.parse_log

    def spy(text):
        seen.append(text)
        return real(text)

    monkeypatch.setattr(oos_gate, "parse_log", spy)
    append(log, ("".join(other_line(n) + "\n" for n in range(7)) + sealed_line()[:20]).encode())
    scan = gate_cursor.scan_sealed_log(log, cursor)
    assert not scan.full_pass and len(seen) <= 7 + 1
    seen.clear()
    gate_cursor.scan_sealed_log(log, scan.cursor)
    assert len(seen) <= 1, "an unchanged log re-reads only its unfinished last line"


def test_a_missing_log_is_zero_sealed_lines_as_before(tmp_path):
    log = tmp_path / "absent.jsonl"
    assert gate_cursor.sealed_log_digest_from(log)[0] == reference_digest(log) == {"lines": 0,
                                                                              "sha256": hashlib.sha256(b"").hexdigest()}
    assert outcome(oos_gate.check_sealed_log_pin, log) == outcome(reference_pin, log)


def test_bytes_that_are_not_utf8_are_refused_like_the_whole_file_read(tmp_path):
    log = tmp_path / "log.jsonl"
    log.write_bytes((other_line() + "\n").encode())
    cursor = gate_cursor.scan_sealed_log(log).cursor
    append(log, b"\xff\xfe\n")
    got = outcome(gate_cursor.scan_sealed_log, log, cursor)
    assert got[0] == "err" and got == outcome(reference_digest, log)
    assert got[1] == "UnicodeDecodeError"


def test_a_cursor_from_another_log_forces_a_full_pass(tmp_path):
    one, two = tmp_path / "one.jsonl", tmp_path / "two.jsonl"
    one.write_bytes((sealed_line() + "\n").encode())
    two.write_bytes((other_line() + "\n" + other_line() + "\n").encode())
    scan = gate_cursor.scan_sealed_log(two, gate_cursor.scan_sealed_log(one).cursor)
    assert scan.full_pass and scan.digest(two) == reference_digest(two)


def test_the_cursor_round_trips_through_a_plain_dict_and_refuses_malformed_ones(tmp_path):
    log = tmp_path / "log.jsonl"
    log.write_bytes((sealed_line() + "\n" + '"sealed": x}' + "\n").encode())
    cursor = gate_cursor.scan_sealed_log(log).cursor
    doc = json.loads(json.dumps(cursor.as_dict()))
    assert gate_cursor.SealedLogCursor.from_dict(doc) == cursor
    bad = [None, [], {}, {**doc, "offset": -1}, {**doc, "offset": True}, {**doc, "next_line": 0},
           {**doc, "prefix_sha256": "xy"}, {**doc, "sealed": [1]}, {**doc, "flagged": [[1, "a"], [2, "b"]]},
           {**doc, "flagged": [["1", "a"]]}, {**doc, "offset": 1.5}]
    for item in bad:
        with pytest.raises(ValueError):
            gate_cursor.SealedLogCursor.from_dict(item)


def test_the_pin_check_from_a_digest_matches_the_whole_file_pin_check(tmp_path):
    log = tmp_path / "log.jsonl"
    pinned_log(log)
    assert outcome(oos_gate.check_sealed_log_pin, log) == outcome(reference_pin, log) == ("ok", None)
    append(log, (sealed_line() + "\n").encode())
    got = outcome(lambda: gate_cursor.check_sealed_digest_pin(gate_cursor.sealed_log_digest_from(log)[0], log))
    assert got[0] == "err" and got == outcome(reference_pin, log) == outcome(oos_gate.check_sealed_log_pin, log)


# ---------------------------------------------------------------- the real log (read, or copied; never written)


def test_the_real_log_gives_the_gates_digest_and_pin_answer():
    before = outcome(reference_digest, OOS_LOG)
    scan = gate_cursor.scan_sealed_log(OOS_LOG)
    after = outcome(reference_digest, OOS_LOG)
    assert outcome(scan.digest, OOS_LOG) in (before, after), "the real log may grow between the reads"
    pin = outcome(lambda: gate_cursor.check_sealed_digest_pin(scan.digest(OOS_LOG), OOS_LOG))
    assert pin == outcome(reference_pin, OOS_LOG)


@pytest.fixture
def scratch(tmp_path):
    if not SCRATCH.is_dir():
        yield tmp_path
        return
    folder = SCRATCH / f"oos-gate-sweep-{uuid.uuid4().hex}"
    folder.mkdir()
    try:
        yield folder
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def test_equality_sweep_over_fifty_appended_chunks_of_a_copy_of_the_real_log(scratch):
    raw = OOS_LOG.read_bytes()
    assert len(raw) > 1_000_000, "the real log is the case this sweep is for"
    log = scratch / "oos_access_log.jsonl"
    log.write_bytes(b"")
    cursor, full_passes = None, 0
    for piece in chunks(raw, random.Random(7), 50):
        append(log, piece)
        scan = gate_cursor.scan_sealed_log(log, cursor)
        full_passes += scan.full_pass
        assert outcome(scan.digest, log) == outcome(reference_digest, log)
        cursor = scan.cursor
    assert full_passes == 1, "only the first call reads the whole log"
    assert log.read_bytes() == raw


def test_an_incremental_call_never_holds_the_whole_log_in_memory(tmp_path):
    """The prefix is hashed in fixed chunks through a file handle: a call after an append allocates a few chunks and
    the appended bytes, not a copy of the log (43 MB on 7 October 2026, over 128 MB later)."""
    import tracemalloc

    log = tmp_path / "log.jsonl"
    log.write_bytes("".join(other_line(n) + "\n" for n in range(100_000)).encode())  # about 6 MB
    size = log.stat().st_size
    cursor = gate_cursor.scan_sealed_log(log).cursor
    append(log, (other_line(1) + "\n").encode())
    tracemalloc.start()
    try:
        scan = gate_cursor.scan_sealed_log(log, cursor)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert not scan.full_pass and scan.digest(log) == reference_digest(log)
    assert peak < size // 4, f"peak {peak} bytes for a {size} byte log"


def test_an_appended_log_is_still_verified_against_its_whole_prefix(tmp_path):
    log = tmp_path / "log.jsonl"
    log.write_bytes("".join(other_line(n) + "\n" for n in range(3000)).encode())
    cursor = gate_cursor.scan_sealed_log(log).cursor
    raw = bytearray(log.read_bytes())
    raw[len(raw) // 2] ^= 0x01  # one flipped byte far from the end, mid-prefix, past the first hash chunk
    log.write_bytes(bytes(raw) + (other_line(9) + "\n").encode())
    assert gate_cursor.scan_sealed_log(log, cursor).full_pass

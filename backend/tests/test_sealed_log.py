"""The app's sealed-log cursor (services/sealed_log.py, V032G growth fix 1): the health pin from the appended tail only,
memoised on the files' stat, persisted under <state>/cache through the result cache's confined writer.

The answers are compared with the gate's own whole-file functions (`oos_gate.check_sealed_log_pin`,
`sealed_log_digest`); the lab's tests/test_oos_gate_incremental.py pins those against the rule as it was before the
cursor. Every log here is a temporary file; the real log is never written. Born failing: before the change the module
did not exist."""
from __future__ import annotations

import hashlib
import json
import random
import threading
from pathlib import Path

import pytest

from nq_lab import oos_gate
from nq_terminal.services import result_cache as rc
from nq_terminal.services import sealed_log

OTHER = json.dumps({"caller": "terminal", "reason": "nqt-test other", "rows": 3})
SEALED = json.dumps({"caller": "x", "sealed": True, "reason": "nqt-test sealed", "spec_sha256": "ab" * 32})


def outcome(fn, *args):
    try:
        return ("ok", fn(*args))
    except Exception as exc:  # noqa: BLE001 - the comparison is the point
        return ("err", type(exc).__name__, str(exc))


def append(path: Path, raw: bytes) -> None:
    with path.open("ab") as fh:
        fh.write(raw)


@pytest.fixture
def lab(tmp_path: Path):
    root, state = tmp_path / "root", tmp_path / "state"
    (root / "results").mkdir(parents=True)
    state.mkdir()
    log = root / "results" / "oos_access_log.jsonl"
    log.write_bytes((OTHER + "\n" + SEALED + "\n").encode())
    return root, state, log


def tracker(root: Path, state: Path | None) -> sealed_log.SealedLogTracker:
    return sealed_log.SealedLogTracker(state_dir=state, data_root=root)


def cache_files(state: Path) -> list[Path]:
    folder = state / rc.CACHE_FOLDER
    return sorted(folder.glob("*")) if folder.exists() else []


# ---------------------------------------------------------------- the answers


@pytest.mark.parametrize("seed", range(12))
def test_check_pin_and_digest_answer_as_the_whole_file_functions_after_random_appends(lab, seed):
    root, state, log = lab
    r = random.Random(seed)
    pieces = [OTHER + "\n", OTHER + "\r\n", SEALED + "\n", "\n", "}\n", '"sealed": tr', "\r", '{"\\u0073ealed": true}\n']
    t = tracker(root, state)
    for _ in range(30):
        append(log, r.choice(pieces).encode())
        assert outcome(t.check_pin, log) == outcome(oos_gate.check_sealed_log_pin, log)
        assert outcome(t.digest, log) == outcome(oos_gate.sealed_log_digest, log)
    assert t.full_passes == 1


def test_a_refused_fragment_is_refused_on_every_call_without_a_full_pass(lab):
    root, state, log = lab
    append(log, b'"spec_sha256": "ab"}\n')
    t = tracker(root, state)
    for _ in range(3):
        append(log, (OTHER + "\n").encode())
        got = outcome(t.check_pin, log)
        assert got[0] == "err" and "fragment" in got[2] and got == outcome(oos_gate.check_sealed_log_pin, log)
    assert t.full_passes == 1


def test_a_missing_log_answers_as_before(tmp_path):
    root = tmp_path / "root"
    log = root / "results" / "oos_access_log.jsonl"
    t = tracker(root, tmp_path / "state")
    assert outcome(t.check_pin, log) == outcome(oos_gate.check_sealed_log_pin, log)
    assert outcome(t.digest, log) == outcome(oos_gate.sealed_log_digest, log)


# ---------------------------------------------------------------- the memo


def test_remember_reuses_the_answer_only_while_every_file_keeps_its_stat(lab):
    root, state, log = lab
    other = root / "results" / "oos_openings.json"
    other.write_text("{}", encoding="utf-8")
    t = tracker(root, state)
    calls = []

    def compute():
        calls.append(1)
        return len(calls)

    assert t.remember((log, other), compute) == 1
    assert t.remember((log, other), compute) == 1
    append(log, b"\n")
    assert t.remember((log, other), compute) == 2
    other.write_text('{"a": 1}', encoding="utf-8")
    assert t.remember((log, other), compute) == 3
    other.unlink()
    assert t.remember((log, other), compute) == 4
    assert t.remember((log, other), compute) == 4, "a missing file is a stable state too"
    assert t.remember((other, log), compute) == 5, "another set of files has its own memo"


def test_remember_does_not_keep_a_failed_computation(lab):
    root, state, log = lab
    t = tracker(root, state)
    with pytest.raises(RuntimeError):
        t.remember((log,), lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    assert t.remember((log,), lambda: "fine") == "fine"


# ---------------------------------------------------------------- the persisted cursor


def big_log(log: Path, size: int) -> None:
    line = (OTHER + "\n").encode()
    log.write_bytes(line * (size // len(line) + 1) + (SEALED + "\n").encode())


def test_a_small_log_never_writes_the_state_folder(lab):
    root, state, log = lab
    t = tracker(root, state)
    for _ in range(5):
        append(log, (OTHER + "\n").encode())
        outcome(t.check_pin, log)
    assert sealed_log.PERSIST_STEP_BYTES == 1024**2 and log.stat().st_size < sealed_log.PERSIST_STEP_BYTES
    assert not (state / rc.CACHE_FOLDER).exists()


def test_a_large_log_persists_one_cursor_file_and_rewrites_it_only_after_a_step_of_growth(lab, monkeypatch):
    monkeypatch.setattr(sealed_log, "PERSIST_STEP_BYTES", 64 * 1024)
    root, state, log = lab
    big_log(log, 200 * 1024)
    t = tracker(root, state)
    outcome(t.check_pin, log)
    files = cache_files(state)
    assert len(files) == 1 and rc.DISK_NAME.fullmatch(files[0].name) and files[0].suffix == ".bin"
    first = files[0].read_bytes()
    append(log, (OTHER + "\n").encode() * 10)
    outcome(t.check_pin, log)
    assert files[0].read_bytes() == first, "a small append is not worth a write"
    append(log, (OTHER + "\n").encode() * 2000)
    outcome(t.check_pin, log)
    assert cache_files(state) == files and files[0].read_bytes() != first
    assert t.writes == 2


def test_a_second_tracker_resumes_from_the_stored_cursor(lab, monkeypatch):
    monkeypatch.setattr(sealed_log, "PERSIST_STEP_BYTES", 1)
    root, state, log = lab
    outcome(tracker(root, state).check_pin, log)
    append(log, (SEALED + "\n").encode())
    seen = []
    real = oos_gate.parse_log
    monkeypatch.setattr(oos_gate, "parse_log", lambda text: seen.append(text) or real(text))
    second = tracker(root, state)
    got = outcome(second.digest, log)
    assert second.full_passes == 0 and len(seen) == 1, "only the appended line is parsed"
    assert got == outcome(oos_gate.sealed_log_digest, log)


@pytest.mark.parametrize("damage", [b"", b"not a cache entry", None])
def test_a_damaged_cursor_file_is_ignored(lab, monkeypatch, damage):
    monkeypatch.setattr(sealed_log, "PERSIST_STEP_BYTES", 1)
    root, state, log = lab
    outcome(tracker(root, state).check_pin, log)
    [stored] = cache_files(state)
    raw = stored.read_bytes()
    head, _, body = raw.partition(b"\n")
    if damage is None:  # a well-formed entry whose body is not a cursor (its sha256 recomputed to match)
        header = json.loads(head)
        body = b'{"offset": -1}'
        header.update(sha256=hashlib.sha256(body).hexdigest(), length=len(body))
        damage = json.dumps(header, separators=(",", ":")).encode() + b"\n" + body
    stored.write_bytes(damage)
    again = tracker(root, state)
    assert outcome(again.digest, log) == outcome(oos_gate.sealed_log_digest, log)
    assert again.full_passes == 1


def rewrite_entry(stored: Path, body: bytes) -> None:
    """Put `body` in a stored cache entry with its header's sha256 and length recomputed: anyone can do this, since the
    header has no key."""
    header = json.loads(stored.read_bytes().partition(b"\n")[0])
    header.update(sha256=hashlib.sha256(body).hexdigest(), length=len(body))
    stored.write_bytes(json.dumps(header, separators=(",", ":")).encode() + b"\n" + body)


def pin_to_one_sealed_line(monkeypatch, log: Path) -> None:
    """Pin the gate on the fixture log as it stands (one sealed line), so a second sealed read breaks the pin."""
    from nq_lab import guards

    got = oos_gate.sealed_log_digest(log)
    assert got["lines"] == 1
    monkeypatch.setitem(guards.SEALED_GATE_PINS, "sealed_log_lines", got["lines"])
    monkeypatch.setitem(guards.SEALED_GATE_PINS, "sealed_log_sha256", got["sha256"])


@pytest.mark.parametrize("forge", ["sealed", "flagged"])
def test_a_forged_cursor_with_a_recomputed_header_cannot_make_the_pin_read_as_fine(lab, monkeypatch, forge):
    """Born failing: a stored cursor's derived fields were trusted once its prefix hash matched, so a cursor rewritten to
    drop a sealed line (or the refused fragment) made the pin read as fine while the gate refused."""
    from nq_terminal.services import gate_cursor

    monkeypatch.setattr(sealed_log, "PERSIST_STEP_BYTES", 1)
    root, state, log = lab
    pin_to_one_sealed_line(monkeypatch, log)
    pinned = tuple(line for line in log.read_text(encoding="utf-8").splitlines() if '"sealed"' in line)
    append(log, (SEALED.replace("nqt-test sealed", "nqt-test second") + "\n").encode() if forge == "sealed"
           else b'"spec_sha256": "ab"}\n')
    append(log, (OTHER + "\n").encode())
    assert outcome(tracker(root, state).check_pin, log)[0] == "err"
    [stored] = cache_files(state)
    true = gate_cursor.scan_sealed_log(log).cursor
    lie = gate_cursor.SealedLogCursor(true.offset, true.next_line, pinned, (), true.prefix_sha256)
    assert lie != true
    rewrite_entry(stored, json.dumps(lie.as_dict(), separators=(",", ":")).encode())
    again = tracker(root, state)
    got = outcome(again.check_pin, log)
    assert got[0] == "err" and got == outcome(oos_gate.check_sealed_log_pin, log)
    assert outcome(again.digest, log) == outcome(oos_gate.sealed_log_digest, log)
    assert again.full_passes == 1


def test_a_tampered_stored_cursor_is_ignored_and_none_is_stored_in_plain_text(lab, monkeypatch):
    monkeypatch.setattr(sealed_log, "PERSIST_STEP_BYTES", 1)
    root, state, log = lab
    outcome(tracker(root, state).check_pin, log)
    [stored] = cache_files(state)
    body = stored.read_bytes().partition(b"\n")[2]
    assert b"prefix_sha256" not in body and b"nqt-test sealed" not in body, "the stored cursor is sealed, not plain"
    flipped = bytearray(body)
    flipped[len(flipped) // 2] ^= 0x01
    rewrite_entry(stored, bytes(flipped))
    again = tracker(root, state)
    assert outcome(again.digest, log) == outcome(oos_gate.sealed_log_digest, log)
    assert again.full_passes == 1


def test_a_change_to_the_gate_code_drops_the_stored_cursor(lab, monkeypatch, tmp_path):
    monkeypatch.setattr(sealed_log, "PERSIST_STEP_BYTES", 1)
    source = tmp_path / "oos_gate_stand_in.py"
    source.write_text("# version 1\n", encoding="utf-8")
    monkeypatch.setattr(sealed_log, "gate_source", lambda: source)
    root, state, log = lab
    outcome(tracker(root, state).check_pin, log)
    resumed = tracker(root, state)
    outcome(resumed.check_pin, log)
    assert resumed.full_passes == 0
    source.write_text("# version 22\n", encoding="utf-8")
    fresh = tracker(root, state)
    outcome(fresh.check_pin, log)
    assert fresh.full_passes == 1


def test_two_roots_sharing_a_state_folder_never_use_each_others_cursor(lab, monkeypatch, tmp_path):
    monkeypatch.setattr(sealed_log, "PERSIST_STEP_BYTES", 1)
    root, state, log = lab
    other_root = tmp_path / "other"
    (other_root / "results").mkdir(parents=True)
    other_log = other_root / "results" / "oos_access_log.jsonl"
    other_log.write_bytes(log.read_bytes())
    outcome(tracker(root, state).check_pin, log)
    second = tracker(other_root, state)
    assert outcome(second.digest, other_log) == outcome(oos_gate.sealed_log_digest, other_log)
    assert second.full_passes == 1


def test_no_state_folder_means_no_persistence(lab, monkeypatch):
    monkeypatch.setattr(sealed_log, "PERSIST_STEP_BYTES", 1)
    root, state, log = lab
    t = tracker(root, None)
    assert outcome(t.digest, log) == outcome(oos_gate.sealed_log_digest, log)
    assert t.writes == 0 and not (state / rc.CACHE_FOLDER).exists()


def test_a_state_folder_inside_the_research_results_is_refused_and_never_written(lab, monkeypatch):
    """The cursor goes through the result cache's confined writer, which refuses a cache folder under results/."""
    monkeypatch.setattr(sealed_log, "PERSIST_STEP_BYTES", 1)
    root, _, log = lab
    from nq_lab.config import ROOT

    inside = ROOT / "results" / "nqt-never-created"
    t = tracker(root, inside)
    assert outcome(t.digest, log) == outcome(oos_gate.sealed_log_digest, log)
    assert t.writes == 0 and not inside.exists()


# ---------------------------------------------------------------- threads


def test_concurrent_checks_while_the_log_grows_agree_with_the_whole_file_answer(lab):
    root, state, log = lab
    t = tracker(root, state)
    errors: list[BaseException] = []

    def poll():
        try:
            for _ in range(25):
                outcome(t.check_pin, log)
        except BaseException as exc:  # noqa: BLE001 - surfaced below
            errors.append(exc)

    threads = [threading.Thread(target=poll) for _ in range(6)]
    for thread in threads:
        thread.start()
    for n in range(50):
        append(log, (OTHER + "\n").encode() if n % 7 else (SEALED + "\n").encode())
    for thread in threads:
        thread.join()
    assert errors == []
    assert outcome(t.digest, log) == outcome(oos_gate.sealed_log_digest, log)
    assert outcome(t.check_pin, log) == outcome(oos_gate.check_sealed_log_pin, log)


# ---------------------------------------------------------------- the app's tracker


def test_tracker_for_builds_one_tracker_per_app_state(tmp_path):
    class Settings:
        state_dir = tmp_path / "state"
        data_root = tmp_path / "root"

    class State:
        settings = Settings()

    state = State()
    first = sealed_log.tracker_for(state)
    assert sealed_log.tracker_for(state) is first and getattr(state, sealed_log.STATE_KEY) is first


def test_two_spellings_of_one_log_share_one_cursor(lab):
    root, state, log = lab
    t = tracker(root, state)
    outcome(t.check_pin, log)
    spelt = log.parent / ".." / "results" / log.name
    append(log, (OTHER + "\n").encode())
    assert outcome(t.check_pin, spelt) == outcome(oos_gate.check_sealed_log_pin, spelt)
    assert t.full_passes == 1


# ---------------------------------------------------------------- the user seal


def test_user_seal_opens_only_its_own_untouched_blobs():
    from nq_terminal.services import user_seal

    blob = user_seal.seal(b"cursor body", b"purpose one")
    assert blob is not None and b"cursor body" not in blob
    assert user_seal.unseal(blob, b"purpose one") == b"cursor body"
    assert user_seal.unseal(blob, b"purpose two") is None, "another purpose cannot open it"
    assert user_seal.unseal(blob[:-1] + bytes([blob[-1] ^ 1]), b"purpose one") is None
    assert user_seal.unseal(b"", b"purpose one") is None
    assert user_seal.unseal(b"not a blob", b"purpose one") is None

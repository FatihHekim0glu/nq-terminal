"""Tail one backend.log while a launch runs and time-stamp the lines that matter (read only).

Usage: tailog.py <backend.log> <max_seconds>

The log may not exist yet (the shell creates it); it is opened with a handle that shares read, write and delete, so the shell's own
appends and rotation are never refused. Times are perf_counter intervals anchored to the epoch once (the anchor is taken on a tick of
time.time(), so it is good to about a millisecond). The parent closes stdin to stop; at max_seconds it stops by itself. Nothing here
writes a file: the one JSON document goes to stdout when the tail stops, {"seen": {key: [epoch ms, ...]}, "lines": [[epoch ms, text]],
"firstOpenMs": epoch ms or null}.
"""
import json
import os
import sys
import threading
import time

PATTERNS = {
    'started': b'Started server process',
    'startup_done': b'Application startup complete',
    'ready': b'NQT-READY',
    'proof': b'GET /api/desktop/proof',
    'session': b'GET /api/session ',
    'root': b'"GET / HTTP',
}
MAX_KEPT_LINES = 60
READ_CHUNK = 65536
GENERIC_READ = 0x80000000
SHARE_ALL = 0x1 | 0x2 | 0x4
OPEN_EXISTING = 3
FILE_ATTRIBUTE_NORMAL = 0x80


def open_shared(path):
    """A read handle that shares read, write and delete (Python's open() does not share delete)."""
    import _winapi
    return _winapi.CreateFile(path, GENERIC_READ, SHARE_ALL, 0, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, 0)


def read_available(handle):
    """The bytes appended since the last read (empty at the end of the file)."""
    import _winapi
    data, _error = _winapi.ReadFile(handle, READ_CHUNK)
    return data


def epoch_anchor():
    """(epoch seconds, perf_counter) taken right after time.time() ticks, so the pair agrees to about 1 ms."""
    first = time.time()
    while True:
        now = time.time()
        if now != first:
            return now, time.perf_counter()


def watch_stdin(stop):
    """Sets `stop` when the parent closes stdin (or writes anything)."""
    try:
        sys.stdin.buffer.read()
    finally:
        stop.set()


def main():
    path, max_s = sys.argv[1], float(sys.argv[2])
    stop = threading.Event()
    threading.Thread(target=watch_stdin, args=(stop,), daemon=True).start()
    epoch0, perf0 = epoch_anchor()

    def to_epoch_ms(p):
        return round((epoch0 + (p - perf0)) * 1000.0, 2)

    seen, lines = {}, []
    buf, handle, first_open = b'', None, None
    began = time.perf_counter()
    while time.perf_counter() - began < max_s and not stop.is_set():
        if handle is None:
            try:
                handle = open_shared(path)
                first_open = time.perf_counter()
            except OSError:
                time.sleep(0.001)
                continue
        chunk = read_available(handle)
        now = time.perf_counter()
        if not chunk:
            time.sleep(0.001)
            continue
        buf += chunk
        while b'\n' in buf:
            line, buf = buf.split(b'\n', 1)
            for key, pattern in PATTERNS.items():
                if pattern in line:
                    seen.setdefault(key, []).append(to_epoch_ms(now))
            if len(lines) < MAX_KEPT_LINES:
                lines.append([to_epoch_ms(now), line[:140].decode('utf-8', 'replace')])
    if handle is not None:
        import _winapi
        _winapi.CloseHandle(handle)
    doc = {'seen': seen, 'lines': lines, 'firstOpenMs': None if first_open is None else to_epoch_ms(first_open)}
    sys.stdout.write(json.dumps(doc))
    sys.stdout.flush()


if __name__ == '__main__':
    main()

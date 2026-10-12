"""Time the backend's import in process, and read which start-path modules have no current bytecode (read only).

Adapted from the research tool D:/dev/v04/research/tools/import_timing.py. Two modes.

Import mode (started by startrows.mjs importTimeCommand, as the shell starts the backend):

  <lab>/.venv/Scripts/python.exe -E -s -X utf8 -X pycache_prefix=<run>/pycache importtime.py --scratch <run>/state

The bytecode prefix is required and must lie outside the repository, and so must the scratch folder: the import compiles into the
prefix, never into a __pycache__ of the repository or the venv. The backend is pointed at the checked-in fixtures folder (no research file
is read), at the scratch state folder, with NQT_JOBS=off. Importing nq_terminal.app and taking its app object builds the application
but runs no lifespan: no lock, no prewarm, no socket, no price read. The result (the import time, the modules loaded and the
bytecode check of every source module that was loaded) is one JSON object on stdout. The script writes no file: the caller makes the
scratch folder, and the interpreter itself writes bytecode into the prefix.

Check mode (no application import):

  python importtime.py --check-bytecode FILE [FILE ...]

prints {file: "current" | "missing" | "stale"} for the .pyc each source would use in place, without writing anything.

Exit codes: 0 done, 2 refused (bad arguments or an unsafe place to write).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import time
from pathlib import Path

TERMINAL = Path(__file__).resolve().parents[3]
BACKEND = TERMINAL / "backend"
HEAVY = (
    "numpy", "pandas", "pyarrow", "scipy", "scipy.stats", "scipy.cluster.hierarchy", "scipy.spatial.distance",
    "pandas_market_calendars", "exchange_calendars", "nautilus_trader", "uvicorn", "fastapi", "pydantic",
    "statsmodels", "sklearn", "numba",
)
HEADER_SIZE = 16
FLAG_HASH_BASED = 0b1
FLAG_CHECK_SOURCE = 0b10
EXIT_REFUSED = 2


def inside(path: Path, root: Path) -> bool:
    """Whether `path` is `root` or lies under it (case-insensitive, links resolved as far as the path exists)."""
    a = os.path.normcase(os.path.abspath(path))
    b = os.path.normcase(os.path.abspath(root))
    return a == b or a.startswith(b + os.sep)


def bytecode_status(source: str) -> str:
    """'current', 'missing' or 'stale' for the .pyc `source` would load in place (sys.pycache_prefix is ignored), read only."""
    held = sys.pycache_prefix
    sys.pycache_prefix = None
    try:
        pyc = Path(importlib.util.cache_from_source(source))
    finally:
        sys.pycache_prefix = held
    try:
        head = pyc.read_bytes()[:HEADER_SIZE]
        stat = os.stat(source)
    except OSError:
        return "missing"
    if len(head) < HEADER_SIZE or head[:4] != importlib.util.MAGIC_NUMBER:
        return "stale"
    flags = int.from_bytes(head[4:8], "little")
    if flags & FLAG_HASH_BASED:
        if not flags & FLAG_CHECK_SOURCE:
            return "current"  # an unchecked hash pyc is trusted by the interpreter as it is
        digest = importlib.util.source_hash(Path(source).read_bytes())
        return "current" if head[8:16] == digest else "stale"
    mtime = int.from_bytes(head[8:12], "little")
    size = int.from_bytes(head[12:16], "little")
    same = mtime == (int(stat.st_mtime) & 0xFFFFFFFF) and size == (stat.st_size & 0xFFFFFFFF)
    return "current" if same else "stale"


def source_modules() -> dict[str, str]:
    """Loaded modules that came from a .py file: {module name: source path}. Built-in, frozen and extension modules are not listed."""
    found: dict[str, str] = {}
    for name, module in list(sys.modules.items()):
        spec = getattr(module, "__spec__", None)
        origin = getattr(spec, "origin", None) if spec else None
        if origin and origin.endswith(".py") and os.path.isfile(origin):
            found[name] = origin
    return found


def bytecode_report() -> dict:
    """Every loaded source module's bytecode state: the counts, and the names of the missing and the stale."""
    states = {name: bytecode_status(src) for name, src in sorted(source_modules().items())}
    return {
        "checked": len(states),
        "current": sum(1 for s in states.values() if s == "current"),
        "missing": [n for n, s in states.items() if s == "missing"],
        "stale": [n for n, s in states.items() if s == "stale"],
    }


def refusal(scratch: Path) -> str | None:
    """Why the import mode must not run, or None. Nothing may be written inside the repository."""
    prefix = sys.pycache_prefix
    if not prefix:
        return "no -X pycache_prefix: the import would write bytecode next to the sources"
    if inside(Path(prefix), TERMINAL):
        return f"pycache_prefix {prefix} is inside the repository {TERMINAL}"
    if inside(scratch, TERMINAL):
        return f"the scratch folder {scratch} is inside the repository {TERMINAL}"
    return None


def import_mode(scratch: Path) -> int:
    why = refusal(scratch)
    if why:
        print(f"importtime.py refused: {why}", file=sys.stderr)
        return EXIT_REFUSED
    if not scratch.is_dir():
        print(f"importtime.py refused: the scratch folder {scratch} does not exist (the caller makes it)", file=sys.stderr)
        return EXIT_REFUSED
    os.environ["NQT_FIXTURE_DIR"] = str(BACKEND / "tests" / "fixtures")
    os.environ["NQT_STATE_DIR"] = str(scratch)
    os.environ["NQT_JOBS"] = "off"
    sys.path.insert(0, str(BACKEND))
    t0 = time.perf_counter()
    from nq_terminal.threadcaps import cap_native_pools

    cap_native_pools(os.environ)
    t1 = time.perf_counter()
    import nq_terminal.app as app_module

    t2 = time.perf_counter()
    routes = len(app_module.app.routes)  # the app object: built at import today, on first access once the module attribute is lazy
    t3 = time.perf_counter()
    result = {
        "python": sys.version,
        "executable": sys.executable,
        "flags": {"ignore_environment": sys.flags.ignore_environment, "no_user_site": sys.flags.no_user_site, "utf8_mode": sys.flags.utf8_mode},
        "pycache_prefix": sys.pycache_prefix,
        "import_threadcaps_s": round(t1 - t0, 4),
        "import_app_s": round(t2 - t1, 4),
        "app_object_s": round(t3 - t2, 4),
        "import_total_s": round(t3 - t0, 4),
        "modules_loaded": len(sys.modules),
        "routes": routes,
        "heavy_modules_loaded": {name: name in sys.modules for name in HEAVY},
        "nq_terminal_file": str(Path(app_module.__file__).resolve()),
        "bytecode": bytecode_report(),
    }
    print(json.dumps(result))
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--scratch", type=Path, help="scratch state folder, outside the repository")
    parser.add_argument("--check-bytecode", nargs="+", metavar="FILE", help="print the bytecode state of these sources and stop")
    args = parser.parse_args(argv)
    if args.check_bytecode:
        print(json.dumps({f: bytecode_status(f) for f in args.check_bytecode}))
        return 0
    if args.scratch is None:
        print("importtime.py refused: --scratch is required", file=sys.stderr)
        return EXIT_REFUSED
    return import_mode(args.scratch)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

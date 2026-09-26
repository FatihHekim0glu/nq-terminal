"""`uv run --project terminal/qa python -m crosscheck [--dir DIR] [--strict] [--quiet]`

Reads the dumps written by `terminal/backend/tests/test_dump_for_qa.py`, recomputes every P0 scalar with the
reference libraries and prints our value, the reference value and the difference.

Exit codes: 0 every matching definition agrees within tolerance; 1 a value differs (or, with --strict, a
terminal value is missing); 2 no dumps or an unreadable dump.
"""
from __future__ import annotations

import argparse
import json
import sys

from crosscheck import compare, paths, report
from crosscheck.dumps import DumpError, read_dir


def _parse(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="crosscheck", description=__doc__.splitlines()[0])
    parser.add_argument("--dir", help=f"dump folder (default: ${paths.ENV} or {paths.DEFAULT_DUMP_DIR})")
    parser.add_argument("--strict", action="store_true", help="fail when a terminal value is missing")
    parser.add_argument("--quiet", action="store_true", help="print only failures, skips and the summary")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse(argv)
    folder = paths.dump_dir(args.dir)
    if not folder.is_dir():
        print(f"crosscheck: no dump folder at {folder}; run the backend test test_dump_for_qa.py first")
        return 2
    try:
        dumps = read_dir(folder)
    except (DumpError, json.JSONDecodeError, OSError) as exc:
        print(f"crosscheck: unreadable dump in {folder}: {exc}")
        return 2
    if not dumps:
        print(f"crosscheck: {folder} holds no *.json dumps")
        return 2
    rows = []
    for dump in dumps:
        rows.extend(compare.compare_any(dump))
    shown = [row for row in rows if not args.quiet or row.status in (compare.FAIL, compare.SKIP)]
    print(f"crosscheck: {len(dumps)} dumps from {folder}")
    for line in report.lines(shown)[:-1]:
        print(line)
    print("documented differences (shown as INFO, never failed):")
    for line in report.documented(rows):
        print(line)
    print(report.lines(rows)[-1])
    code = compare.exit_code(rows, strict=args.strict)
    print("crosscheck: " + ("OK" if code == 0 else "FAILED"))
    return code


if __name__ == "__main__":
    sys.exit(main())

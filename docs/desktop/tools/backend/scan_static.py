"""Static scan of terminal/backend/nq_terminal: one record per module, written to modules.json.

Run: .venv python scan_static.py  (read only; AST only, nothing is imported)
"""
from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

ROOT = Path(r"C:\Users\Fatih Hekimoglu\nq-lab")
PKG = ROOT / "terminal" / "backend" / "nq_terminal"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("modules.json")
STDLIB = set(sys.stdlib_module_names)

NET_MODS = {"socket", "http", "urllib", "httpx", "requests", "ssl", "websockets", "ibapi"}
IO_CALLS = {"open", "read_text", "read_bytes", "write_text", "write_bytes", "read_parquet", "read_csv",
            "to_table", "iterdir", "glob", "rglob", "stat", "listdir", "scandir", "read_table", "ParquetFile",
            "read_metadata", "dataset", "unlink", "mkdir", "touch", "fsync", "read_json", "is_file", "exists", "is_dir"}
WRITE_CALLS = {"write_text", "write_bytes", "unlink", "mkdir", "touch", "fsync", "write"}
PD_METHODS = {"rolling", "ewm", "expanding", "groupby", "resample", "merge_asof", "reindex", "pivot", "iloc", "loc", "tz_convert", "tz_localize", "shift", "pct_change", "dropna", "fillna", "sort_values", "sort_index", "to_numpy", "values", "index"}
NUM_LIBS = {"numpy", "pandas", "scipy", "pyarrow", "sklearn", "statsmodels", "arch"}


def top(name: str) -> str:
    return name.split(".")[0]


def first_sentence(doc: str | None) -> str:
    if not doc:
        return ""
    doc = " ".join(doc.strip().split())
    cut = doc.find(". ")
    return doc[: cut + 1] if cut != -1 else doc


def scan(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    tree = ast.parse(text)
    lines = text.splitlines()
    code = sum(1 for ln in lines if ln.strip() and not ln.strip().startswith("#"))
    imports: dict[str, set[str]] = {"stdlib": set(), "nq_lab": set(), "nautilus_trader": set(), "third_party": set(),
                                    "internal": set()}
    for node in ast.walk(tree):
        names: list[str] = []
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names = [node.module]
        if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module and top(node.module) == "nq_terminal":
            names += [f"{node.module}.{a.name}" for a in node.names]
        for n in names:
            t = top(n)
            if t == "nq_terminal":
                imports["internal"].add(n)
            elif t == "nq_lab":
                imports["nq_lab"].add(n)
            elif t == "nautilus_trader":
                imports["nautilus_trader"].add(n)
            elif t in STDLIB or t == "__future__":
                imports["stdlib"].add(t)
            else:
                imports["third_party"].add(t)
    lazy = False
    for fn in ast.walk(tree):
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for node in ast.walk(fn):
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    lazy = True
    calls: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            if isinstance(f, ast.Name):
                calls.add(f.id)
            elif isinstance(f, ast.Attribute):
                calls.add(f.attr)
    allmods = imports["stdlib"] | imports["third_party"]
    flags: list[str] = []
    if "subprocess" in allmods:
        flags.append("subprocess")
    if allmods & NET_MODS:
        flags.append("network")
    if "ibapi" in imports["third_party"] or path.stem in {"ib", "ib_snapshot", "ib_readonly_client"}:
        flags.append("IB")
    io_hit = sorted(calls & IO_CALLS)
    if io_hit:
        flags.append("I/O")
    if "threading" in allmods:
        flags.append("threads")
    pure = not (set(flags) - {"threads"})
    pd_refs = sum(1 for n in ast.walk(tree) if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id == "pd")
    np_refs = sum(1 for n in ast.walk(tree) if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id == "np")
    pd_meth = sum(1 for n in ast.walk(tree) if isinstance(n, ast.Attribute) and n.attr in PD_METHODS)
    pyd = sum(1 for n in tree.body if isinstance(n, ast.ClassDef) and any(isinstance(b, ast.Name) and b.id in ("BaseModel", "RootModel") or isinstance(b, ast.Subscript) for b in n.bases))
    classes = sum(isinstance(n, ast.ClassDef) for n in tree.body)
    funcs = sum(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) for n in ast.walk(tree))
    rel = path.relative_to(PKG.parent)
    return {
        "path": rel.as_posix(),
        "module": ".".join(rel.with_suffix("").parts).replace(".__init__", ""),
        "lines": len(lines),
        "code_lines": code,
        "classes": classes,
        "pd_refs": pd_refs, "np_refs": np_refs, "pd_methods": pd_meth, "model_classes": pyd,
        "functions": funcs,
        "doc": first_sentence(ast.get_docstring(tree)),
        "imports": {k: sorted(v) for k, v in imports.items()},
        "lazy_imports": lazy,
        "flags": sorted(set(flags)),
        "io_calls": io_hit,
        "write_calls": sorted(calls & WRITE_CALLS),
        "kind": "pure" if pure else "/".join(sorted(set(flags) - {"threads"})),
        "numeric_libs": sorted(imports["third_party"] & NUM_LIBS),
    }


def git_state() -> dict[str, str]:
    """tracked / edited / new for every .py under the package (read-only git)."""
    import subprocess
    term = ROOT / "terminal"
    tracked = set(subprocess.run(["git", "-C", str(term), "ls-files", "backend/nq_terminal"], capture_output=True, text=True).stdout.split())
    status = subprocess.run(["git", "-C", str(term), "status", "--porcelain", "backend/nq_terminal"], capture_output=True, text=True).stdout.splitlines()
    edited = {l[3:].strip() for l in status if l[:2].strip() == "M"}
    new = {l[3:].strip() for l in status if l.startswith("??")}
    out = {}
    for f in PKG.rglob("*.py"):
        rel = "backend/" + f.relative_to(PKG.parent).as_posix()
        out[f.relative_to(PKG.parent).as_posix()] = "edited" if rel in edited else ("tracked" if rel in tracked else "new")
    return out


def main() -> None:
    mods = [scan(p) for p in sorted(PKG.rglob("*.py"))]
    state = git_state()
    for m in mods:
        m["git"] = state.get(m["path"], "tracked")
    OUT.write_text(json.dumps(mods, indent=1), encoding="utf-8")
    print(len(mods), "modules,", sum(m["lines"] for m in mods), "lines")


main()

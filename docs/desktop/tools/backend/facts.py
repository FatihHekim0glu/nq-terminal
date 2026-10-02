"""Collect the machine and tree facts that gen_doc.py prints (read only) -> facts.json.

Usage: python facts.py <backend test count> <qa test count>   (the counts come from pytest --collect-only)
"""
import json
import re
import subprocess
import sys
from pathlib import Path

LAB = Path(r"C:\Users\Fatih Hekimoglu\nq-lab")
T = LAB / "terminal"
SRC = T / "backend" / "nq_terminal"


def git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(T), *args], capture_output=True, text=True).stdout.strip()


def tree_stats(path: Path):
    files = [f for f in path.rglob("*") if f.is_file()]
    return len(files), sum(f.stat().st_size for f in files)


def scipy_funcs(paths):
    found = set()
    for rel in paths:
        text = (SRC.parent / rel).read_text(encoding="utf-8")
        for m in re.finditer(r"\bsps\.([a-z_A-Z]+(?:\.[a-z_]+)?)\(", text):
            found.add("scipy.stats." + m.group(1))
        for name in ("linkage", "fcluster", "leaves_list"):
            if re.search(r"\b" + name + r"\(", text):
                found.add("scipy.cluster.hierarchy." + name)
        if "squareform(" in text:
            found.add("scipy.spatial.distance.squareform")
    return sorted(found)


n_proc, b_proc = tree_stats(LAB / "data" / "processed")
n_res, b_res = tree_stats(LAB / "results")
runs = LAB / "backtests" / "output"
n_run_dirs = sum(1 for d in runs.iterdir() if d.is_dir())
_, b_runs = tree_stats(runs)
tests = sorted((T / "backend" / "tests").glob("*.py"))
_, b_qa = tree_stats(T / "qa" / ".venv")
_, b_fix = tree_stats(T / "backend" / "tests" / "fixtures")
modules = json.load(open("modules.json"))
head_files = [m["path"] for m in modules if m["git"] != "new"]
head_lines = 0
for rel in head_files:
    head_lines += len(subprocess.run(["git", "-C", str(T), "show", "HEAD:backend/" + rel], capture_output=True,
                                     text=True, encoding="utf-8").stdout.splitlines())
out = {
    "date": "2026-10-02", "lab": str(LAB), "head": git("rev-parse", "HEAD"),
    "dirty": len([ln for ln in git("status", "--short").splitlines() if ln.strip()]),
    "cpu": "AMD Ryzen 9 9950X3D2, 16 cores", "ram": "32 GB, about 4.6 GB free at the time",
    "tests": {"backend": int(sys.argv[1]), "backend_files": len(tests),
              "backend_lines": sum(len(p.read_text(encoding='utf-8').splitlines()) for p in tests), "qa": int(sys.argv[2])},
    "scipy_functions": scipy_funcs([m["path"] for m in modules]),
    "scipy_functions_head": scipy_funcs(head_files),
    "head_lines": head_lines, "head_modules": len(head_files),
    "processed_gb": round(b_proc / 1e9, 1), "processed_files": n_proc, "results_mb": round(b_res / 1e6),
    "runs_mb": round(b_runs / 1e6), "n_runs": n_run_dirs,
    "importtime_wall_ms": [2752, 2724, 2963], "bare_python_ms": 84, "pandas_ms": 651, "scipy_ms": 993,
    "fixtures_kb": round(b_fix / 1024), "qa_venv_mb": round(b_qa / 1e6),
}
json.dump(out, open("facts.json", "w"), indent=1)
print(out["head_lines"], out["head_modules"], len(out["scipy_functions"]), len(out["scipy_functions_head"]))

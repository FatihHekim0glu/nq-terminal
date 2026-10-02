import re, json, sys, os
WORK = os.path.abspath(sys.argv[1])
os.chdir(os.path.join(WORK, "head", "web"))
from pathlib import Path
from collections import defaultdict
W = Path(".")
def count_tests(txt):
    n_static = len(re.findall(r"(?<![\w.])(?:it|test)\s*\(", txt)) + len(re.findall(r"(?<![\w.])(?:it|test)\.(?:only|concurrent|skip)?\s*\(", txt))
    n_each = len(re.findall(r"(?:it|test)\.each\b", txt))
    return n_static, n_each
res = {"vitest": defaultdict(lambda: {"files":0,"tests":0,"each":0,"lines":0,"jsdom":0}), "e2e": {}, "e2e_total": {"files":0,"tests":0,"lines":0}, "screens": 0}
for p in sorted(W.glob("src/**/*.test.ts*")) + sorted(W.glob("scripts/*.test.ts")):
    rel = p.as_posix()
    if rel.startswith("src/"):
        parts = rel.split("/")
        grp = "screens/"+parts[2] if parts[1]=="screens" and len(parts)>3 else parts[1] if len(parts)>2 else "(src root)"
    else:
        grp = "scripts"
    txt = p.read_text(encoding="utf-8", errors="replace")
    s, e = count_tests(txt)
    d = res["vitest"][grp]
    d["files"] += 1; d["tests"] += s; d["each"] += e; d["lines"] += txt.count("\n")+1
    if re.search(r"@vitest-environment\s+jsdom", txt): d["jsdom"] += 1
res["vitest"] = dict(res["vitest"])
for p in sorted(W.glob("e2e/**/*.ts")):
    rel = p.as_posix()
    if "node_modules" in rel or ".results" in rel or "__screenshots__" in rel or not p.is_file(): continue
    txt = p.read_text(encoding="utf-8", errors="replace")
    s, e = count_tests(txt)
    ents = re.findall(r"(?<![\w.])test\s*\(\s*([`'\"])(.+?)\1", txt)
    res["e2e"][rel] = {"tests": s, "each": e, "lines": txt.count("\n")+1, "axe": "AxeBuilder" in txt, "shots": len(re.findall(r"toHaveScreenshot", txt)), "names": [x[1] for x in ents][:60]}
res["screens"] = len(list(W.glob("e2e/__screenshots__/**/*.png")))
json.dump(res, open(os.path.join(WORK, "tests.json"),"w"), indent=1)
tot = sum(v["tests"] for v in res["vitest"].values()); files = sum(v["files"] for v in res["vitest"].values()); each = sum(v["each"] for v in res["vitest"].values())
print("vitest files", files, "static test calls", tot, "each", each)
print("e2e files", len(res["e2e"]), "calls", sum(v["tests"] for v in res["e2e"].values()), "screens", res["screens"])

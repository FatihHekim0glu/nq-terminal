import json, os, sys
os.chdir(sys.argv[1])  # WORKDIR holds pnpm_ls.json (pnpm ls --prod --depth Infinity --json)
from pathlib import Path
d = json.load(open("pnpm_ls.json", encoding="utf-8"))[0]
seen = {}
def walk(deps, depth, via):
    for name, info in (deps or {}).items():
        key = (name, info.get("version"))
        if key not in seen:
            seen[key] = {"name": name, "version": info.get("version"), "path": info.get("path"), "depth": depth, "via": via or name}
        walk(info.get("dependencies"), depth + 1, via or name)
walk(d.get("dependencies"), 1, None)
rows = []
for (n, v), i in seen.items():
    lic = None; size = None; desc = None
    p = i["path"]
    if p:
        pj = Path(p) / "package.json"
        if pj.exists():
            try:
                j = json.loads(pj.read_text(encoding="utf-8"))
                lic = j.get("license") or (j.get("licenses") or [{}])[0].get("type")
                desc = j.get("description")
            except Exception: pass
        tot = 0
        for root, _, fs in os.walk(p):
            for f in fs:
                try: tot += os.path.getsize(os.path.join(root, f))
                except OSError: pass
        size = tot
    rows.append({**i, "license": lic, "size": size, "desc": desc})
direct = list(d.get("dependencies", {}).keys())
json.dump({"direct": direct, "all": rows}, open("deps.json","w"), indent=1)
print(len(rows), direct)
from collections import Counter
print(Counter(r["license"] for r in rows))

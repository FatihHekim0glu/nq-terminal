import json, re, gzip, os, sys
from pathlib import Path
os.chdir(sys.argv[1])  # WORKDIR holds dist_snapshot, a copy of web/dist
D = Path("dist_snapshot")
A = D / "assets"
rows = []
html = (D / "index.html").read_text(encoding="utf-8")
entry = set(re.findall(r'(?:src|href)="/assets/([^"]+\.js)"', html))
def gz(b): return len(gzip.compress(b, compresslevel=9, mtime=0))
js_text = {p.name: p.read_text(encoding="utf-8", errors="replace") for p in A.glob("*.js")}
static_re = re.compile(r"(?:\bfrom|\bimport)\s*[\"']\./([^\"']+\.js)[\"']")
seen=set(); q=list(entry)
while q:
    f=q.pop()
    if f in seen: continue
    seen.add(f); q += static_re.findall(js_text.get(f,""))
shell=seen
for p in sorted(A.iterdir()):
    b = p.read_bytes()
    name = p.name
    ext = p.suffix.lower().lstrip(".")
    base = re.sub(r"-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)$", r"\1", name)
    stem = re.sub(r"-[A-Za-z0-9_-]{8}\.[a-z0-9]+$", "", name)
    if ext == "js":
        cat = "shell js" if name in shell else "lazy js"
    elif ext == "css":
        cat = "css"
    elif ext in ("woff2", "woff"):
        cat = "font"
    elif ext == "wasm":
        cat = "wasm"
    else:
        cat = ext
    rows.append({"name": name, "stem": stem, "ext": ext, "cat": cat, "raw": len(b), "gz": gz(b) if ext in ("js","css","wasm","md","svg") else None})
tot = {}
for r in rows:
    k = (r["cat"])
    t = tot.setdefault(k, {"n":0,"raw":0,"gz":0})
    t["n"]+=1; t["raw"]+=r["raw"]; t["gz"]+= r["gz"] or 0
json.dump({"rows": rows, "totals": tot, "shell": sorted(shell), "html_size": len(html.encode()), "favicon": (D/"favicon.svg").stat().st_size}, open("dist.json","w"), indent=1)
for k,v in tot.items(): print(k, v)
print(len(rows))

import json, sys, collections
from pathlib import Path
sys.path.insert(0, ".")
from crosscheck.dumps import read_dir, Bundle, Case, RegistryDump
from crosscheck import compare
ENGINES = [("arch", "arch"), ("statsmodels", "statsmodels"), ("quantstats", "quantstats"), ("empyrical", "empyrical"),
           ("performanceanalytics", "PerformanceAnalytics formula in Python"), ("scipy", "scipy"), ("pandas", "pandas"),
           ("numpy", "numpy"), ("decimal", "python decimal"), ("hashlib", "hashlib"), ("plain python", "plain Python"),
           ("stdlib", "Python stdlib"), ("set arithmetic", "set arithmetic")]
dumps = read_dir(Path(".dumps"))
kinds = collections.defaultdict(lambda: {"dumps": 0, "PASS": 0, "FAIL": 0, "SKIP": 0, "INFO": 0, "sources": collections.Counter(), "sides": collections.Counter(), "names": []})
for d in dumps:
    k = d.kind if isinstance(d, Bundle) else ("registry" if isinstance(d, RegistryDump) else "series")
    rows = compare.compare_any(d)
    e = kinds[k]
    e["dumps"] += 1
    e["names"].append(d.name)
    for r in rows:
        e[r.status] += 1
        low = r.source.lower()
        for key, label in ENGINES:
            if key in low:
                e["sources"][label] += 1
                break
        else:
            e["sources"]["other / written-out rule"] += 1
        e["sides"][r.side.split("@")[0]] += 1
out = {k: {**v, "sources": dict(v["sources"].most_common(8)), "sides": dict(v["sides"]), "names": v["names"][:6]} for k, v in sorted(kinds.items())}
json.dump(out, open(sys.argv[1], "w"), indent=1)
tot = collections.Counter()
for v in out.values():
    for s in ("PASS", "FAIL", "SKIP", "INFO"): tot[s] += v[s]
print(dict(tot), len(dumps))
for k, v in out.items(): print(k, v["dumps"], v["PASS"], v["INFO"], v["sources"])

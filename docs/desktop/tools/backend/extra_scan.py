import ast, json, collections, re
from pathlib import Path
LAB=Path(r"C:\Users\Fatih Hekimoglu\nq-lab"); PKG=LAB/"terminal/backend/nq_terminal"
scipy_use=collections.defaultdict(set)   # "scipy.stats.norm" -> modules
meth=collections.Counter()
PM=["rolling","ewm","expanding","groupby","resample","merge_asof","merge","reindex","pivot","pivot_table","read_csv","read_parquet","to_datetime","tz_convert","tz_localize","DatetimeIndex","quantile","corr","cov","cumsum","cumprod","rank","shift","diff","pct_change","apply","agg","concat","where","clip","dropna","fillna","interpolate","isin","sort_values","value_counts","MultiIndex","Timestamp","Timedelta","BDay","bdate_range","date_range"]
NP=["linalg","fft","random","default_rng","percentile","quantile","corrcoef","cov","cumsum","cumprod","convolve","searchsorted","lexsort","argsort","sort","isfinite","nan","nanmean","nanstd","nanpercentile","diff","where","polyfit","eigvalsh","eigh","cholesky","svd","lstsq","einsum","tril","triu"]
np_counter=collections.Counter(); pd_counter=collections.Counter()
nl=collections.defaultdict(set)
for p in sorted(PKG.rglob("*.py")):
    mod=".".join(p.relative_to(PKG.parent).with_suffix("").parts).replace(".__init__","")
    t=ast.parse(p.read_text(encoding="utf-8"))
    for n in ast.walk(t):
        if isinstance(n,ast.ImportFrom) and n.module and n.module.split(".")[0]=="scipy":
            for a in n.names: scipy_use[f"{n.module}.{a.name}"].add(mod)
        elif isinstance(n,ast.Import):
            for a in n.names:
                if a.name.split(".")[0]=="scipy": scipy_use[a.name].add(mod)
        elif isinstance(n,ast.ImportFrom) and n.module and n.module.split(".")[0]=="nq_lab":
            for a in n.names: nl[n.module].add(mod)
        elif isinstance(n,ast.Import):
            for a in n.names:
                if a.name.split(".")[0]=="nq_lab": nl[a.name].add(mod)
        if isinstance(n,ast.Attribute):
            if n.attr in PM: pd_counter[n.attr]+=1
            if n.attr in NP: np_counter[n.attr]+=1
        if isinstance(n,ast.Attribute) and isinstance(n.value,ast.Attribute) and isinstance(n.value.value,ast.Name) and n.value.value.id=="scipy":
            scipy_use[f"scipy.{n.value.attr}.{n.attr}"].add(mod)
# nq_lab: "from nq_lab import x" => module nq_lab.x
nl2=collections.defaultdict(set)
for p in sorted(PKG.rglob("*.py")):
    mod=".".join(p.relative_to(PKG.parent).with_suffix("").parts).replace(".__init__","")
    t=ast.parse(p.read_text(encoding="utf-8"))
    for n in ast.walk(t):
        if isinstance(n,ast.ImportFrom) and n.module=="nq_lab":
            for a in n.names: nl2[f"nq_lab.{a.name}"].add(mod)
        elif isinstance(n,ast.ImportFrom) and n.module and n.module.startswith("nq_lab."):
            nl2[n.module].add(mod)
census=json.load(open("census.json"))
loaded=[m for m in census["modules_after_sweep"] if m.startswith("nq_lab")]
def nlpath(m):
    q=LAB/"src"/Path(*m.split("."))
    return q.with_suffix(".py") if q.with_suffix(".py").exists() else q/"__init__.py"
info=[]
for m in loaded:
    p=nlpath(m)
    src=p.read_text(encoding="utf-8") if p.exists() else ""
    info.append({"module":m,"lines":len(src.splitlines()),"imports_nautilus":bool(re.search(r"^\s*(from|import) nautilus_trader",src,re.M)),
                 "used_by":sorted(nl2.get(m,[]))})
json.dump({"scipy":{k:sorted(v) for k,v in sorted(scipy_use.items())},"pandas_methods":dict(pd_counter.most_common()),"numpy_attrs":dict(np_counter.most_common()),
           "nq_lab_loaded":info,"nq_lab_direct":{k:sorted(v) for k,v in sorted(nl2.items())}},open("extra.json","w"),indent=1)
print(len(scipy_use), sorted(scipy_use)[:40]); print(pd_counter.most_common(15)); print(len(info), sum(i["lines"] for i in info))

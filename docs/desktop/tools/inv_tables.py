"""Generate the table sections of 00_inventory_frontend.md from the extracted JSON (no network, read only)."""
import json, re, sys
from pathlib import Path
from collections import defaultdict

WORK = Path(sys.argv[1])
SNAP = WORK / "head" / "web"
SRC = SNAP / "src"
inv = json.load(open(WORK / "inv.json", encoding="utf-8"))
dist = json.load(open(WORK / "dist.json", encoding="utf-8"))
deps = json.load(open(WORK / "deps.json", encoding="utf-8"))
tests = json.load(open(WORK / "tests.json", encoding="utf-8"))
sizes = json.load(open(WORK / "spike" / "size.json", encoding="utf-8"))
folders = inv["folders"]

def esc(s):
    return str(s).replace("|", "\\|")
def md(headers, rows, align=None):
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" if not (align and align[i] == "r") else "---:" for i in range(len(headers))) + "|"]
    for r in rows:
        out.append("| " + " | ".join(esc(c) for c in r) + " |")
    return "\n".join(out)
def kb(n):
    return f"{n/1000:.1f}"
def num(n):
    return f"{n:,}"
def j(xs, sep=", "):
    return sep.join(xs) if xs else "none"

OUT = {}

# ---------- 1. top-level folders ----------
SCREEN_FOLDERS = sorted(k for k in folders if k.startswith("screens/"))
SUPPORT = [k for k in sorted(folders) if not k.startswith("screens/")]
def row_identity(k):
    f = folders[k]
    codes = [c for c, fo in inv["mn_folder"].items() if "screens/" + fo == k]
    return [f"`src/{k}`" if k != "(src root)" else "`src/*.ts(x)`", f["all"], f["prod"], f["test"], f["other"], num(f["l_prod_code"]), num(f["l_prod_css"]), num(f["l_test"]), num(f["l_other"]), j(codes) if k.startswith("screens/") else "n/a"]
H_ID = ["Path", "Files", "Prod", "Test", "Other", "Prod ts/tsx lines", "Prod css lines", "Test lines", "Other lines", "Mnemonics"]
AL = [None, "r", "r", "r", "r", "r", "r", "r", "r", None]
OUT["id_screens"] = md(H_ID, [row_identity(k) for k in SCREEN_FOLDERS], AL)
OUT["id_support"] = md(H_ID, [row_identity(k) for k in SUPPORT], AL)
tot = defaultdict(int)
for k, f in folders.items():
    for fld in ("all", "prod", "test", "other", "l_prod_code", "l_prod_css", "l_test", "l_other"):
        tot[fld] += f[fld]
OUT["totals"] = dict(tot)
scr = defaultdict(int)
for k in SCREEN_FOLDERS:
    for fld in ("all", "prod", "test", "other", "l_prod_code", "l_prod_css", "l_test", "l_other"):
        scr[fld] += folders[k][fld]
OUT["screen_totals"] = dict(scr)

# ---------- 2. libraries and components ----------
def row_libs(k):
    f = folders[k]
    return [f"`src/{k}`" if k != "(src root)" else "`src/*.ts(x)`", j(f["libs_direct"]), j(f["libs_via"]), j(f["comps_direct"]), j(f["comps_via"])]
H_LIB = ["Path", "Own library imports (value imports)", "Libraries reached through components", "Chart, grid and tile components used directly", "Components reached only through other folders"]
OUT["lib_screens"] = md(H_LIB, [row_libs(k) for k in SCREEN_FOLDERS])
OUT["lib_support"] = md(H_LIB, [row_libs(k) for k in SUPPORT if folders[k]["libs_direct"] or folders[k]["libs_via"] or folders[k]["comps_direct"]])

# ---------- 3. routes ----------
def row_routes(k):
    f = folders[k]
    own = [r.replace("/api", "", 1) for r in f["routes_own"]]
    via = [r.replace("/api", "", 1) for r in f["routes_via"]]
    return [f"`src/{k}`", len(f["routes_own"]), j([f"`{r}`" for r in own]), j([f"`{r}`" for r in via])]
H_RT = ["Path", "Own routes", "Routes named in the folder's own files (the `/api` prefix is dropped)", "Further routes reached through other folders"]
OUT["routes_screens"] = md(H_RT, [row_routes(k) for k in SCREEN_FOLDERS])
OUT["routes_support"] = md(H_RT, [row_routes(k) for k in SUPPORT if folders[k]["routes_own"] or folders[k]["routes_via"]])

# ---------- 4. keys and features ----------
GRID_KEYS = "grid: arrows, PgUp, PgDn, Home, End, Enter, Space"
CHART_KEYS = "chart: Left, Right, +, -, Home, End, T"
def inherited(k):
    f = folders[k]
    comps = set(f["comps_direct"]) | set(f["comps_via"])
    out = []
    if comps & {"MonitorGrid", "JournalTable"}: out.append("MonitorGrid keys")
    if comps & {"LineStack", "CandleChart"}: out.append("chart keys (ChartA11y)")
    if comps & {"EchartsChart"}: out.append("ECharts figure keys (ChartA11y)")
    if comps & {"PerspectiveGrid", "pivots"}: out.append("Perspective keys")
    return out
def row_keys(k):
    f = folders[k]
    own = f["keys"]
    own_s = j([("Space" if x == " " else x) for x in own]) if own else "none"
    mods = j(f["key_metas"]) if f["key_metas"] else "none"
    return [f"`src/{k}`", own_s, mods, f["key_handlers"], j(inherited(k))]
H_KEY = ["Path", "Key names in own files", "Modifier flags read", "Key handlers (onKeyDown or keydown listeners)", "Keys inherited from reused components"]
OUT["keys_screens"] = md(H_KEY, [row_keys(k) for k in SCREEN_FOLDERS])
OUT["keys_support"] = md(H_KEY, [row_keys(k) for k in SUPPORT if folders[k]["keys"] or folders[k]["key_handlers"]])

def feat_str(d):
    return j([f"{k} ({v})" for k, v in sorted(d.items())])
def derived(k):
    f = folders[k]
    libs = set(f["libs_direct"]) | set(f["libs_via"])
    extra = []
    if "perspective" in libs: extra += ["web-worker (via engine)", "wasm (via engine)"]
    if libs & {"uplot", "lightweight-charts", "echarts"}: extra += ["canvas-2d (via chart library)"]
    return extra
def row_feat(k):
    f = folders[k]
    return [f"`src/{k}`", feat_str(f["features"]), j(derived(k)), feat_str(f["css_features"])]
H_FT = ["Path", "Browser features in own files (files using it)", "Derived through reused components", "Modern CSS in own stylesheets (files using it)"]
OUT["feat_screens"] = md(H_FT, [row_feat(k) for k in SCREEN_FOLDERS])
OUT["feat_support"] = md(H_FT, [row_feat(k) for k in SUPPORT if folders[k]["features"] or folders[k]["css_features"] or derived(k)])

# a11y counts
def row_a11y(k):
    a = folders[k]["a11y"]
    return [f"`src/{k}`" if k != "(src root)" else "`src/*.ts(x)`", a["aria-*"], a["role="], a["tabIndex"], a["aria-live"], a["inert"], a["focus()"], a["sr-only"]]
H_A = ["Path", "aria-* uses", "role uses", "tabIndex uses", "live regions", "inert uses", ".focus() calls", "screen-reader-only text"]
a_rows = [row_a11y(k) for k in sorted(folders) if any(folders[k]["a11y"].values())]
OUT["a11y"] = md(H_A, a_rows, [None] + ["r"] * 7)

# ---------- 5. mnemonics ----------
titles = inv["titles"]; meta = inv["mn_meta"]; mf = inv["mn_folder"]
rows = []
for i, (code, m) in enumerate(meta.items()):
    rows.append([f"{i:02d}", f"`{code}`", titles.get(code, ""), m["priority"], m["context"], m["arg"], f"`src/screens/{mf[code]}`"])
OUT["mnemonics"] = md(["No.", "Code", "Title (UI)", "Priority", "Context it takes", "Argument", "Screen folder"], rows)

# ---------- 6. appendix A: every prod file in screens ----------
def read_lines(p):
    try:
        return sum(1 for _ in open(p, "rb"))
    except OSError:
        return 0
arows = []
for k in SCREEN_FOLDERS:
    prod = [r for r in folders[k]["files"] if (SRC / r).suffix in (".ts", ".tsx", ".css")]
    for r in prod:
        name = Path(r).name
        if ".test." in name:
            continue
        if re.search(r"\.gallery\.|Gallery|galleryData|[Ff]ixtures?\.tsx?$|\.fixtures\.|TestData|testHarness", name):
            continue
        arows.append([f"`src/{r}`", read_lines(SRC / r)])
OUT["appendix_files"] = md(["File", "Lines"], arows, [None, "r"])
OUT["appendix_count"] = len(arows)

# ---------- 7. dependencies ----------
chunk_of = {
    "react": "react (shell)", "react-dom": "react (shell)", "zustand": "vendor (shell)", "@tanstack/react-query": "vendor (shell); useQueries in REG and DES chunks",
    "cmdk": "vendor (shell), with two stubs", "dockview-react": "dockview (lazy, with the Workspace)", "uplot": "uplot (lazy)",
    "lightweight-charts": "lightweight-charts (lazy)", "echarts": "echarts (lazy)", "@tanstack/react-table": "tanstack-grid (lazy)", "@tanstack/react-virtual": "tanstack-grid (lazy)",
    "@perspective-dev/client": "perspective (lazy)", "@perspective-dev/viewer": "perspective (lazy)", "@perspective-dev/viewer-datagrid": "perspective (lazy)", "@perspective-dev/server": "perspective (lazy); WASM and worker are separate assets",
    "@fontsource/source-sans-3": "font files (assets)", "@fontsource/pt-mono": "font files (assets)",
}
role = {
    "react": "UI runtime", "react-dom": "DOM renderer", "zustand": "small stores (link groups, layouts, workspaces, record watch, message line)", "@tanstack/react-query": "GET cache, polling, retries",
    "cmdk": "command line suggestion list", "dockview-react": "panel workspace (fixed layouts, no drag)", "uplot": "time-series line charts (LineStack)", "lightweight-charts": "candlestick charts (GP, GIP, DES)",
    "echarts": "tree-shaken: bar ladder, heatmap, cone, distribution, scatter, swimlane, composition", "@tanstack/react-table": "headless table model for MonitorGrid", "@tanstack/react-virtual": "row virtualisation",
    "@perspective-dev/client": "pivot engine client (WASM server, worker)", "@perspective-dev/viewer": "pivot viewer element (WASM)", "@perspective-dev/viewer-datagrid": "pivot datagrid plugin", "@perspective-dev/server": "pivot engine WASM",
    "@fontsource/source-sans-3": "fallback text face", "@fontsource/pt-mono": "fixed-grid face",
}
by_stem = {}
for r in dist["rows"]:
    by_stem.setdefault(r["stem"], []).append(r)
def chunk_stat(stem):
    rs = [r for r in by_stem.get(stem, []) if r["ext"] == "js"]
    return sum(r["raw"] for r in rs), sum((r["gz"] or 0) for r in rs)
drows = []
dep_info = {r["name"]: r for r in deps["all"]}
def chunk_cols(name):
    c = chunk_of.get(name, "")
    stem = c.split(" ")[0]
    if name in ("react", "react-dom"):
        raw, gz = chunk_stat("react"); return f"{kb(raw)} / {kb(gz)} (react chunk, both packages)"
    if name in ("zustand", "@tanstack/react-query", "cmdk"):
        raw, gz = chunk_stat("vendor"); return f"inside vendor chunk {kb(raw)} / {kb(gz)}"
    if name == "dockview-react": raw, gz = chunk_stat("dockview"); return f"{kb(raw)} / {kb(gz)} js"
    if name in ("uplot", "lightweight-charts", "echarts"): raw, gz = chunk_stat(name); return f"{kb(raw)} / {kb(gz)}"
    if name in ("@tanstack/react-table", "@tanstack/react-virtual"): raw, gz = chunk_stat("tanstack-grid"); return f"{kb(raw)} / {kb(gz)} (tanstack-grid chunk, both packages)"
    if name.startswith("@perspective-dev"):
        parts = [r for r in dist["rows"] if r["stem"].startswith("perspective") and r["ext"] == "js" and "worker" not in r["stem"] and "server" not in r["stem"]]
        raw = sum(r["raw"] for r in parts); gz = sum(r["gz"] or 0 for r in parts)
        return f"{kb(raw)} / {kb(gz)} js (perspective chunks, all four packages), plus WASM and worker below"
    if name.startswith("@fontsource"):
        return "font files, see fonts table"
    return ""
for name in deps["direct"]:
    i = dep_info[name]
    drows.append([f"`{name}`", i["version"], i["license"], role.get(name, ""), chunk_of.get(name, ""), chunk_cols(name), f"{i['size']/1e6:.2f}"])
OUT["deps_direct"] = md(["Package", "Version", "Licence", "Role", "Where it lands in the build", "Built size, raw / gzip kB", "Installed size on disk, MB"], drows)
trans = [r for r in deps["all"] if r["depth"] > 1]
OUT["dep_counts"] = {"all": len(deps["all"]), "direct": len(deps["direct"]), "transitive": len(trans)}
from collections import Counter
OUT["dep_licences"] = dict(Counter(r["license"] or "unknown" for r in deps["all"]))
nonmit = [r for r in deps["all"] if r["license"] != "MIT"]
OUT["deps_nonmit"] = md(["Package", "Version", "Licence", "Pulled in by"], [[f"`{r['name']}`", r["version"], r["license"] or "none declared", f"`{r['via']}`"] for r in nonmit])
srows = []
for label, d in sizes.items():
    if "raw" in d:
        srows.append([label, kb(d["raw"]), kb(d["gz"])])
OUT["standalone"] = md(["Package (what the app imports)", "Standalone minified kB", "Standalone gzip kB"], srows, [None, "r", "r"])

# ---------- 8. dist ----------
trow = []
for cat, label in (("shell js", "Shell JavaScript (loads with index.html)"), ("lazy js", "Lazy JavaScript chunks"), ("css", "CSS"), ("font", "Fonts (woff2 and woff)"), ("wasm", "WebAssembly"), ("md", "Licence text")):
    t = dist["totals"][cat]
    trow.append([label, t["n"], num(t["raw"]), num(t["gz"]) if cat != "font" else "n/a (already compressed)"])
OUT["dist_totals"] = md(["Category", "Files", "Raw bytes", "Gzip bytes"], trow, [None, "r", "r", "r"])
OUT["dist_total_bytes"] = sum(r["raw"] for r in dist["rows"]) + dist["html_size"] + dist["favicon"]
shell = [r for r in dist["rows"] if r["cat"] == "shell js"]
OUT["shell"] = md(["Shell chunk", "Raw bytes", "Gzip bytes"], [[f"`{r['name']}`", num(r["raw"]), num(r["gz"])] for r in sorted(shell, key=lambda r: -r["raw"])], [None, "r", "r"])
OUT["shell_gz"] = sum(r["gz"] for r in shell)
allrows = [[f"`{r['name']}`", r["cat"], num(r["raw"]), num(r["gz"]) if r["gz"] else ""] for r in sorted(dist["rows"], key=lambda r: (-r["raw"]))]
OUT["dist_all"] = md(["Asset", "Category", "Raw bytes", "Gzip bytes"], allrows, [None, None, "r", "r"])
scr_chunks = [r for r in dist["rows"] if re.match(r"^[A-Za-z]+Screen-", r["name"]) and r["ext"] == "js"]
OUT["dist_n_assets"] = len(dist["rows"])

fonts = [r for r in dist["rows"] if r["cat"] == "font"]
OUT["fonts"] = md(["Font file in the build", "Format", "Bytes"], [[f"`{r['name']}`", r["ext"], num(r["raw"])] for r in sorted(fonts, key=lambda r: r["name"])], [None, None, "r"])
OUT["fonts_tot"] = {"n": len(fonts), "woff2": sum(r["raw"] for r in fonts if r["ext"] == "woff2"), "woff": sum(r["raw"] for r in fonts if r["ext"] == "woff"), "n_woff": sum(1 for r in fonts if r["ext"] == "woff")}
css_rows2 = [r for r in dist["rows"] if r["ext"] == "css"]
OUT["css_top"] = md(["Stylesheet", "Raw bytes", "Gzip bytes"], [[f"`{r['name']}`", num(r["raw"]), num(r["gz"])] for r in sorted(css_rows2, key=lambda r: -r["raw"])[:8]], [None, "r", "r"])

# ---------- 9. routes table ----------
used_by = defaultdict(list)
for k, f in folders.items():
    for r in f["routes_own"]:
        used_by[r].append(k)
poll = {
    "/api/health": "polled every 2 s, backs off to 30 s while down (connection.ts)",
    "/api/commands": "polled every 60 s",
    "/api/live/status": "stream, else poll 2 s", "/api/live/journal": "stream, else poll 2 s", "/api/live/log": "stream, else poll 2 s",
    "/api/live/performance": "stream, else poll 2 s", "/api/live/routes": "stream, else poll 2 s", "/api/analytics/paper-tracking": "stream, else poll 2 s",
    "/api/live/stream": "Server-Sent Events (the only one)", "/api/audit/oos-log": "event tape polls 10 s when the tape is on",
    "/api/ib/snapshot": "polled every 10 s when the IB view is on", "/api/jobs": "GET list; POST queues a run (the one write)", "/api/jobs/{job_id}": "GET status; DELETE stops a job (the one write)",
}
rt_rows = []
for p, meths in sorted(inv["schema_paths"].items()):
    folds = sorted(set(used_by.get(p, [])))
    rt_rows.append([f"`{p}`", ", ".join(m.upper() for m in meths), j([f"`{x}`" for x in folds]) if folds else "via hook or built path", poll.get(p, "on demand, stale after 30 s")])
OUT["api_routes"] = md(["Route", "Methods in the contract", "Folders naming it", "Refresh"], rt_rows)

# ---------- 10. feature roll-up ----------
FILE_FEATS = [
    ("localStorage", r"localStorage|safeLocalStorage"), ("clipboard write or read", r"navigator\.clipboard|ClipboardItem"), ("object URL download", r"createObjectURL"),
    ("window.print", r"window\.print\("), ("canvas 2D (own code)", r"getContext\(|toBlob\(|toDataURL\("), ("EventSource", r"new EventSource"),
    ("?worker import", r"\?worker"), ("WebAssembly URL import", r"\.wasm\?url"), ("matchMedia", r"matchMedia\("), ("ResizeObserver", r"new ResizeObserver"),
    ("MutationObserver", r"new MutationObserver"), ("IntersectionObserver", r"new IntersectionObserver"), ("requestAnimationFrame", r"requestAnimationFrame"),
    ("requestIdleCallback", r"requestIdleCallback"), ("history.replaceState", r"history\.replaceState|replaceState\("), ("location.hash", r"location\.hash"),
    ("inert attribute", r"\binert\b"), ("document.fonts", r"document\.fonts"), ("Intl.DateTimeFormat with a time zone", r"timeZone:"), ("structuredClone", r"structuredClone"),
    ("performance.mark or measure", r"performance\.(mark|measure)\("), ("popover or aria-haspopup", r"popover|aria-haspopup"), ("fetch (client only)", r"\bfetch\("),
]
feat_rows = []
for name, pat in FILE_FEATS:
    hits = []
    for p in sorted(SRC.rglob("*")):
        if p.suffix not in (".ts", ".tsx") or ".test." in p.name or "testUtil" in p.name:
            continue
        rel = p.relative_to(SRC).as_posix()
        if rel.startswith(("gallery/", "demo/")) or "gallery" in p.name.lower():
            continue
        if re.search(pat, p.read_text(encoding="utf-8", errors="replace")):
            hits.append(rel)
    feat_rows.append([name, len(hits), j([f"`{h}`" for h in hits[:8]]) + (f" and {len(hits)-8} more" if len(hits) > 8 else "")])
OUT["feat_rollup"] = md(["Feature", "Prod files", "Files (first eight)"], feat_rows, [None, "r", None])

# ---------- 11. css features, dist ----------
CSSF = [("@property", r"@property"), ("color-mix()", r"color-mix\("), ("@layer", r"@layer"), (":has()", r":has\("), ("@container", r"@container"), ("CSS nesting", r"&[\s.:\[]"),
        ("scrollbar-color / scrollbar-width", r"scrollbar-(color|width)"), ("::-webkit-scrollbar", r"::-webkit-scrollbar"), ("-webkit- prefixed", r"-webkit-(?!scrollbar)"), ("-moz- prefixed", r"-moz-"),
        ("@media print", r"@media print"), ("prefers-reduced-motion", r"prefers-reduced-motion"), ("forced-colors", r"forced-colors"), ("@font-face", r"@font-face"), ("grid", r"display:\s?grid"),
        ("position: sticky", r"position:\s?sticky"), ("100vh / vw units", r"\d(vh|vw)\b"), ("dvh / svh", r"\d(dvh|svh)\b"), ("oklch / lab", r"oklch\(|oklab\(|lab\(")]
css_rows = []
dist_css = {r["name"]: (WORK / "dist_snapshot" / "assets" / r["name"]).read_text(encoding="utf-8", errors="replace") for r in dist["rows"] if r["ext"] == "css"}
src_css = {p.relative_to(SRC).as_posix(): p.read_text(encoding="utf-8", errors="replace") for p in SRC.rglob("*.css") if "gallery" not in p.name.lower()}
for name, pat in CSSF:
    d = sum(1 for t in dist_css.values() if re.search(pat, t, re.M))
    s = sum(1 for t in src_css.values() if re.search(pat, t, re.M))
    css_rows.append([name, s, d])
OUT["css_rollup"] = md(["CSS feature", "Source stylesheets using it (of %d)" % len(src_css), "Built stylesheets using it (of %d)" % len(dist_css)], css_rows, [None, "r", "r"])
OUT["css_counts"] = {"src": len(src_css), "dist": len(dist_css), "src_lines": sum(t.count("\n") for t in src_css.values())}

# ---------- 12. tokens ----------
tok = (SRC / "theme/tokens.css").read_text(encoding="utf-8")
amber = (SRC / "theme/amberClassic.css").read_text(encoding="utf-8")
secs = re.split(r"^/\* ---------- (.*?) ---------- \*/$", tok, flags=re.M)
sec_rows = []
for i in range(1, len(secs), 2):
    body = secs[i + 1]
    n = len(re.findall(r"^\s*--[a-z0-9-]+\s*:", body, re.M))
    sec_rows.append([secs[i].split("(")[0].strip(), n])
theme_inline = re.search(r"@theme inline \{(.*?)\n\}", tok, re.S).group(1)
OUT["tok_theme_n"] = len(re.findall(r"--color-|--font-", theme_inline))
OUT["tok_sections"] = md(["Section of tokens.css", "Custom properties declared"], sec_rows, [None, "r"])
OUT["tok_total"] = len(re.findall(r"^\s*--[a-z0-9-]+\s*:", tok, re.M))
OUT["amber_n"] = len(re.findall(r"^\s*--[a-z0-9-]+\s*:", amber, re.M))
OUT["tok_groups"] = {
    "geometry (--fs, --lh, --r, --row, --target, heights, widths)": len(re.findall(r"^\s*--(fs|lh|fw|r|row|target|frame|keybar|key|nav|cmd|msg|tape|status|ptitle|quote|fn|tab|subtab|param|gutter|sb|caret)-?[a-z0-9-]*\s*:", tok, re.M)),
}
hex_files = []
for p in sorted(SRC.rglob("*")):
    if p.suffix not in (".css", ".ts", ".tsx"): continue
    n = p.name
    if ".test." in n or re.search(r"fixtures|Fixtures|gallery|Gallery|TestData|tokens\.css|amberClassic\.css|cvdSim|contrast", n) or p.relative_to(SRC).as_posix().startswith("demo/"): continue
    c = len(re.findall(r"#[0-9A-Fa-f]{6}\b", p.read_text(encoding="utf-8", errors="replace")))
    if c: hex_files.append((p.relative_to(SRC).as_posix(), c))
OUT["hex_files"] = hex_files

# ---------- 13. tests ----------
v = tests["vitest"]
vrows = []
for k in sorted(v):
    d = v[k]
    vrows.append([f"`{k}`", d["files"], d["tests"], d["each"], num(d["lines"]), d["jsdom"]])
OUT["vitest_rows"] = md(["Folder", "Test files", "it/test calls", "each tables", "Lines", "Files with jsdom"], vrows, [None, "r", "r", "r", "r", "r"])
OUT["vitest_tot"] = {"files": sum(d["files"] for d in v.values()), "tests": sum(d["tests"] for d in v.values()), "each": sum(d["each"] for d in v.values()), "lines": sum(d["lines"] for d in v.values()), "jsdom": sum(d["jsdom"] for d in v.values())}
erows = []
for k, d in sorted(tests["e2e"].items()):
    if d["tests"] == 0 and not d["axe"]: continue
    erows.append([f"`{k.replace('e2e/', '')}`", d["tests"], d["lines"], "yes" if d["axe"] else "", d["shots"]])
OUT["e2e_rows"] = md(["File", "test calls", "Lines", "axe scan", "toHaveScreenshot calls"], erows, [None, "r", "r", None, "r"])
OUT["e2e_tot"] = {"files": len([1 for d in tests["e2e"].values() if d["tests"] > 0]), "tests": sum(d["tests"] for d in tests["e2e"].values()), "axe": sum(1 for d in tests["e2e"].values() if d["axe"]), "screens": tests["screens"]}

json.dump(OUT, open(WORK / "tables.json", "w", encoding="utf-8"), indent=1, default=str)
print("tables ok", list(OUT.keys())[:5], OUT["totals"], OUT["shell_gz"], OUT["tok_total"], OUT["amber_n"])

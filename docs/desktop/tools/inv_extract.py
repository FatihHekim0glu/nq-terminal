"""Extract the front end inventory facts as JSON. Usage: inv_extract.py WORKDIR (reads WORKDIR/head/web, writes WORKDIR/inv.json)."""
import json, os, re, sys, gzip, zlib
from pathlib import Path
from collections import defaultdict

WEB = Path(sys.argv[1]) / "head" / "web"
SRC = WEB / "src"
OUT = Path(sys.argv[1]) / "inv.json"

TEST_RE = re.compile(r"\.(test|nxtw\.test|lv6\.test|u17\.test|u18\.test|split\.test|demo\.test|live\.test|lazy\.test)\.tsx?$|\.test\.ts$|\.test\.tsx$")
def kind(p: Path) -> str:
    n = p.name
    if ".test." in n or n.endswith(".test.ts") or n.endswith(".test.tsx"):
        return "test"
    if re.search(r"testUtil|testing\.ts$|\.fake\.ts$|\.testing\.", n):
        return "testutil"
    if re.search(r"\.gallery\.|Gallery|galleryData|galleryFixtures|gallery\.fixtures|[Ff]ixtures?\.tsx?$|\.fixtures\.|TestData|testHarness|\.real\.fixtures", n):
        return "gallery_fixture"
    return "prod"

def lines(p: Path) -> int:
    try:
        with open(p, "rb") as f:
            return sum(1 for _ in f)
    except OSError:
        return 0

files = []
for p in sorted(SRC.rglob("*")):
    if not p.is_file():
        continue
    rel = p.relative_to(SRC).as_posix()
    ext = p.suffix.lower()
    files.append({"rel": rel, "ext": ext, "kind": kind(p), "lines": lines(p) if ext in (".ts", ".tsx", ".css", ".mjs", ".md") else 0, "size": p.stat().st_size})

# -------- import graph (non-test files only) --------
IMPORT_RE = re.compile(r"""(?:import\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?|export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+|import\(\s*)['"]([^'"]+)['"]""", re.S)
code_files = {f["rel"]: f for f in files if f["ext"] in (".ts", ".tsx", ".css") and f["kind"] in ("prod",)}
def resolve(frm: str, spec: str):
    base = (Path(frm).parent / spec).as_posix()
    base = os.path.normpath(base).replace("\\", "/")
    spec_clean = base.split("?")[0]
    cands = [spec_clean, spec_clean + ".ts", spec_clean + ".tsx", spec_clean + ".css", spec_clean + "/index.ts", spec_clean + "/index.tsx"]
    for c in cands:
        if c in code_files:
            return c
    return None

graph = {}
externals = {}
texts = {}
for rel, f in code_files.items():
    if f["ext"] == ".css":
        graph[rel] = []
        externals[rel] = []
        texts[rel] = (SRC / rel).read_text(encoding="utf-8", errors="replace")
        continue
    txt = (SRC / rel).read_text(encoding="utf-8", errors="replace")
    texts[rel] = txt
    deps, ext = [], set()
    for m in IMPORT_RE.finditer(txt):
        spec = m.group(1)
        type_only = bool(re.match(r"\s*(import|export)\s+type", m.group(0)))
        if spec.startswith("."):
            r = resolve(rel, spec)
            if r:
                deps.append(r)
        elif not type_only:
            ext.add(spec)
    graph[rel] = deps
    externals[rel] = sorted(ext)

# -------- libs --------
def lib_of(spec: str):
    s = spec
    if s == "uplot" or s.startswith("uplot/"): return "uplot"
    if s.startswith("lightweight-charts"): return "lightweight-charts"
    if s.startswith("echarts") or s.startswith("zrender"): return "echarts"
    if s.startswith("@perspective-dev"): return "perspective"
    if s.startswith("@tanstack/react-table"): return "tanstack-table"
    if s.startswith("@tanstack/react-virtual"): return "tanstack-virtual"
    if s.startswith("@tanstack/react-query"): return "tanstack-query"
    if s.startswith("dockview"): return "dockview"
    if s == "cmdk": return "cmdk"
    if s == "zustand" or s.startswith("zustand/"): return "zustand"
    if s in ("react", "react-dom") or s.startswith("react/") or s.startswith("react-dom/"): return "react"
    if s.startswith("@fontsource"): return "fonts"
    return None

CHART_COMPONENTS = {
    "CandleChart": "charts/CandleChart.tsx",
    "LineStack": "charts/LineStack.tsx",
    "EchartsChart": "charts/echarts/EchartsChart.tsx",
    "BarLadder": "charts/echarts/BarLadder.tsx",
    "Composition": "charts/echarts/Composition.tsx",
    "Cone": "charts/echarts/Cone.tsx",
    "Distribution": "charts/echarts/Distribution.tsx",
    "GlyphScatter": "charts/echarts/GlyphScatter.tsx",
    "Heatmap": "charts/echarts/Heatmap.tsx",
    "PScatter": "charts/echarts/PScatter.tsx",
    "Swimlane": "charts/echarts/Swimlane.tsx",
    "XyScatter": "charts/echarts/XyScatter.tsx",
    "MonitorGrid": "grids/MonitorGrid.tsx",
    "JournalTable": "grids/JournalTable.tsx",
    "PerspectiveGrid": "perspective/PerspectiveGrid.tsx",
    "PivotTableView": "perspective/PivotTableView.tsx",
    "pivots": "perspective/pivots.tsx",
    "KpiTile": "tiles/KpiTile.tsx",
    "BalanceCheck": "tiles/BalanceCheck.tsx",
    "Countdown": "tiles/Countdown.tsx",
    "SpecCard": "tiles/SpecCard.tsx",
}

ECH = ("echarts",)
COMP_LIBS = {"CandleChart": ("lightweight-charts",), "LineStack": ("uplot",), "MonitorGrid": ("tanstack-table", "tanstack-virtual"),
             "JournalTable": ("tanstack-table", "tanstack-virtual"), "PerspectiveGrid": ("perspective",), "PivotTableView": ("perspective",), "pivots": ("perspective",)}
for _n in ("EchartsChart", "BarLadder", "Composition", "Cone", "Distribution", "GlyphScatter", "Heatmap", "PScatter", "Swimlane", "XyScatter"):
    COMP_LIBS[_n] = ECH

# -------- hooks -> routes --------
hook_routes = defaultdict(set)
for qf in ("api/queries.ts", "api/queries.screens.ts"):
    txt = texts[qf]
    # split on 'export const useX' / 'export function useX'
    parts = re.split(r"\n(?=export (?:const|function) use)", txt)
    for part in parts:
        m = re.match(r"export (?:const|function) (use\w+)", part)
        if not m:
            continue
        for r in re.findall(r"'(/api/[^']+)'", part):
            hook_routes[m.group(1)].add(r)
hook_routes = {k: sorted(v) for k, v in hook_routes.items()}

ROUTE_RE = re.compile(r"""['"`](/api/[A-Za-z0-9_\-/{}.]+)['"`]""")
def routes_in(rel):
    txt = texts[rel]
    rs = set(ROUTE_RE.findall(txt))
    for h, rr in hook_routes.items():
        if re.search(r"\b" + h + r"\b", txt) and not rel.startswith("api/queries"):
            rs.update(rr)
    return rs

# -------- features --------
FEATURES = [
    ("canvas-2d", r"getContext\(|toBlob\(|toDataURL\(|<canvas|renderer: 'canvas'|CanvasRenderer"),
    ("web-worker", r"\?worker|new Worker\("),
    ("wasm", r"WebAssembly|\.wasm\?url"),
    ("SSE", r"EventSource|useLiveStream|useLive\("),
    ("localStorage", r"localStorage|safeLocalStorage|safeStorage"),
    ("clipboard", r"navigator\.clipboard|ClipboardItem"),
    ("download", r"createObjectURL|saveBlob|downloadBlob|triggerDownload|from '.*download'"),
    ("print", r"window\.print|@media print|PrintDossier"),
    ("ResizeObserver", r"ResizeObserver"),
    ("MutationObserver", r"MutationObserver"),
    ("IntersectionObserver", r"IntersectionObserver"),
    ("rAF", r"requestAnimationFrame"),
    ("idle-callback", r"requestIdleCallback"),
    ("matchMedia", r"matchMedia"),
    ("pointer/drag", r"setPointerCapture|onPointerDown|onMouseDown|draggable|onDragStart|dragstart"),
    ("focus-mgmt", r"\.focus\(|tabIndex|useFocus|keepFocus|focusRestore"),
    ("inert/aria-hidden", r"\binert\b"),
    ("popover/menu", r"popover|role=\"menu\"|role: 'menu'|aria-haspopup"),
    ("window.open", r"window\.open"),
    ("history/location", r"history\.(push|replace)State|location\.(hash|search|href)"),
    ("Intl", r"Intl\."),
    ("structuredClone", r"structuredClone"),
    ("perf-API", r"performance\.(now|mark|measure)"),
    ("document.fonts", r"document\.fonts"),
    ("timers", r"setInterval\("),
]
CSS_FEATURES = [
    ("@container", r"@container"),
    (":has()", r":has\("),
    ("color-mix()", r"color-mix\("),
    ("@layer", r"@layer"),
    ("subgrid", r"subgrid"),
    ("scrollbar-color/width", r"scrollbar-(color|width|gutter)"),
    ("::-webkit-scrollbar", r"::-webkit-scrollbar"),
    ("-webkit- prefix", r"-webkit-(?!scrollbar)"),
    ("dvh/svh units", r"\d(dvh|svh|lvh)\b"),
    ("text-wrap", r"text-wrap"),
    ("@property", r"@property"),
    ("oklch/lab", r"oklch\(|oklab\(|lab\("),
    ("light-dark()", r"light-dark\("),
    ("@media forced-colors", r"forced-colors"),
    ("@media prefers-reduced-motion", r"prefers-reduced-motion"),
    ("@media prefers-contrast", r"prefers-contrast"),
    ("@media print", r"@media print"),
    ("CSS nesting (&)", r"^\s*&[\s.:\[]"),
    ("grid", r"display:\s*grid"),
    ("position: sticky", r"position:\s*sticky"),
    ("contain/content-visibility", r"content-visibility|contain:"),
    ("anchor positioning", r"anchor-name|position-anchor|anchor\("),
    ("@font-face", r"@font-face"),
    ("env(safe-area)", r"env\(safe-area"),
    ("user-select", r"user-select"),
    ("pointer: coarse/hover", r"\(hover:|\(pointer:"),
]
KEY_NAMED = r"Enter|Escape|Esc|Tab|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Space|F\d{1,2}|NumpadEnter|Insert"
KEY_CMP = re.compile(r"""(?:\.key|\bkey|\.code|\bcode)\s*(?:===|!==|==)\s*['"]([^'"]+)['"]""")
CASE_RE = re.compile(r"""case\s+['"]([^'"]+)['"]\s*:""")
NAMED_RE = re.compile(r"""['"](""" + KEY_NAMED + r""")['"]""")
KEYMETA = re.compile(r"\b(ctrlKey|altKey|shiftKey|metaKey)\b")

def folder_of(rel: str):
    parts = rel.split("/")
    if parts[0] == "screens" and len(parts) > 2:
        return "screens/" + parts[1]
    if len(parts) == 1:
        return "(src root)"
    if parts[0] == "export" and len(parts) > 2:
        return "export/" + parts[1]
    if parts[0] == "charts" and len(parts) > 2 and parts[1] in ("echarts", "theme"):
        return "charts/" + parts[1]
    if parts[0] == "perspective" and len(parts) > 2 and parts[1] == "vendor":
        return "perspective"
    return parts[0]

# group files by folder
folders = defaultdict(lambda: {"all": 0, "prod": 0, "test": 0, "other": 0, "l_prod_code": 0, "l_prod_css": 0, "l_test": 0, "l_other": 0, "files": []})
for f in files:
    fo = folder_of(f["rel"])
    d = folders[fo]
    d["all"] += 1
    if f["kind"] == "prod":
        d["prod"] += 1
        if f["ext"] == ".css":
            d["l_prod_css"] += f["lines"]
        else:
            d["l_prod_code"] += f["lines"]
    elif f["kind"] == "test":
        d["test"] += 1
        d["l_test"] += f["lines"]
    else:
        d["other"] += 1
        d["l_other"] += f["lines"]
    d["files"].append(f["rel"])

# features/keys/routes/libs per folder
def closure(start, allowed_prefixes):
    seen = set(start)
    stack = list(start)
    while stack:
        cur = stack.pop()
        for d in graph.get(cur, []):
            if d in seen:
                continue
            if not any(d.startswith(p) for p in allowed_prefixes):
                continue
            seen.add(d)
            stack.append(d)
    return seen

FOLLOW = ("charts/", "grids/", "perspective/", "tiles/", "export/", "screens/", "quant/", "format/")
for fo, d in folders.items():
    own = [r for r in d["files"] if r in code_files]
    d["own_code"] = len(own)
    clo = closure(own, FOLLOW)
    # libs (charts and grids reach their libraries only through charts/lazy.ts and tanstack imports, see COMP_LIBS)
    direct_libs = set()
    for r in own:
        for sp in externals.get(r, []):
            l = lib_of(sp)
            if l: direct_libs.add(l)
    d["libs_direct"] = sorted(direct_libs)
    # components
    comps_direct, comps_via = set(), set()
    for name, path in CHART_COMPONENTS.items():
        if path in own: continue
        # direct import
        if any(path in graph.get(r, []) for r in own):
            comps_direct.add(name)
        elif path in clo:
            comps_via.add(name)
    d["comps_direct"] = sorted(comps_direct)
    d["comps_via"] = sorted(comps_via)
    vl = set()
    for c in comps_direct | comps_via:
        vl |= set(COMP_LIBS.get(c, ()))
    d["libs_via"] = sorted(vl - direct_libs)
    # routes
    r_own, r_via = set(), set()
    for r in own:
        r_own |= routes_in(r)
    for r in clo:
        if r not in own:
            r_via |= routes_in(r)
    d["routes_own"] = sorted(r_own)
    d["routes_via"] = sorted(r_via - r_own)
    # keys
    keys = set(); metas = set(); handlers = 0
    for r in own:
        t = texts[r]
        for m in KEY_CMP.finditer(t):
            if len(m.group(1)) == 1 or re.fullmatch(KEY_NAMED, m.group(1)): keys.add(m.group(1))
        if KEY_CMP.search(t) or "onKeyDown" in t or "keydown" in t:
            for m in CASE_RE.finditer(t):
                if re.fullmatch(KEY_NAMED, m.group(1)): keys.add(m.group(1))
        for m in NAMED_RE.finditer(t):
            if ("onKeyDown" in t or "keydown" in t or ".key" in t): keys.add(m.group(1))
        for m in KEYMETA.finditer(t): metas.add(m.group(1))
        handlers += len(re.findall(r"onKeyDown|addEventListener\(\s*['\"]key(down|up|press)['\"]", t))
    d["keys"] = sorted(keys, key=lambda k: (len(k) == 1, k))
    d["key_metas"] = sorted(metas)
    d["key_handlers"] = handlers
    # features
    feats = {}
    for name, pat in FEATURES:
        n = sum(1 for r in own if re.search(pat, texts[r]))
        if n: feats[name] = n
    d["features"] = feats
    cssf = {}
    for name, pat in CSS_FEATURES:
        n = sum(1 for r in own if r.endswith(".css") and re.search(pat, texts[r], re.M))
        if n: cssf[name] = n
    d["css_features"] = cssf
    # a11y counters in prod tsx
    a11y = {"aria-*": 0, "role=": 0, "tabIndex": 0, "inert": 0, "aria-live": 0, "focus()": 0, "sr-only": 0}
    for r in own:
        if not r.endswith((".tsx", ".ts")): continue
        t = texts[r]
        a11y["aria-*"] += len(re.findall(r"\baria-[a-z]+", t))
        a11y["role="] += len(re.findall(r"\brole=|role:\s*'", t))
        a11y["tabIndex"] += len(re.findall(r"tabIndex|tabindex", t))
        a11y["inert"] += len(re.findall(r"\binert\b", t))
        a11y["aria-live"] += len(re.findall(r"aria-live|role=\"(status|alert|log)\"", t))
        a11y["focus()"] += len(re.findall(r"\.focus\(", t))
        a11y["sr-only"] += len(re.findall(r"sr-only|visually-hidden|srOnly", t))
    d["a11y"] = a11y

# mnemonics per folder from WorkspaceScreens
ws = texts["chrome/WorkspaceScreens.tsx"]
fn_to_folder = {}
for m in re.finditer(r"const (\w+) = \(\) => import\('\.\./screens/(\w+)'\)", ws):
    fn_to_folder[m.group(1)] = m.group(2)
comp_folder = {}
for m in re.finditer(r"const (\w+) = lazy\(\s*\(\)\s*=>\s*(?:import\('\.\./screens/(\w+)(?:/\w+)?'\)|(\w+)\(\))", ws):
    comp_folder[m.group(1)] = m.group(2) or fn_to_folder.get(m.group(3))
mn_folder = {}
reg = re.search(r"BUILT_SCREENS: ScreenRegistry = \{(.*?)\n\}", ws, re.S).group(1)
for m in re.finditer(r"(\w+):\s*(?:withHomeEquity\()?(\w+)\)?,", reg):
    code, comp = m.group(1), m.group(2)
    if comp == "HelpPanel": comp_folder.setdefault("HelpPanel", "help")
    mn_folder[code] = comp_folder.get(comp, comp)

from_registry = re.findall(r"def\('(\w+)', '(P\d)', '([^']+)'(?:, '(\w+)')?\)", texts["commands/registry.ts"])
mn_meta = {c: {"priority": p, "context": ctx, "arg": a or "none"} for c, p, ctx, a in from_registry}
titles = dict(re.findall(r"^\s{2}(\w+): '([^']+)',?$", re.search(r"export const MNEMONIC_SCREENS = \{(.*?)\n\} as const", texts["copy/commands.ts"], re.S).group(1), re.M))
titles["HOME"] = "Home view"

# schema paths
schema = (SRC / "api/schema.d.ts").read_text(encoding="utf-8")
paths_block = schema.split("export interface paths {")[1].split("\n}\n")[0]
schema_paths = {}
PATH_RE = re.compile(r'^    "(/[^"]+)": \{\n(.*?)\n    \};', re.S | re.M)
for m in PATH_RE.finditer(schema.split('export interface paths {')[1]):
    meths = re.findall(r"^        (get|put|post|delete|patch|head|options): (?!never)", m.group(2), re.M)
    schema_paths[m.group(1)] = meths
# methods per path (rough): look at components 'operations' ... determine via path interface
path_methods = {}
for p, iface_name in schema_paths.items():
    # path items in schema.d.ts are of form  "/api/x": { parameters..., get: operations["..."], put: never ... }
    pass

all_used_routes = set()
for rel in code_files:
    if rel.startswith("api/schema") or rel.startswith("demo/"): continue
    all_used_routes |= routes_in(rel)

json.dump({
    "folders": folders, "mn_folder": mn_folder, "mn_meta": mn_meta, "titles": titles,
    "hook_routes": hook_routes, "schema_paths": schema_paths,
    "all_used_routes": sorted(all_used_routes),
    "files_total": len(files),
    "externals": {k: v for k, v in externals.items() if v},
}, open(OUT, "w", encoding="utf-8"), indent=1, default=lambda o: sorted(o) if isinstance(o, set) else str(o))
print("ok", len(files), len(folders), len(mn_folder), len(schema_paths))

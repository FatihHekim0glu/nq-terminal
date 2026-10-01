"""Static safety bans over the terminal's source (TASKS 1.3; ARCHITECTURE sections 5, 6 and 9).

Every ban has born-failing snippets (BANNED_CASES) that must be flagged, allowed look-alikes
(ALLOWED_CASES) that must not be, and a run over the real tree that must come back clean.

Scopes
- PROD: `terminal/backend/nq_terminal/**`. Every ban, including writes.
- TEST: `terminal/backend/tests/**` except this file (its snippets are the born-failing inputs, and
  `test_this_file_would_fail_without_its_exclusion` proves the exclusion is needed). Every ban except
  writes (tests write to tmp_path), plus the test gate rules.
- OTHER: any other `*.py` under `terminal/` (for example `terminal/qa` from Phase 3). The common bans,
  writes (ARCHITECTURE section 9 bans writes anywhere outside `terminal/state`) and the test gate rules.
- WEB: `terminal/web/src/**` text, for the order call names only.

Rules
- parquet, dataset: `read_parquet`, `ParquetFile`, `ParquetDataset`, `read_feather`, `read_orc`; any
  import or use of `pyarrow.parquet`, `pyarrow.dataset`, `pyarrow.feather`, `pyarrow.orc`, `fastparquet`.
  Only `services/catalog.py` may use `pyarrow.parquet`, and only as `ParquetFile(p).metadata`,
  `ParquetFile(p).schema_arrow`, `read_metadata(p)` or `read_schema(p)` (metadata, no rows). An import
  alias (`ParquetFile as PF`) is resolved before both the ban and the metadata sanction.
- duckdb, polars: any import, static or dynamic.
- serve_sealed: any reference, import, definition or `getattr` string.
- String literals equal to a banned name are flagged like the name itself (a `getattr` on them would reach
  it): the columnar readers, `serve_sealed`, the order calls, `close_opening`, the ungated loaders and
  `RAW_QUANTPAD` everywhere, and `serve_bars` in PROD.
- data_path: strings holding `data/processed`, `data/raw` or `data/sealed_cache` (either slash); path
  joins `"data" / "processed"` and `Path(..., "data", "raw")`; `nq_lab.config.RAW_QUANTPAD`; the ungated
  loaders `nq_lab.data.make_loader`, `load_chunks`, `build_continuous`, and `processed_path` (catalog only).
- write (PROD): `open` in a writing or non-literal mode, `write_text`, `write_bytes`, `unlink`, `mkdir`,
  `to_parquet` and friends, `to_csv`/`to_json` given a target, `.rename`/`.replace` with one positional
  argument, a `target=` keyword or `**` (a path move), unless `safety_receivers.py` proves the receiver is a
  pandas object or it is a string, dict or lambda argument; `pathlib.Path.rename`/`replace` called unbound,
  `os` writes (`os.rename` included), `shutil` (`shutil.move` included), `tempfile`, `subprocess`, file
  logging, `numpy.save`, `pickle.dump`, `io.FileIO` in a writing mode, `extractall`, `urlretrieve`,
  `nq_lab.registry.write`/`main` (everywhere), and in PROD any `scripts.*` import. A method called on a name
  bound to a module file under `nq_terminal/` (`stored_alpha.extract(...)`) is not a write by its name alone: that
  module is scanned itself. `WRITE_ALLOWED` lists
  modules that may write under
  `terminal/state`: the P2 job runner (`services/jobs.py`, U3) only.
- order_call: `placeOrder`, `cancelOrder`, `reqGlobalCancel`, `exerciseOptions`, `reqAutoOpenOrders`,
  `reqOpenOrders`, their six `...ProtoBuf` twins, and the Nautilus `submit_order`, `cancel_order`, `modify_order` family, as a call, a
  reference, an import or a `getattr` string. A `def` of those names is allowed (the P2 read-only client
  overrides them to raise).
- ledger_append: any import of `scripts.ledger_append` (static, `importlib`, `runpy`). The ledger copy
  command text is a plain string and is fine.
- ib_client: `ibapi`, `nautilus_trader.live`, `nautilus_trader.adapters.interactive_brokers`,
  `nq_lab.ib_patches`. `ibapi` alone is allowed in `services/ib_readonly_client.py` and `tests/ib_fake_server.py`
  (the P2 read-only snapshot); the other three stay banned everywhere.
- gate_door: `oos_gate.close_opening` anywhere; in PROD also `oos_gate.serve_bars` (the one door is
  `nq_lab.data.serve`), and a direct `nq_lab.data.serve` call must pass `caller="terminal"`.
- test_gate (TEST, OTHER): `serve_bars` must get an explicit `log_path` that is not None, and the real
  `nq_lab.data.serve` is never called (it appends to the real audit log).
- dynamic (PROD): `exec`, `eval`, `compile` (also as `builtins.*`), `.exec_module()`, and imports by a
  computed name (`importlib.import_module`, `__import__`, `builtins.__import__`, `importlib.__import__`,
  `importlib.util.find_spec`/`module_from_spec`, `runpy`, `pkgutil.resolve_name`), which would hide a
  module from these bans. A literal module name given to any of them is checked like an import.
- syntax: a file that does not parse fails, rather than being skipped.

These are tripwires, not a sandbox: a name built at run time can still slip past. The run-time guard in
`conftest.py` (research files) and the gate's own refusals are the other layers.
"""
from __future__ import annotations

import ast
import hashlib
import re
import textwrap
from dataclasses import dataclass
from pathlib import Path

import pytest

from safety_receivers import pandas_receivers

TERMINAL = Path(__file__).resolve().parents[2]
BACKEND = TERMINAL / "backend"
PACKAGE = BACKEND / "nq_terminal"
TESTS = BACKEND / "tests"
THIS_FILE = Path(__file__).resolve()
WEB_SRC = TERMINAL / "web" / "src"
SKIP_DIRS = frozenset({"node_modules", ".venv", "venv", "__pycache__", "dist", ".pytest_cache", ".mypy_cache"})
PY_SUFFIXES = frozenset({".py"})
WEB_SUFFIXES = frozenset({".ts", ".tsx", ".js", ".jsx", ".mjs"})
PROD, TEST, OTHER = "prod", "test", "other"
CATALOG = "backend/nq_terminal/services/catalog.py"
IB_CLIENT_ALLOWED = frozenset({"backend/nq_terminal/services/ib_readonly_client.py", "backend/tests/ib_fake_server.py"})
RULES = ("parquet", "dataset", "duckdb", "polars", "serve_sealed", "data_path", "write", "order_call",
         "ledger_append", "ib_client", "gate_door", "test_gate", "dynamic", "syntax")


@dataclass(frozen=True)
class Violation:
    rule: str
    where: str
    line: int
    detail: str

    def __str__(self) -> str:
        return f"{self.where}:{self.line} [{self.rule}] {self.detail}"


WRITE_ALLOWED: frozenset[str] = frozenset({"backend/nq_terminal/services/jobs.py"})
# The qa golden-file tools (`--write PATH` regenerates a golden vector file under terminal/qa) and their tests, which
# write temporary files and run the tools in a subprocess. They sit outside the terminal's own code, in OTHER scope.
QA_WRITE_ALLOWED: frozenset[str] = frozenset({
    "qa/crosscheck/p12_expectation.py", "qa/crosscheck/p12_neff.py", "qa/crosscheck/p12_power.py",
    "qa/tests/test_p12_expectation.py", "qa/tests/test_p12_neff.py", "qa/tests/test_p12_power.py",
})

BANNED_MODULES = {
    "pyarrow.parquet": "parquet", "fastparquet": "parquet",
    "pyarrow.dataset": "dataset", "pyarrow.feather": "dataset", "pyarrow.orc": "dataset",
    "duckdb": "duckdb", "polars": "polars",
    "scripts.ledger_append": "ledger_append", "ledger_append": "ledger_append",
    "ibapi": "ib_client", "nautilus_trader.live": "ib_client",
    "nautilus_trader.adapters.interactive_brokers": "ib_client", "nq_lab.ib_patches": "ib_client",
}
BANNED_OBJECTS = {
    "pandas.read_parquet": "parquet", "pandas.read_feather": "dataset", "pandas.read_orc": "dataset",
    "nq_lab.data.serve_sealed": "serve_sealed", "nq_lab.oos_gate.serve_sealed": "serve_sealed",
    "nq_lab.config.RAW_QUANTPAD": "data_path", "nq_lab.data.make_loader": "data_path",
    "nq_lab.data.load_chunks": "data_path", "nq_lab.data.build_continuous": "data_path",
    "nq_lab.data.processed_path": "data_path", "nq_lab.oos_gate.close_opening": "gate_door",
    "nq_lab.registry.write": "write", "nq_lab.registry.main": "write",
}
PROD_ONLY_OBJECTS = {"nq_lab.oos_gate.serve_bars": "gate_door"}
PROD_ONLY_MODULES = {"scripts": "write"}  # research scripts write results; the terminal never imports them
PARQUET_FILE = "pyarrow.parquet.ParquetFile"
CATALOG_ALLOWED = frozenset({"pyarrow.parquet", "pyarrow.parquet.ParquetFile", "pyarrow.parquet.read_metadata",
                             "pyarrow.parquet.read_schema", "nq_lab.data.processed_path"})
METADATA_ATTRS = frozenset({"metadata", "schema_arrow"})
COLUMNAR_READS = {"read_parquet": "parquet", "ParquetFile": "parquet", "ParquetDataset": "parquet",
                  "read_feather": "dataset", "read_orc": "dataset"}
ORDER_NAMES = frozenset({
    "placeOrder", "cancelOrder", "reqGlobalCancel", "exerciseOptions", "reqAutoOpenOrders", "reqOpenOrders",
    "placeOrderProtoBuf", "cancelOrderProtoBuf", "reqGlobalCancelProtoBuf", "exerciseOptionsProtoBuf",
    "reqAutoOpenOrdersProtoBuf", "reqOpenOrdersProtoBuf",
    "submit_order", "submit_order_list", "cancel_order", "cancel_orders", "cancel_all_orders", "modify_order",
    "close_position", "close_all_positions",
})
DATA_PATH_RE = re.compile(r"(?i)\bdata[\\/]+(processed|raw|sealed_cache)\b")
DATA_SEGMENTS = frozenset({"processed", "raw", "sealed_cache"})
REAL_SERVE, SERVE_BARS = "nq_lab.data.serve", "nq_lab.oos_gate.serve_bars"
MODE_SECOND_OPENERS = frozenset({"open", "builtins.open", "io.open", "_io.open", "io.FileIO", "_io.FileIO",
                                 "codecs.open", "gzip.open", "bz2.open", "lzma.open", "tarfile.open",
                                 "zipfile.ZipFile"})
WRITE_ATTRS = frozenset({
    "write_text", "write_bytes", "unlink", "rmdir", "touch", "mkdir", "symlink_to", "hardlink_to", "chmod",
    "to_parquet", "to_feather", "to_pickle", "to_excel", "to_hdf", "to_sql", "to_stata", "to_orc",
    "write_table", "write_feather", "write_dataset", "write_to_dataset", "savetxt", "savez", "tofile",
    "extractall", "extract",
})
TARGET_WRITERS = frozenset({"to_csv", "to_json", "to_html", "to_markdown", "to_latex", "to_xml", "to_string"})
TARGET_KEYWORDS = frozenset({"path_or_buf", "buf", "path", "excel_writer"})
OS_WRITES = frozenset({"remove", "unlink", "rename", "renames", "replace", "rmdir", "removedirs", "mkdir",
                       "makedirs", "truncate", "ftruncate", "write", "open", "fdopen", "link", "symlink",
                       "chmod", "utime", "system", "popen", "startfile"})
WRITE_PREFIXES = ("shutil.", "tempfile.", "subprocess.", "logging.handlers.")
WRITE_QUALIFIED = frozenset({"numpy.save", "numpy.savez", "numpy.savez_compressed", "numpy.savetxt",
                             "pickle.dump", "marshal.dump", "shelve.open", "sqlite3.connect",
                             "logging.FileHandler", "urllib.request.urlretrieve"})
PATH_MOVES = frozenset({"rename", "replace"})
NOT_A_PATH = (ast.Dict, ast.DictComp, ast.Lambda, ast.Set, ast.List, ast.Tuple)
DYNAMIC_IMPORTERS = frozenset({"importlib.import_module", "__import__", "builtins.__import__", "importlib.__import__",
                               "runpy.run_module", "runpy.run_path", "importlib.util.spec_from_file_location",
                               "importlib.util.find_spec", "importlib.util.module_from_spec",
                               "pkgutil.resolve_name"})
DYNAMIC_EXEC = frozenset({"exec", "eval", "compile", "builtins.exec", "builtins.eval", "builtins.compile"})
DYNAMIC_ATTRS = frozenset({"exec_module", "load_module"})  # spec.loader.exec_module(m) runs a module by spec
# Names that are banned as a getattr string literal too (the literal is in the source, not built at run time).
LITERAL_RULES = {"serve_bars": ("gate_door", True), "close_opening": ("gate_door", False),
                 "make_loader": ("data_path", False), "load_chunks": ("data_path", False),
                 "build_continuous": ("data_path", False), "RAW_QUANTPAD": ("data_path", False),
                 "processed_path": ("data_path", False)}  # name -> (rule, PROD only)


def _is_str(node: ast.AST | None) -> bool:
    return isinstance(node, ast.Constant) and isinstance(node.value, str)


def _docstring_ids(tree: ast.AST) -> set[int]:
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and _is_str(first.value):
                ids.add(id(first.value))
    return ids


def _aliases(tree: ast.AST) -> dict[str, str]:
    """Local name -> the qualified module or object it is bound to by an import."""
    names: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.asname:
                    names[alias.asname] = alias.name
                else:
                    root = alias.name.split(".")[0]
                    names[root] = root
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            for alias in node.names:
                names[alias.asname or alias.name] = f"{node.module}.{alias.name}"
    return names


def _last_segment(node: ast.AST) -> ast.AST | None:
    """The right-most literal of a path expression: `x / "data"`, `Path(x, "data")` or `"data"`."""
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
        return node.right
    if isinstance(node, ast.Call) and node.args:
        return node.args[-1]
    return node


def _data_pair(left: ast.AST | None, right: ast.AST | None) -> bool:
    if not (_is_str(left) and _is_str(right)):
        return False
    tail = re.split(r"[\\/]", left.value.strip("\\/"))[-1].lower()
    head = re.split(r"[\\/]", right.value.strip("\\/"))[0].lower()
    return tail == "data" and head in DATA_SEGMENTS


def _mode_problem(call: ast.Call, index: int) -> str | None:
    """Why an open-like call may write, or None when its mode is a literal read mode."""
    mode = next((k.value for k in call.keywords if k.arg == "mode"), None)
    if mode is None and any(isinstance(a, ast.Starred) for a in call.args):
        return "opens a file with unpacked arguments (cannot prove it only reads)"
    if mode is None and len(call.args) > index:
        mode = call.args[index]
    if mode is None:
        return None
    if not _is_str(mode):
        return "opens a file with a non-literal mode (cannot prove it only reads)"
    return f"opens a file with mode {mode.value!r}" if set(mode.value) & set("wax+") else None


def _qualified_write(full: str | None) -> bool:
    if not full:
        return False
    head, _, tail = full.partition(".")
    if head == "os" and (tail in OS_WRITES or tail.startswith(("spawn", "exec"))):
        return True
    if head == "pathlib" and tail.rsplit(".", 1)[-1] in PATH_MOVES:
        return True  # `Path.rename(source, target)` called unbound
    return full.startswith(WRITE_PREFIXES) or full in WRITE_QUALIFIED


def _moves_a_file(call: ast.Call, on_pandas: bool) -> bool:
    """A `.rename`/`.replace` shaped like a path move: one positional argument, `target=` or `**` keywords."""
    if call.func.attr not in PATH_MOVES or on_pandas or _is_str(call.func.value):
        return False
    if any(k.arg in (None, "target") for k in call.keywords):
        return True
    return len(call.args) == 1 and not call.keywords and not isinstance(call.args[0], NOT_A_PATH)


def _terminal_module(dotted: str | None) -> bool:
    """Whether a name is bound to a module of the terminal package itself (a real file under `nq_terminal/`)."""
    parts = (dotted or "").split(".")
    if parts[0] != "nq_terminal":
        return False
    path = PACKAGE.joinpath(*parts[1:])
    return path.with_suffix(".py").is_file() or (path / "__init__.py").is_file()


def _write_problem(call: ast.Call, full: str | None, on_pandas: bool = False, on_terminal: bool = False
                   ) -> str | None:
    func = call.func
    name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
    if full in MODE_SECOND_OPENERS:
        return _mode_problem(call, 1)
    if _qualified_write(full):
        return f"{full} writes to the file system or starts a process"
    if full == "logging.basicConfig" and any(k.arg == "filename" for k in call.keywords):
        return "logging.basicConfig(filename=...) writes a log file"
    if not isinstance(func, ast.Attribute) or on_terminal:
        return None  # a terminal module's function is scanned where it is defined
    if name == "open":
        return _mode_problem(call, 0)
    if name in WRITE_ATTRS:
        return f".{name}() writes to the file system"
    if name in TARGET_WRITERS and (call.args or any(k.arg in TARGET_KEYWORDS for k in call.keywords)):
        return f".{name}() given a target writes a file"
    if _moves_a_file(call, on_pandas):
        return f".{name}(target) moves a file (a pandas rename needs a receiver the scan can prove is pandas)"
    return None


class Scanner(ast.NodeVisitor):
    """Walks one module and records every banned use for its scope."""

    def __init__(self, tree: ast.AST, where: str, scope: str):
        self.where, self.scope = where, scope
        self.is_catalog = where == CATALOG
        self.aliases = _aliases(tree)
        self.pandas_calls = pandas_receivers(tree, self.aliases)
        self.docstrings = _docstring_ids(tree)
        self.sanctioned: set[int] = set()
        self.found: dict[tuple[str, int], Violation] = {}

    def flag(self, rule: str, node: ast.AST, detail: str) -> None:
        line = getattr(node, "lineno", 0)
        self.found.setdefault((rule, line), Violation(rule, self.where, line, detail))

    def dotted(self, node: ast.AST) -> str | None:
        parts = []
        while isinstance(node, ast.Attribute):
            parts.append(node.attr)
            node = node.value
        if not isinstance(node, ast.Name):
            return None
        return ".".join([self.aliases.get(node.id, node.id), *reversed(parts)])

    def qualified_rule(self, full: str) -> str | None:
        if self.is_catalog and full in CATALOG_ALLOWED:
            return None
        if self.where in IB_CLIENT_ALLOWED and (full == "ibapi" or full.startswith("ibapi.")):
            return None
        if self.scope == PROD and full in PROD_ONLY_OBJECTS:
            return PROD_ONLY_OBJECTS[full]
        if full in BANNED_OBJECTS:
            return BANNED_OBJECTS[full]
        modules = [*BANNED_MODULES.items(), *(PROD_ONLY_MODULES.items() if self.scope == PROD else ())]
        for module, rule in modules:
            if full == module or full.startswith(module + "."):
                return rule
        return None

    def check_identifier(self, name: str, node: ast.AST, load: bool = True) -> None:
        if name == "serve_sealed":
            self.flag("serve_sealed", node, "refers to serve_sealed (the sealed door is never used)")
        elif load and name in ORDER_NAMES:
            self.flag("order_call", node, f"refers to the order call {name}")
        elif name in COLUMNAR_READS and id(node) not in self.sanctioned:
            self.flag(COLUMNAR_READS[name], node, f"{name} reads a columnar file outside the gate")

    def check_qualified(self, full: str | None, node: ast.AST) -> bool:
        rule = self.qualified_rule(full) if full else None
        if rule:
            self.flag(rule, node, f"uses {full}")
        return rule is not None

    # ----- imports and names -----
    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self.check_qualified(alias.name, node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        for alias in node.names:
            full = f"{node.module}.{alias.name}" if node.level == 0 and node.module else None
            if full and self.is_catalog and full in CATALOG_ALLOWED:
                continue
            if not self.check_qualified(full, node):
                self.check_identifier(alias.name, node)

    def visit_Name(self, node: ast.Name) -> None:
        target = self.aliases.get(node.id)
        if target and self.check_qualified(target, node):
            return
        load = isinstance(node.ctx, ast.Load)
        self.check_identifier(node.id, node, load)
        if target and target.rsplit(".", 1)[-1] != node.id:  # `import x as y`: check what y really names
            self.check_identifier(target.rsplit(".", 1)[-1], node, load)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if self.is_catalog and node.attr in METADATA_ATTRS and isinstance(node.value, ast.Call):
            func = node.value.func
            if self.dotted(func) == PARQUET_FILE:  # resolves `pq.ParquetFile` and `PF` bound by an alias
                self.sanctioned.add(id(func))
        if self.check_qualified(self.dotted(node), node):
            return
        self.check_identifier(node.attr, node, isinstance(node.ctx, ast.Load))
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        if node.name == "serve_sealed":
            self.flag("serve_sealed", node, "defines serve_sealed")
        self.generic_visit(node)

    visit_AsyncFunctionDef = visit_FunctionDef

    # ----- literals and path joins -----
    def visit_Constant(self, node: ast.Constant) -> None:
        if not isinstance(node.value, str) or id(node) in self.docstrings:
            return
        text = node.value.strip()
        if text == "serve_sealed" or text in ORDER_NAMES or text in COLUMNAR_READS:
            self.check_identifier(text, node)
        self.check_literal_name(text, node)
        if DATA_PATH_RE.search(node.value):
            self.flag("data_path", node, f"string names a raw data folder: {node.value[:80]!r}")

    def check_literal_name(self, text: str, node: ast.AST) -> None:
        if text not in LITERAL_RULES:
            return
        rule, prod_only = LITERAL_RULES[text]
        if prod_only and self.scope != PROD:
            return
        if self.is_catalog and text == "processed_path":
            return
        self.flag(rule, node, f"string names {text} (a getattr on it reaches the banned object)")

    def visit_BinOp(self, node: ast.BinOp) -> None:
        if isinstance(node.op, ast.Div) and _data_pair(_last_segment(node.left), node.right):
            self.flag("data_path", node, "joins a path into data/processed, data/raw or data/sealed_cache")
        self.generic_visit(node)

    # ----- calls -----
    def visit_Call(self, node: ast.Call) -> None:
        full = self.dotted(node.func)
        if any(_data_pair(a, b) for a, b in zip(node.args, node.args[1:])):
            self.flag("data_path", node, "builds a path into data/processed, data/raw or data/sealed_cache")
        self.check_dynamic(node, full)
        self.check_serve(node, full)
        if self.scope in (PROD, OTHER) and self.where not in WRITE_ALLOWED | QA_WRITE_ALLOWED:
            receiver = self.dotted(node.func.value) if isinstance(node.func, ast.Attribute) else None
            problem = _write_problem(node, full, id(node) in self.pandas_calls, _terminal_module(receiver))
            if problem:
                self.flag("write", node, problem)
        self.generic_visit(node)

    def check_dynamic(self, node: ast.Call, full: str | None) -> None:
        if full in DYNAMIC_IMPORTERS:
            literals = [a.value for a in node.args if _is_str(a)]
            for text in literals:
                self.check_module_literal(text, node)
            if not literals and self.scope == PROD:
                self.flag("dynamic", node, f"{full} with a computed name hides the module from these bans")
        elif full in DYNAMIC_EXEC and self.scope == PROD:
            self.flag("dynamic", node, f"{full}() runs code these bans cannot see")
        elif getattr(node.func, "attr", None) in DYNAMIC_ATTRS and self.scope == PROD:
            self.flag("dynamic", node, f".{node.func.attr}() runs a module these bans cannot see")

    def check_module_literal(self, text: str, node: ast.AST) -> None:
        module = text.removesuffix(".py").replace("\\", "/").replace("/", ".")
        if "ledger_append" in text:
            self.flag("ledger_append", node, f"loads {text!r}")
        elif not self.check_qualified(module, node) and DATA_PATH_RE.search(text):
            self.flag("data_path", node, f"loads {text!r}")

    def check_serve(self, node: ast.Call, full: str | None) -> None:
        keywords = {k.arg: k.value for k in node.keywords}
        if full == REAL_SERVE and self.scope == PROD:
            caller = keywords.get("caller")
            if not (_is_str(caller) and caller.value == "terminal"):
                self.flag("gate_door", node, "nq_lab.data.serve must be called with caller='terminal'")
        elif full == REAL_SERVE:
            self.flag("test_gate", node, "calls the real serve, which appends to results/oos_access_log.jsonl")
        elif full == SERVE_BARS and self.scope != PROD:
            log_path = keywords.get("log_path")
            if log_path is None or (isinstance(log_path, ast.Constant) and log_path.value is None):
                self.flag("test_gate", node, "serve_bars needs an explicit temporary log_path in tests")


def scan_source(source: str, where: str, scope: str) -> list[Violation]:
    try:
        tree = ast.parse(source, filename=where)
    except SyntaxError as exc:
        return [Violation("syntax", where, exc.lineno or 0, f"does not parse: {exc.msg}")]
    scanner = Scanner(tree, where, scope)
    scanner.visit(tree)
    return sorted(scanner.found.values(), key=lambda v: (v.line, v.rule))


WEB_ORDER_RE = re.compile(r"\b(" + "|".join(sorted(ORDER_NAMES)) + r")\b")


def scan_web_text(text: str, where: str) -> list[Violation]:
    return [Violation("order_call", where, n, f"names the order call {m.group(1)}")
            for n, line in enumerate(text.splitlines(), start=1) for m in WEB_ORDER_RE.finditer(line)]


def walk_files(base: Path, suffixes: frozenset[str]) -> list[Path]:
    found = []
    for folder, dirs, names in base.resolve().walk():
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        found.extend(folder / n for n in names if Path(n).suffix in suffixes)
    return sorted(found)


def scoped_files() -> dict[Path, str]:
    """Every Python file under terminal/ with its scope, except this file."""
    package, tests = PACKAGE.resolve(), TESTS.resolve()
    scoped = {}
    for path in walk_files(TERMINAL, PY_SUFFIXES):
        if path == THIS_FILE:
            continue
        scoped[path] = PROD if path.is_relative_to(package) else TEST if path.is_relative_to(tests) else OTHER
    return scoped


def scan_file(path: Path, scope: str) -> list[Violation]:
    where = path.resolve().relative_to(TERMINAL.resolve()).as_posix()
    return scan_source(path.read_text(encoding="utf-8"), where, scope)


# ---------------------------------------------------------------------------------------------------------
# Born-failing cases: each snippet contains a banned call and must be flagged with its rule.
# ---------------------------------------------------------------------------------------------------------
PROD_AT = "backend/nq_terminal/services/example.py"
TEST_AT = "backend/tests/test_example.py"
OTHER_AT = "qa/crosscheck/example.py"
WHERE = {PROD: PROD_AT, TEST: TEST_AT, OTHER: OTHER_AT}


def banned(rule: str, snippet: str, scope: str = PROD, where: str | None = None):
    return pytest.param(rule, scope, where or WHERE[scope], snippet)


BANNED_CASES = [
    banned("parquet", "import pandas as pd\npd.read_parquet('x.parquet')"),
    banned("parquet", "frame = loader.read_parquet(path)"),
    banned("parquet", "import pyarrow.parquet as pq\npq.read_table(path)"),
    banned("parquet", "from pyarrow import parquet"),
    banned("parquet", "from pyarrow.parquet import read_table"),
    banned("parquet", "import pyarrow\npyarrow.parquet.read_table(path)"),
    banned("parquet", "import fastparquet"),
    banned("parquet", "import pandas as pd\npd.read_parquet(path)", TEST),
    banned("parquet", "import pyarrow.parquet as pq\npq.read_table(path)", where=CATALOG),
    banned("parquet", "import pyarrow.parquet as pq\nhandle = pq.ParquetFile(path)\nhandle.read()", where=CATALOG),
    banned("parquet", "import pyarrow.parquet as pq\nwith pq.ParquetFile(path) as f:\n    meta = f.metadata",
           where=CATALOG),
    banned("dataset", "import pyarrow.dataset as ds\nds.dataset(path)"),
    banned("dataset", "from pyarrow import dataset"),
    banned("dataset", "import pyarrow as pa\npa.dataset.dataset(path)"),
    banned("dataset", "import pyarrow.feather as feather", TEST),
    banned("dataset", "import pandas as pd\npd.read_feather(path)"),
    banned("duckdb", "import duckdb"),
    banned("duckdb", "from duckdb import connect", TEST),
    banned("duckdb", "import importlib\nimportlib.import_module('duckdb')"),
    banned("polars", "import polars as pl"),
    banned("polars", "import polars", OTHER),
    banned("polars", "__import__('polars')"),
    banned("serve_sealed", "from nq_lab.data import serve_sealed"),
    banned("serve_sealed", "from nq_lab import oos_gate\noos_gate.serve_sealed(a, b)"),
    banned("serve_sealed", "import nq_lab.data\nnq_lab.data.serve_sealed(a, b)", TEST),
    banned("serve_sealed", "door = getattr(gate, 'serve_sealed')"),
    banned("serve_sealed", "def serve_sealed(*args):\n    pass"),
    banned("data_path", "PATH = 'data/processed/NQ.V.0_1m_back.parquet'"),
    banned("data_path", "PATH = r'C:\\nq-lab\\data\\raw\\quantpad'"),
    banned("data_path", "PATH = ROOT / 'data' / 'processed'"),
    banned("data_path", "from pathlib import Path\nPATH = Path(ROOT, 'data', 'raw')"),
    banned("data_path", "from pathlib import Path\nPATH = Path('data') / 'raw' / 'quantpad'"),
    banned("data_path", "PATH = f'{ROOT}/data/sealed_cache/{name}.parquet'", TEST),
    banned("data_path", "from nq_lab.config import RAW_QUANTPAD"),
    banned("data_path", "from nq_lab.data import make_loader"),
    banned("data_path", "from nq_lab.data import load_chunks", TEST),
    banned("data_path", "from nq_lab import data\ndata.build_continuous('NQ.V.0')"),
    banned("data_path", "from nq_lab import data\npath = data.processed_path('NQ.V.0')"),
    banned("write", "open(path, 'w', encoding='utf-8')"),
    banned("write", "open(path, mode='a', encoding='utf-8')"),
    banned("write", "open(path, 'r+b')"),
    banned("write", "open(path, chosen_mode)"),
    banned("write", "from pathlib import Path\nPath(path).open('x', encoding='utf-8')"),
    banned("write", "path.write_text('x', encoding='utf-8')"),
    banned("write", "path.write_bytes(b'')"),
    banned("write", "frame.to_csv(path)"),
    banned("write", "frame.to_csv(path_or_buf=path)"),
    banned("write", "frame.to_parquet(path)"),
    banned("write", "import os\nos.replace(a, b)"),
    banned("write", "from os import remove\nremove(path)"),
    banned("write", "import os\nos.open(path, os.O_WRONLY)"),
    banned("write", "path.replace(target)"),
    banned("write", "path.rename(target)"),
    banned("write", "path.unlink()"),
    banned("write", "path.mkdir(parents=True)"),
    banned("write", "import shutil\nshutil.copyfile(a, b)"),
    banned("write", "import subprocess\nsubprocess.run(['python', 'x.py'])"),
    banned("write", "import json\njson.dump(doc, open(path, 'w', encoding='utf-8'))"),
    banned("write", "import numpy as np\nnp.save(path, values)"),
    banned("write", "import logging\nlogging.basicConfig(filename='terminal.log')"),
    banned("write", "import logging\nhandler = logging.FileHandler('terminal.log')"),
    banned("write", "import tempfile\ntempfile.mkstemp()"),
    banned("order_call", "client.placeOrder(order_id, contract, order)"),
    banned("order_call", "self.submit_order(order)"),
    banned("order_call", "strategy.cancel_order(order)", TEST),
    banned("order_call", "app.reqGlobalCancel()", OTHER),
    banned("order_call", "modify_order(order, quantity=1)"),
    banned("order_call", "client.cancelOrder(7, '')"),
    banned("order_call", "client.exerciseOptions(1, c, 1, 1, '', 0)"),
    banned("order_call", "send = getattr(client, 'placeOrder')"),
    banned("order_call", "send = client.placeOrder"),
    banned("order_call", "client.placeOrderProtoBuf(proto)"),
    banned("order_call", "client.reqGlobalCancelProtoBuf(proto)", TEST),
    banned("order_call", "send = getattr(client, 'cancelOrderProtoBuf')"),
    banned("order_call", "from nq_lab.strategies.za_orb import submit_order"),
    banned("ledger_append", "import scripts.ledger_append"),
    banned("ledger_append", "from scripts import ledger_append"),
    banned("ledger_append", "from scripts.ledger_append import main", TEST),
    banned("ledger_append", "import importlib\nimportlib.import_module('scripts.ledger_append')"),
    banned("ledger_append", "import runpy\nrunpy.run_path('scripts/ledger_append.py')", TEST),
    banned("ib_client", "from ibapi.client import EClient"),
    banned("ib_client", "from nautilus_trader.live.node import TradingNode"),
    banned("ib_client", "from nautilus_trader.adapters.interactive_brokers.config import InteractiveBrokersDataClientConfig"),
    banned("ib_client", "from nq_lab import ib_patches", OTHER),
    banned("ib_client", "from ibapi.client import EClient", where="backend/nq_terminal/services/ib_snapshot.py"),
    banned("ib_client", "from ibapi.client import EClient", TEST, where="backend/tests/test_ib_snapshot.py"),
    banned("ib_client", "from nautilus_trader.live.node import TradingNode",
           where="backend/nq_terminal/services/ib_readonly_client.py"),
    banned("gate_door", "from nq_lab.oos_gate import serve_bars"),
    banned("gate_door", "from nq_lab import oos_gate\nframe = oos_gate.serve_bars(a, b, caller='terminal', reason='r')"),
    banned("gate_door", "from nq_lab import oos_gate\noos_gate.close_opening('rebal_v1_confirm')"),
    banned("gate_door", "from nq_lab.oos_gate import close_opening", TEST),
    banned("gate_door", "from nq_lab.data import serve\nserve(a, b, caller='rebal_v0', reason='terminal display')"),
    banned("gate_door", "from nq_lab import data\ndata.serve(a, b, reason='terminal display: NQ')"),
    banned("test_gate", "from nq_lab.oos_gate import serve_bars\nserve_bars(a, b, caller='t', reason='nqt-test', loader=f)",
           TEST),
    banned("test_gate", "from nq_lab import oos_gate\noos_gate.serve_bars(a, b, caller='t', reason='r', loader=f, "
           "log_path=None)", TEST),
    banned("test_gate", "from nq_lab import oos_gate\noos_gate.serve_bars(a, b, **kwargs)", TEST),
    banned("test_gate", "from nq_lab.data import serve\nserve(a, b, caller='terminal', reason='nqt-test read')", TEST),
    banned("test_gate", "import nq_lab.data\nnq_lab.data.serve(a, b, caller='terminal', reason='r')", OTHER),
    banned("dynamic", "import importlib\nmodule = importlib.import_module(name)"),
    banned("dynamic", "exec(code)"),
    banned("dynamic", "value = eval(text)"),
    banned("syntax", "def broken(:\n    pass"),
    # Improvement run 1: spellings the first version let through (each scanned clean before the fix).
    banned("parquet", "from pyarrow.parquet import ParquetFile as PF\nrows = PF(p).read()", where=CATALOG),
    banned("parquet", "from pyarrow.parquet import ParquetFile as PF\nfor b in PF(p).iter_batches():\n    pass",
           where=CATALOG),
    banned("parquet", "import pyarrow.parquet as pq\nF = pq.ParquetFile\nF(p).read()", where=CATALOG),
    banned("parquet", "import pandas as pd\nread = getattr(pd, 'read_parquet')"),
    banned("parquet", "import pyarrow.parquet as pq\nopen_file = getattr(pq, 'ParquetFile')", where=CATALOG),
    banned("dataset", "import pandas as pd\nread = getattr(pd, 'read_feather')"),
    banned("gate_door", "from nq_lab import oos_gate\ndoor = getattr(oos_gate, 'serve_bars')"),
    banned("gate_door", "from nq_lab import oos_gate\nshut = getattr(oos_gate, 'close_opening')", TEST),
    banned("data_path", "from nq_lab import data\nload = getattr(data, 'make_loader')"),
    banned("data_path", "from nq_lab import config\nraw = getattr(config, 'RAW_QUANTPAD')"),
    banned("data_path", "from nq_lab import data\npath = getattr(data, 'processed_path')"),
    banned("duckdb", "import builtins\nbuiltins.__import__('duckdb')"),
    banned("polars", "import importlib\nimportlib.__import__('polars')"),
    banned("polars", "import importlib.util\nspec = importlib.util.find_spec('polars')"),
    banned("dynamic", "import importlib.util\nmodule = importlib.util.module_from_spec(spec)"),
    banned("dynamic", "spec.loader.exec_module(module)"),
    banned("dynamic", "import builtins\nbuiltins.exec(code)"),
    banned("dynamic", "import builtins\nvalue = builtins.eval(text)"),
    banned("dynamic", "import builtins\nmodule = builtins.__import__(name)"),
    banned("write", "import io\nfh = io.FileIO(path, 'w')"),
    banned("write", "from io import FileIO\nfh = FileIO(path, 'a')"),
    banned("write", "open(path, 'w', encoding='utf-8')", OTHER),
    banned("write", "import io\nfh = io.FileIO(path, 'w')", OTHER),
    banned("write", "from nq_lab import registry\nregistry.write(registry.build(RESULTS), RESULTS)"),
    banned("write", "from nq_lab.registry import write"),
    banned("write", "from nq_lab import registry\nregistry.main()", TEST),
    banned("write", "import zipfile\nzipfile.ZipFile(path).extractall(target)"),
    banned("write", "import urllib.request\nurllib.request.urlretrieve(url, path)"),
    banned("write", "from scripts import registry_tools"),
    banned("write", "import scripts.pull_daily_universe"),
    # Phase 3.1 cleanup: file moves stay flagged while pandas `.rename` on a known pandas receiver is allowed.
    banned("write", "import os\nos.rename(a, b)"),
    banned("write", "from os import rename\nrename(a, b)"),
    banned("write", "import shutil\nshutil.move(a, b)"),
    banned("write", "from pathlib import Path\nPath(source).rename(target)"),
    banned("write", "from pathlib import Path\nPath.rename(source, target)"),
    banned("write", "path.rename(target=dest)"),
    banned("write", "from pathlib import Path\ndef move(path: Path) -> None:\n    path.rename('moved.csv')"),
    banned("write", "import pandas as pd\nfrom pathlib import Path\nidx = frame.index\nidx = Path(p)\nidx.rename(t)"),
    banned("write", "import pandas as pd\nseries = pd.Series(v)\ndef f(series):\n    series.rename(t)"),
    banned("write", "import pandas as pd\nnames = pd.Series(v).tolist()\nfor path in names:\n    path.replace(t)"),
    banned("write", "archive.extract(member, target)"),
    banned("write", "from nq_lab import registry\nregistry.extract(member)"),
    banned("write", "from nq_terminal.services import stored_alpha\nstored_alpha.handle.extract(member)"),
    banned("write", "from nq_terminal import services\nimport zipfile as services\nservices.ZipFile(p).extract(m)"),
]


def allowed(snippet: str, scope: str = PROD, where: str | None = None):
    return pytest.param(scope, where or WHERE[scope], snippet)


ALLOWED_CASES = [
    allowed("from ibapi.client import EClient\nfrom ibapi.wrapper import EWrapper",
            where="backend/nq_terminal/services/ib_readonly_client.py"),
    allowed("from ibapi.protobuf.Position_pb2 import Position", TEST, where="backend/tests/ib_fake_server.py"),
    allowed("open(path, encoding='utf-8')"),
    allowed("open(path, 'rb')"),
    allowed("open(path, mode='r', encoding='utf-8')"),
    allowed("from pathlib import Path\nPath(path).open(encoding='utf-8')"),
    allowed("path.open('r', encoding='utf-8')"),
    allowed("text = path.read_text(encoding='utf-8')"),
    allowed("clean = 'a+b'.replace('+', ' ')"),
    allowed("stamp = now.isoformat().replace('+00:00', 'Z')"),
    allowed("frame = frame.rename(columns={'a': 'b'})"),
    allowed("frame = frame.replace({float('inf'): None})"),
    allowed("text = frame.to_csv(index=False)"),
    allowed("text = frame.to_json(orient='records')"),
    allowed('"""Reads prices only through nq_lab.data.serve, never data/processed or data/raw directly."""\nX = 1'),
    allowed("def f():\n    \"\"\"Never calls serve_sealed or placeOrder.\"\"\"\n    return 1"),
    allowed("CMD = r'python scripts\\ledger_append.py backtests\\output\\<run_id>\\result.json --exp-id <exp>'"),
    allowed("from nq_lab import data\nSERVE = data.serve"),
    allowed("from nq_lab.data import serve\nframe = serve(a, b, caller='terminal', reason='terminal display: NQ 1m 2019')"),
    allowed("from nq_lab import live_guards, oos_gate\noos_gate.check_openings_pin(path)\noos_gate.load_openings(path)"),
    allowed("from nq_lab.config import IS_END, IS_START, OOS_LOG, RESULTS, ROOT"),
    allowed("PATH = settings.data_root / 'results' / 'registry.csv'"),
    allowed("PATH = settings.data_root / 'live' / 'logs'"),
    allowed("import pyarrow.parquet as pq\nmeta = pq.ParquetFile(path).metadata\nschema = pq.ParquetFile(path).schema_arrow",
            where=CATALOG),
    allowed("import pyarrow.parquet as pq\nmeta = pq.read_metadata(path)\nschema = pq.read_schema(path)", where=CATALOG),
    allowed("from pyarrow.parquet import ParquetFile\nmeta = ParquetFile(path).metadata", where=CATALOG),
    allowed("from nq_lab.data import processed_path\npath = processed_path('NQ.V.0', '1m', 'vendor')", where=CATALOG),
    allowed("class ReadOnlyClient:\n    def placeOrder(self, *args):\n        raise RuntimeError('no order path')"),
    allowed("import re\nPATTERN = re.compile('order|submit|cancel|modify')"),
    allowed("import json\ndoc = json.loads(text)"),
    allowed("import importlib\nimportlib.import_module('nq_lab.metrics')"),
    allowed("from nq_lab import oos_gate\nframe = oos_gate.serve_bars(a, b, caller='t', reason='nqt-test read', loader=f, "
            "log_path=tmp_path / 'oos.jsonl')", TEST),
    allowed("from nq_lab.oos_gate import serve_bars\nframe = serve_bars(a, b, caller='t', reason='r', loader=f, "
            "log_path=log)", TEST),
    allowed("path.write_text('x', encoding='utf-8')\nwith open(path, 'a', encoding='utf-8') as fh:\n    fh.write('y')", TEST),
    allowed("import subprocess, sys\nsubprocess.run([sys.executable, '-c', 'print(1)'], check=True)", TEST),
    allowed("import pandas as pd\nframe = pd.read_csv(path)", TEST),
    allowed("import pandas as pd\nframe = pd.read_csv(path)", OTHER),
    allowed("import importlib\nmodule = importlib.import_module(name)", TEST),
    allowed("from pyarrow.parquet import ParquetFile as PF\nmeta = PF(p).metadata\nschema = PF(p).schema_arrow",
            where=CATALOG),
    allowed("import io\nfh = io.FileIO(path)"),
    allowed("import io\nfh = io.FileIO(path, 'rb')", OTHER),
    allowed("import json\ndoc = json.loads(path.read_text(encoding='utf-8'))", OTHER),
    allowed("from nq_lab import oos_gate\nmonkeypatch.setattr(oos_gate, 'serve_bars', fake)", TEST),
    allowed("from nq_lab import registry\nrows = registry.build(RESULTS)"),
    allowed("MESSAGE = 'prices come from the gate, never from a parquet reader'"),
    allowed("path.write_text('x', encoding='utf-8')", TEST),
    # Phase 3.1 cleanup: pandas `.rename`/`.replace` with one positional argument on a known pandas receiver.
    allowed("import pandas as pd\nseries = pd.Series([1.0]).rename('r')"),
    allowed("import pandas as pd\ndef f(r: pd.Series) -> pd.Series:\n    return r.rename('strategy')"),
    allowed("import pandas as pd\ndef f(r: pd.Series | None):\n    return r.rename('strategy')"),
    allowed("from pandas import Series\ndef f(r: 'Series'):\n    return r.replace(0.0)"),
    allowed("idx = series.index\nkeys = [idx.year.rename('year'), idx.month.rename('month')]"),
    allowed("import pandas as pd\nframe = pd.DataFrame(d)\nout = frame['a'].rename('b')"),
    allowed("import pandas as pd\ns = pd.Series(v)\ns = s.dropna()\nt = (1.0 + s).cumprod().rename('equity')"),
    allowed("import pandas as pd\ns = pd.Series(v)\ndef f():\n    return s.rename('outer')"),
    # A function of a terminal module is scanned where it is defined, so its name alone is not a write.
    allowed("from nq_terminal.services import market\nvalue = market.extract(name, cost, screen)"),
    allowed("import nq_terminal.services.market as m\nvalue = m.extract(name, cost, screen)"),
]


@pytest.mark.parametrize(("rule", "scope", "where", "snippet"), BANNED_CASES)
def test_ban_is_born_failing(rule: str, scope: str, where: str, snippet: str) -> None:
    found = scan_source(textwrap.dedent(snippet), where, scope)
    assert rule in {v.rule for v in found}, f"[{rule}] not flagged in {scope} {where}:\n{snippet}\nfound: {found}"


@pytest.mark.parametrize(("scope", "where", "snippet"), ALLOWED_CASES)
def test_allowed_code_passes(scope: str, where: str, snippet: str) -> None:
    assert scan_source(textwrap.dedent(snippet), where, scope) == []


def test_every_rule_has_born_failing_cases() -> None:
    assert {case.values[0] for case in BANNED_CASES} == set(RULES)


def test_scan_covers_the_terminal_sources() -> None:
    scoped = scoped_files()
    assert scoped.get(PACKAGE.resolve() / "app.py") == PROD
    assert scoped.get(PACKAGE.resolve() / "api" / "system.py") == PROD
    assert scoped.get(TESTS.resolve() / "conftest.py") == TEST
    assert scoped.get(TESTS.resolve() / "research_guard.py") == TEST
    assert THIS_FILE not in scoped


def test_only_this_file_is_excluded() -> None:
    assert set(walk_files(TERMINAL, PY_SUFFIXES)) - set(scoped_files()) == {THIS_FILE}


def test_this_file_would_fail_without_its_exclusion() -> None:
    assert {"data_path", "order_call"} <= {v.rule for v in scan_file(THIS_FILE, TEST)}


@pytest.mark.parametrize("scope", [PROD, TEST, OTHER])
def test_real_tree_passes(scope: str) -> None:
    files = [path for path, kind in scoped_files().items() if kind == scope]
    if scope != OTHER:
        assert files, f"no {scope} files found: the scan would pass vacuously"
    violations = [v for path in files for v in scan_file(path, scope)]
    assert not violations, "\n".join(str(v) for v in violations)


def test_web_scan_is_born_failing() -> None:
    assert [v.rule for v in scan_web_text("await client.placeOrder(1, c, o)", "web/src/x.ts")] == ["order_call"]
    assert scan_web_text("const sortOrder = 'asc'; // no order path", "web/src/x.ts") == []


def test_session_fixture_records_sha256_before_and_after(tmp_path: Path) -> None:
    from conftest import RESEARCH_FILES, sha256_lines

    same, grown, gone = tmp_path / "ledger.csv", tmp_path / "oos_access_log.jsonl", tmp_path / "oos_openings.json"
    lines = sha256_lines({same: b"a\n", grown: b"x\n", gone: b"{}"}, {same: b"a\n", grown: b"x\ny\n", gone: None})
    assert lines[0] == f"sha256 ledger.csv unchanged: {hashlib.sha256(b'a\n').hexdigest()}"
    assert lines[1].startswith("sha256 oos_access_log.jsonl changed during the session: ")
    assert lines[1].endswith(hashlib.sha256(b"x\ny\n").hexdigest())
    assert lines[2].endswith("-> missing")
    assert {p.name for p in RESEARCH_FILES} == {"oos_access_log.jsonl", "ledger.csv", "registry.csv",
                                                "oos_openings.json"}


def test_real_web_sources_have_no_order_calls() -> None:
    files = walk_files(WEB_SRC, WEB_SUFFIXES) if WEB_SRC.is_dir() else []
    violations = [v for p in files for v in scan_web_text(p.read_text(encoding="utf-8"), p.name)]
    assert not violations, "\n".join(str(v) for v in violations)

"""Static scan for the ways round the read-only IB client that a name ban cannot see.

The name ban (`order_uses`, the safety scan) finds a banned name written out. This scan finds the shapes that never
write it, in the terminal's production code (`nq_terminal/**`):

- dynamic_attr: in a module that touches the IB library or the client, `getattr`, `setattr`, `delattr`, `hasattr`,
  `operator.attrgetter` and `methodcaller` with a name that is not a string literal (a name built at run time), a
  literal that names the raw connection or a sending hook, and reflection into class dictionaries (`vars`,
  `__dict__`, `__getattribute__`, `__mro__`, `__subclasses__`).
- raw_send: `sendMsg` and `sendMsgProtoBuf` anywhere except `super().sendMsg(...)` inside the same-named override of
  `ReadOnlyClient` (the two guarded hooks); and, in a module that touches the IB library, any `.conn` or `.socket`
  attribute (`conn.sendMsg` skips the guard, and so does a write to the socket).
- out_id: any `OUT.<NAME>` whose message id is not on `ALLOWED_REQUEST_IDS`, and any other use of `OUT` itself
  (`getattr(OUT, name)`, `vars(OUT)`), which could pick an id at run time.
- import: `socket`, `_socket` and `ssl` (also loaded by `importlib` or `__import__` with a literal name), any `ibapi`
  module outside `client`, `common`, `execution`, `message` and `wrapper` (the connection and framing modules reach
  the socket), and star imports of the library or the client module.

Tripwires, not a sandbox: the run-time guard in `sendMsg` and `sendMsgProtoBuf` is the layer that holds.
"""
from __future__ import annotations

import ast
from typing import NamedTuple

from nq_terminal.services import ib_readonly_client as client_module

ALLOWED_OUT_NAMES = frozenset(
    name for name, value in vars(client_module.OUT).items()
    if not name.startswith("_") and value in client_module.ALLOWED_REQUEST_IDS)
CLIENT_FILE_SUFFIX = "services/ib_readonly_client.py"
CLIENT_CLASS = "ReadOnlyClient"
GUARDED_SENDERS = frozenset({"sendMsg", "sendMsgProtoBuf"})
RAW_ATTRS = frozenset({"conn", "socket"})
REFLECTION_ATTRS = frozenset({"__dict__", "__getattribute__", "__getattr__", "__mro__", "__bases__",
                              "__subclasses__"})
NAME_ARG_INDEX = {"getattr": 1, "setattr": 1, "delattr": 1, "hasattr": 1, "methodcaller": 0}
NAME_ARG_ALL = frozenset({"attrgetter"})
NET_MODULES = frozenset({"socket", "_socket", "ssl"})
IBAPI_SUBMODULES = frozenset({"client", "common", "execution", "message", "wrapper"})
DYNAMIC_IMPORTERS = frozenset({"import_module", "__import__", "find_spec"})
CLIENT_MODULE_NAME = "ib_readonly_client"


class Finding(NamedTuple):
    rule: str
    line: int
    detail: str


def _aliases(tree: ast.AST) -> dict[str, str]:
    names: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names[alias.asname or alias.name.split(".")[0]] = alias.name if alias.asname else alias.name.split(".")[0]
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                names[alias.asname or alias.name] = f"{node.module}.{alias.name}" if node.module else alias.name
    return names


def _touches_ib(aliases: dict[str, str]) -> bool:
    return any(full.split(".")[0] == "ibapi" or CLIENT_MODULE_NAME in full.split(".") for full in aliases.values())


def _is_literal(node: ast.AST | None) -> bool:
    return isinstance(node, ast.Constant) and isinstance(node.value, str)


def _callee(func: ast.AST) -> str | None:
    return func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)


class _Scan(ast.NodeVisitor):
    def __init__(self, tree: ast.AST, where: str) -> None:
        self.where = where
        self.is_client_file = where.endswith(CLIENT_FILE_SUFFIX)
        self.aliases = _aliases(tree)
        self.touches_ib = _touches_ib(self.aliases)
        self.findings: list[Finding] = []
        self.scope: list[tuple[str, str]] = []  # ("class" | "def", name), outermost first
        self.handled: set[int] = set()

    def flag(self, rule: str, node: ast.AST, detail: str) -> None:
        self.findings.append(Finding(rule, getattr(node, "lineno", 0), detail))

    def dotted(self, node: ast.AST) -> str | None:
        parts = []
        while isinstance(node, ast.Attribute):
            parts.append(node.attr)
            node = node.value
        if not isinstance(node, ast.Name):
            return None
        return ".".join([self.aliases.get(node.id, node.id), *reversed(parts)])

    def is_out(self, node: ast.AST) -> bool:
        full = self.dotted(node)
        if full is None:
            return False
        return full == "OUT" or (full.endswith(".OUT") and ("ibapi" in full or CLIENT_MODULE_NAME in full))

    def in_guarded_override(self, attr: str) -> bool:
        defs = [i for i, (kind, _) in enumerate(self.scope) if kind == "def"]
        if not (self.is_client_file and defs):
            return False
        last = defs[-1]
        owner = self.scope[last - 1] if last else None
        return self.scope[last][1] == attr and owner == ("class", CLIENT_CLASS)

    # ----- scopes -----
    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.scope.append(("class", node.name))
        self.generic_visit(node)
        self.scope.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        in_client_class = bool(self.scope) and self.scope[-1] == ("class", CLIENT_CLASS) and self.is_client_file
        if node.name in GUARDED_SENDERS and not in_client_class:
            self.flag("raw_send", node, f"defines {node.name} outside the read-only client")
        self.scope.append(("def", node.name))
        self.generic_visit(node)
        self.scope.pop()

    visit_AsyncFunctionDef = visit_FunctionDef

    # ----- imports -----
    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            parts = alias.name.split(".")
            if parts[0] in NET_MODULES:
                self.flag("import", node, f"imports {alias.name}")
            elif parts[0] == "ibapi" and len(parts) > 1 and parts[1] not in IBAPI_SUBMODULES:
                self.flag("import", node, f"imports {alias.name}")

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        parts = (node.module or "").split(".")
        for alias in node.names:
            if alias.name in GUARDED_SENDERS:
                self.flag("raw_send", node, f"imports {alias.name}")
            if parts[0] in NET_MODULES:
                self.flag("import", node, f"imports from {node.module}")
            elif parts[0] == "ibapi":
                submodule = parts[1] if len(parts) > 1 else alias.name
                if alias.name == "*" or submodule not in IBAPI_SUBMODULES:
                    self.flag("import", node, f"imports {node.module}.{alias.name}")
            elif alias.name == "*" and CLIENT_MODULE_NAME in parts:
                self.flag("import", node, "star import of the read-only client module")

    # ----- names and attributes -----
    def visit_Name(self, node: ast.Name) -> None:
        if self.is_out(node) and id(node) not in self.handled:
            self.flag("out_id", node, "uses OUT other than as OUT.<an allowed message id>")

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if self.is_out(node.value):
            self.handled.add(id(node.value))
            if node.attr not in ALLOWED_OUT_NAMES:
                self.flag("out_id", node, f"OUT.{node.attr} is not on the read-only list")
            return
        if node.attr in GUARDED_SENDERS and not self.is_guarded_super_call(node):
            self.flag("raw_send", node, f"{node.attr} outside the two guarded overrides")
        elif self.touches_ib and node.attr in RAW_ATTRS:
            self.flag("raw_send", node, f".{node.attr} reaches the raw connection")
        elif self.touches_ib and node.attr in REFLECTION_ATTRS:
            self.flag("dynamic_attr", node, f".{node.attr} reaches members by reflection")
        self.generic_visit(node)

    def is_guarded_super_call(self, node: ast.Attribute) -> bool:
        base = node.value
        is_super = isinstance(base, ast.Call) and getattr(base.func, "id", None) == "super"
        return is_super and self.in_guarded_override(node.attr)

    # ----- calls -----
    def visit_Call(self, node: ast.Call) -> None:
        name = _callee(node.func)
        if name in DYNAMIC_IMPORTERS and node.args and _is_literal(node.args[0]):
            if node.args[0].value.split(".")[0] in NET_MODULES:
                self.flag("import", node, f"{name}({node.args[0].value!r}) loads a network module")
        if name in NAME_ARG_INDEX or name in NAME_ARG_ALL or name == "vars":
            self.check_reflective_call(node, name)
        self.generic_visit(node)

    def check_reflective_call(self, node: ast.Call, name: str) -> None:
        if node.args and self.is_out(node.args[0]):
            self.handled.add(id(node.args[0]))
            self.check_out_literal(node, name)
            return
        if not self.touches_ib:
            return
        if name == "vars":
            self.flag("dynamic_attr", node, "vars() reaches members by reflection")
            return
        names = node.args if name in NAME_ARG_ALL else node.args[NAME_ARG_INDEX[name]:NAME_ARG_INDEX[name] + 1]
        for arg in names:
            if not _is_literal(arg):
                self.flag("dynamic_attr", node, f"{name}() with a name built at run time")
            elif set(arg.value.split(".")) & (GUARDED_SENDERS | RAW_ATTRS | REFLECTION_ATTRS):
                self.flag("dynamic_attr", node, f"{name}({arg.value!r}) reaches a sending hook or the connection")

    def check_out_literal(self, node: ast.Call, name: str) -> None:
        arg = node.args[1] if len(node.args) > 1 else None
        if name in NAME_ARG_INDEX and _is_literal(arg) and arg.value in ALLOWED_OUT_NAMES:
            return
        self.flag("out_id", node, f"{name}(OUT, ...) with a name that is not an allowed message id")


def ib_bypass_uses(source: str, where: str) -> list[Finding]:
    """Every bypass shape in `source`, as `(rule, line, detail)`; `where` is the posix path under `terminal/`."""
    tree = ast.parse(source, filename=where)
    scan = _Scan(tree, where)
    scan.visit(tree)
    return sorted(scan.findings, key=lambda f: (f.line, f.rule))

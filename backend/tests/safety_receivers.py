"""Receiver types for the write ban in `test_safety_ast.py`: which `.rename(x)` / `.replace(x)` calls are pandas.

On a `pathlib.Path`, a one-argument `.rename` or `.replace` moves a file; on a pandas Series, DataFrame or Index it
only renames labels or swaps values. The write ban flags every such call unless this module proves the receiver is
a pandas object. It proves that only from the source of one module, scope by scope:

- a name is pandas when every binding of it in its scope is pandas: a parameter or variable annotated with a pandas
  type (a union with None counts), or an assignment whose value is a pandas expression. Any other binding (an
  unannotated parameter, a `for` or `with` target, a tuple target, an import, `global`) makes it unknown;
- a name not bound in a function comes from the enclosing function or the module, as Python resolves it;
- a pandas expression is a call to anything in `pandas`, a pandas-only attribute (`.index`, `.columns`, `.dt`,
  `.loc`, `.iloc`, `.at`, `.iat`) on any receiver, or an attribute, method call, subscript or arithmetic on a
  pandas expression.

Unknown means flagged, so a gap here can only cause a false positive, never let a file move through. Like the rest
of the scan it is a tripwire: a Path stored inside a pandas object and taken out again would pass.
"""
from __future__ import annotations

import ast

PANDAS_ONLY_ATTRS = frozenset({"index", "columns", "dt", "loc", "iloc", "at", "iat"})
PANDAS_TYPES = frozenset({"Series", "DataFrame", "Index", "DatetimeIndex", "MultiIndex", "RangeIndex",
                          "PeriodIndex", "TimedeltaIndex", "CategoricalIndex"})
AMBIGUOUS_MOVES = frozenset({"rename", "replace"})
SCOPES = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)
PANDAS, UNKNOWN = "pandas", None  # binding markers besides an expression


def _dotted(node: ast.AST, aliases: dict[str, str]) -> str | None:
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if not isinstance(node, ast.Name):
        return None
    return ".".join([aliases.get(node.id, node.id), *reversed(parts)])


def _is_pandas_name(full: str | None) -> bool:
    return bool(full) and (full == "pandas" or full.startswith("pandas."))


def _pandas_annotation(node: ast.AST | None, aliases: dict[str, str]) -> bool:
    """True for `pd.Series`, `'Series'` imported from pandas, and unions of pandas types with None."""
    if node is None:
        return False
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        try:
            return _pandas_annotation(ast.parse(node.value, mode="eval").body, aliases)
        except SyntaxError:
            return False
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        sides = (node.left, node.right)
        return all(_is_none(s) or _pandas_annotation(s, aliases) for s in sides) and not all(map(_is_none, sides))
    full = _dotted(node, aliases)
    return _is_pandas_name(full) and full.rsplit(".", 1)[-1] in PANDAS_TYPES


def _is_none(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and node.value is None


def is_pandas(node: ast.AST, known: set[str], aliases: dict[str, str]) -> bool:
    """Whether an expression is proven to hold a pandas object, given the names known to be pandas."""
    if isinstance(node, ast.Name):
        return node.id in known
    if isinstance(node, ast.Attribute):
        return node.attr in PANDAS_ONLY_ATTRS or is_pandas(node.value, known, aliases)
    if isinstance(node, ast.Call):
        func = node.func
        if _is_pandas_name(_dotted(func, aliases)):
            return True
        return isinstance(func, ast.Attribute) and is_pandas(func.value, known, aliases)
    if isinstance(node, ast.Subscript):
        return is_pandas(node.value, known, aliases)
    if isinstance(node, ast.BinOp):
        return is_pandas(node.left, known, aliases) or is_pandas(node.right, known, aliases)
    if isinstance(node, ast.UnaryOp):
        return is_pandas(node.operand, known, aliases)
    return False


def _own_nodes(scope: ast.AST):
    """Every node of a scope except those inside nested scopes (which are yielded as scopes, not walked)."""
    stack = list(ast.iter_child_nodes(scope))
    while stack:
        node = stack.pop()
        yield node
        if not isinstance(node, SCOPES):
            stack.extend(ast.iter_child_nodes(node))


def _parameters(scope: ast.AST, aliases: dict[str, str]) -> dict[str, list]:
    if not isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
        return {}
    args = scope.args
    every = [*args.posonlyargs, *args.args, *args.kwonlyargs, *filter(None, (args.vararg, args.kwarg))]
    return {a.arg: [PANDAS if _pandas_annotation(a.annotation, aliases) else UNKNOWN] for a in every}


def _bound_by(node: ast.AST, aliases: dict[str, str]) -> list[tuple[str, object]]:
    if isinstance(node, ast.Assign):
        return [(t.id, node.value) for t in node.targets if isinstance(t, ast.Name)]
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        marker = PANDAS if _pandas_annotation(node.annotation, aliases) else node.value
        return [(node.target.id, marker)]
    if isinstance(node, (ast.Global, ast.Nonlocal)):
        return [(name, UNKNOWN) for name in node.names]
    if isinstance(node, (ast.Import, ast.ImportFrom)):
        return [((a.asname or a.name).split(".")[0], UNKNOWN) for a in node.names]
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return [(node.name, UNKNOWN)]
    if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
        return [(node.id, UNKNOWN)]  # every other store: for, with, comprehension and tuple targets, walrus, del
    return []


def _known(bindings: dict[str, list], inherited: set[str], aliases: dict[str, str]) -> set[str]:
    """Greatest fixpoint: drop names with a non-pandas binding until nothing changes."""
    candidates = set(bindings)
    while True:
        known = (inherited - set(bindings)) | candidates
        keep = {n for n in candidates if all(_binding_is_pandas(v, known, aliases) for v in bindings[n])}
        if keep == candidates:
            return known
        candidates = keep


def _binding_is_pandas(value: object, known: set[str], aliases: dict[str, str]) -> bool:
    if value is PANDAS:
        return True
    return isinstance(value, ast.AST) and is_pandas(value, known, aliases)


def _explicit_targets(scope: ast.AST) -> set[int]:
    """ids of the Name targets that an Assign or AnnAssign binds (already counted with their value)."""
    ids = set()
    for node in _own_nodes(scope):
        if isinstance(node, ast.Assign):
            ids.update(id(t) for t in node.targets if isinstance(t, ast.Name))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            ids.add(id(node.target))
    return ids


def _scope_bindings(scope: ast.AST, aliases: dict[str, str]) -> dict[str, list]:
    """Name -> its bindings in this scope: an expression, PANDAS (annotated) or UNKNOWN."""
    explicit, found = _explicit_targets(scope), _parameters(scope, aliases)
    for node in _own_nodes(scope):
        if isinstance(node, ast.Name) and id(node) in explicit:
            continue
        for name, value in _bound_by(node, aliases):
            found.setdefault(name, []).append(value)
    return found


def pandas_receivers(tree: ast.AST, aliases: dict[str, str]) -> set[int]:
    """ids of the `.rename(...)` / `.replace(...)` Call nodes whose receiver is proven to be a pandas object."""
    found: set[int] = set()
    _walk_scope(tree, set(), aliases, found)
    return found


def _walk_scope(scope: ast.AST, inherited: set[str], aliases: dict[str, str], found: set[int]) -> None:
    known = _known(_scope_bindings(scope, aliases), inherited, aliases)
    for node in _own_nodes(scope):
        func = getattr(node, "func", None)
        moves = isinstance(node, ast.Call) and isinstance(func, ast.Attribute) and func.attr in AMBIGUOUS_MOVES
        if moves and is_pandas(func.value, known, aliases):
            found.add(id(node))
        if isinstance(node, SCOPES):
            # A class body's names are not visible inside its methods; a function's are, in nested functions.
            _walk_scope(node, inherited if isinstance(scope, ast.ClassDef) else known, aliases, found)

"""Static bans for the read-only IB client (ARCHITECTURE s8 and s9; TASKS Phase 12 QA gate).

- No order-style call name is called, referenced, imported or used as a string anywhere under `terminal/`
  (Python sources and the web sources). The one thing allowed is a `def` of such a name inside the read-only client
  class, and every such def must do nothing but raise.
- The IB library is imported by two files only: the read-only client and the fake server of the tests.
- The client class overrides every order-style call the library has, the text calls and their `ProtoBuf` twins. The set
  to override is derived from the library (every public method that looks like an order, a cancel or an exercise and
  is not on the reviewed read list), so a method a new library version adds is a failing test here, not a silent hole.
- The ways round a name ban (a name built at run time, a message id for an order, a raw send on the connection, a raw
  socket) are scanned for in the terminal's production code by `ib_bypass_scan.py`, each with born-failing snippets.

The names are taken from the safety scan's ban list and the library (`safety_names.py`), never written here.
Every ban has born-failing snippets and allowed look-alikes, and the real tree must come back clean.
"""
from __future__ import annotations

import ast
import os
import textwrap
from pathlib import Path

import pytest

from nq_terminal.services import ib_readonly_client
from nq_terminal.services.ib_readonly_client import OrderPathError, ReadOnlyClient

from ib_bypass_scan import ALLOWED_OUT_NAMES, ib_bypass_uses
from safety_names import ib_client_base, ib_must_override, ib_order_names
from test_safety_ast import ORDER_NAMES, PACKAGE, SKIP_DIRS, TERMINAL, WEB_SRC, WEB_SUFFIXES, scan_file

CLIENT_FILE = Path(ib_readonly_client.__file__).resolve()
FAKE_SERVER = Path(__file__).resolve().parent / "ib_fake_server.py"
IBAPI_ALLOWED = {CLIENT_FILE, FAKE_SERVER}
SAFETY_FILE = Path(__file__).resolve().parent / "test_safety_ast.py"  # holds the ban list itself
NAMES = frozenset(ib_order_names())


def python_files() -> list[Path]:
    found = []
    for folder, dirs, files in os.walk(TERMINAL):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        paths = [Path(folder) / f for f in files if f.endswith(".py")]
        found += [p for p in paths if p.resolve() != SAFETY_FILE.resolve()]
    return sorted(found)


def order_uses(source: str, allow_defs: bool) -> list[str]:
    """Every use of a banned name in `source`; a def of one is a use unless `allow_defs`."""
    problems = []
    tree = ast.parse(source)
    for node in ast.walk(tree):
        line = getattr(node, "lineno", 0)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in NAMES and not allow_defs:
            problems.append(f"{line}: def {node.name}")
        elif isinstance(node, ast.Attribute) and node.attr in NAMES:
            problems.append(f"{line}: attribute {node.attr}")
        elif isinstance(node, ast.Name) and node.id in NAMES:
            problems.append(f"{line}: name {node.id}")
        elif isinstance(node, ast.alias) and node.name.split(".")[-1] in NAMES:
            problems.append(f"{line}: import {node.name}")
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value in NAMES:
            problems.append(f"{line}: string {node.value}")
    return problems


def imports_ibapi(source: str) -> bool:
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import) and any(a.name.split(".")[0] == "ibapi" for a in node.names):
            return True
        if isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] == "ibapi":
            return True
    return False


class TestBornFailing:
    @pytest.mark.parametrize("template", [
        "client.{n}(1)",
        "{n}(1)",
        "from ibapi.client import {n}",
        "x = getattr(client, '{n}')",
        "handle = client.{n}",
        "def run(c):\n    return c.{n}()",
        "class A:\n    def {n}(self):\n        return 1",
    ])
    @pytest.mark.parametrize("name", sorted(NAMES))
    def test_a_banned_use_is_found(self, template: str, name: str):
        assert order_uses(template.format(n=name), allow_defs=False)

    def test_a_def_is_found_unless_defs_are_allowed(self):
        name = sorted(NAMES)[0]
        source = f"class A:\n    def {name}(self):\n        raise RuntimeError('no')\n"
        assert order_uses(source, allow_defs=False)
        assert order_uses(source, allow_defs=True) == []

    def test_an_ibapi_import_is_found(self):
        assert imports_ibapi("from ibapi.client import EClient")
        assert imports_ibapi("import ibapi.wrapper")
        assert not imports_ibapi("import numpy")


class TestAllowedLookAlikes:
    @pytest.mark.parametrize("snippet", [
        "client.reqAllOpenOrders()",
        "client.reqAccountSummary(1, 'All', 'NetLiquidation')",
        "client.reqPositions()",
        "client.reqExecutions(1, None)",
        "client.reqCurrentTime()",
        "client.cancelPositions()",
        "client.cancelAccountSummary(1)",
        "open_orders = []",
        "place = 1",
    ])
    def test_the_read_only_calls_are_not_flagged(self, snippet: str):
        assert order_uses(snippet, allow_defs=False) == []


class TestRealTree:
    def test_no_banned_name_is_used_anywhere_in_terminal_python(self):
        problems = {}
        for path in python_files():
            found = order_uses(path.read_text(encoding="utf-8"), allow_defs=path.resolve() == CLIENT_FILE)
            if found:
                problems[path.relative_to(TERMINAL).as_posix()] = found
        assert problems == {}

    def test_no_banned_name_is_in_the_web_sources(self):
        problems = []
        for path in WEB_SRC.rglob("*"):
            if path.suffix in WEB_SUFFIXES and not SKIP_DIRS & set(path.parts):
                text = path.read_text(encoding="utf-8")
                problems += [f"{path.name}: {name}" for name in NAMES if name in text]
        assert problems == []

    def test_the_library_is_imported_by_the_client_and_the_fake_server_only(self):
        importers = {p.resolve() for p in python_files() if imports_ibapi(p.read_text(encoding="utf-8"))}
        assert importers == IBAPI_ALLOWED

    def test_the_other_safety_rules_pass_on_the_new_ib_files(self):
        # The safety scan bans the library import outright until the merge step sanctions the client file; every
        # other rule (writes, gate, dynamic imports, order names) must already be clean.
        new = [CLIENT_FILE, *(CLIENT_FILE.parents[1] / n for n in ("services/ib_snapshot.py", "api/ib.py",
                                                                    "models/ib.py"))]
        rules = {v.rule for path in new for v in scan_file(path, "prod")}
        assert rules <= {"ib_client"}

    def test_the_service_and_the_router_do_not_import_the_library(self):
        for name in ("services/ib_snapshot.py", "api/ib.py", "models/ib.py"):
            path = CLIENT_FILE.parents[1] / name
            assert not imports_ibapi(path.read_text(encoding="utf-8")), name


class TestClientClass:
    def test_every_order_style_call_of_the_library_is_overridden_on_the_class_itself(self):
        base = ib_client_base()
        assert len(NAMES) == 12  # the six calls and their six ProtoBuf twins
        for name in NAMES:
            assert name in vars(ReadOnlyClient), f"{name} is inherited, not overridden"
            assert vars(ReadOnlyClient)[name] is not vars(base)[name]

    def test_the_set_to_override_comes_from_the_library_and_the_ban_list_covers_it(self):
        derived = set(ib_must_override())
        assert derived <= NAMES
        assert derived <= ORDER_NAMES, f"add to the safety scan's ban list: {sorted(derived - ORDER_NAMES)}"
        assert all(name in vars(ReadOnlyClient) for name in derived)

    def test_every_override_is_a_bare_raise(self):
        tree = ast.parse(CLIENT_FILE.read_text(encoding="utf-8"))
        client = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "ReadOnlyClient")
        overrides = {n.name: n for n in client.body if isinstance(n, ast.FunctionDef) and n.name in NAMES}
        assert set(overrides) == NAMES
        for name, node in overrides.items():
            body = [s for s in node.body if not (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant))]
            assert len(body) == 1 and isinstance(body[0], ast.Raise), name
            raised = body[0].exc
            assert isinstance(raised, ast.Call) and getattr(raised.func, "id", None) == OrderPathError.__name__

    def test_the_sending_hooks_are_guarded(self):
        tree = ast.parse(CLIENT_FILE.read_text(encoding="utf-8"))
        client = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "ReadOnlyClient")
        hooks = {n.name: n for n in client.body if isinstance(n, ast.FunctionDef)}
        for hook in ("sendMsg", "sendMsgProtoBuf"):
            code = [s for s in hooks[hook].body if not (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant))]
            first = code[0]
            assert "check_outgoing" in ast.dump(first), hook


def test_the_fake_server_file_is_a_helper_and_not_a_test():
    assert textwrap.dedent(FAKE_SERVER.read_text(encoding="utf-8")).count("def test_") == 0


# ---------------------------------------------------------------------------------------------------------
# Library-derived override set: a method the library adds later must fail the test until it is reviewed.
# ---------------------------------------------------------------------------------------------------------
class TestMustOverrideIsDerivedFromTheLibrary:
    class FutureClient:
        def placeOrderV2(self): ...
        def cancelEverything(self): ...
        def reqOpenOrdersProtoBuf2(self): ...
        def exerciseFoo(self): ...
        def reqAllOpenOrders(self): ...
        def reqAllOpenOrdersProtoBuf(self): ...
        def reqCompletedOrders(self): ...
        def reqPositions(self): ...
        def cancelPositions(self): ...
        def cancelPositionsProtoBuf(self): ...
        def cancelMktData(self): ...
        def cancelMarketDataProtoBuf(self): ...
        def _private_order(self): ...

    def test_a_new_order_cancel_or_exercise_method_is_in_the_set(self):
        found = ib_must_override(self.FutureClient)
        assert found == ["cancelEverything", "exerciseFoo", "placeOrderV2", "reqOpenOrdersProtoBuf2"]

    def test_the_reviewed_read_calls_and_their_twins_are_not_in_the_set(self):
        found = set(ib_must_override(self.FutureClient))
        assert not found & {"reqAllOpenOrders", "reqAllOpenOrdersProtoBuf", "reqCompletedOrders", "reqPositions",
                            "cancelPositions", "cancelPositionsProtoBuf", "cancelMktData", "cancelMarketDataProtoBuf"}

    def test_the_real_library_class_yields_the_six_calls_and_their_protobuf_twins(self):
        names = ib_must_override()
        assert len(names) == 12
        assert sum(n.endswith("ProtoBuf") for n in names) == 6


# ---------------------------------------------------------------------------------------------------------
# Bypass shapes the name ban cannot see (ib_bypass_scan.py).
# ---------------------------------------------------------------------------------------------------------
CLIENT_AT = "backend/nq_terminal/services/ib_readonly_client.py"
OTHER_AT = "backend/nq_terminal/services/ib_snapshot.py"
IB_HEAD = "from ibapi.client import EClient\n"
PROTO_NAME = next(n for n in sorted(NAMES) if n.endswith("ProtoBuf"))
OUT_HEAD = "from ibapi.message import OUT\n"
GUARDED_CLASS = "class ReadOnlyClient(EClient):\n"
MAIN_AT = "backend/nq_terminal/__main__.py"
DESKTOP_AT = "backend/nq_terminal/desktop/lock.py"
MAIN_BIND = ("import socket\ns = socket.socket(socket.AF_INET, socket.SOCK_STREAM)\n"
             "s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)\ns.bind(('127.0.0.1', 0))\n"
             "s.getsockname()")


def bypass(rule: str, snippet: str, where: str = OTHER_AT):
    return pytest.param(rule, where, snippet)


BYPASS_CASES = [
    # a name built at run time, in a module that touches the library
    bypass("dynamic_attr", IB_HEAD + "def f(c):\n    return getattr(c, 'place' + 'Order')(1)"),
    bypass("dynamic_attr", IB_HEAD + "def f(c):\n    return getattr(c, ''.join(['place', 'Order']))(1)"),
    bypass("dynamic_attr", IB_HEAD + "def f(c):\n    return getattr(c, 'redrOecalp'[::-1])(1)"),
    bypass("dynamic_attr", IB_HEAD + "def f(c, name):\n    return getattr(c, name)()"),
    bypass("dynamic_attr", IB_HEAD + "def f(c, name, fn):\n    setattr(c, name, fn)"),
    bypass("dynamic_attr", IB_HEAD + "import operator\ndef f(c, name):\n    return operator.attrgetter(name)(c)"),
    bypass("dynamic_attr", IB_HEAD + "from operator import methodcaller\ndef f(c, name):\n    return methodcaller(name)(c)"),
    bypass("dynamic_attr", IB_HEAD + "def f(c):\n    return getattr(c, 'conn')"),
    bypass("dynamic_attr", IB_HEAD + "import operator\ndef f(c):\n    return operator.attrgetter('conn.sendMsg')(c)"),
    bypass("dynamic_attr", IB_HEAD + "def f(c):\n    return c.__dict__['x']"),
    bypass("dynamic_attr", IB_HEAD + "def f(c):\n    return c.__getattribute__('x')"),
    bypass("dynamic_attr", IB_HEAD + "def f(c):\n    return vars(c)"),
    bypass("dynamic_attr", "from nq_terminal.services import ib_readonly_client\ndef f(c, n):\n    return getattr(c, n)"),
    bypass("dynamic_attr", "from .ib_readonly_client import fetch_raw\ndef f(c, n):\n    return getattr(c, n)"),
    # raw sends and the raw connection
    bypass("raw_send", IB_HEAD + "def f(c, m):\n    return c.conn.sendMsg(m)"),
    bypass("raw_send", IB_HEAD + "def f(c, m):\n    return c.conn.socket.send(m)"),
    bypass("raw_send", IB_HEAD + "def f(c):\n    return c.conn"),
    bypass("raw_send", "def f(c, m):\n    c.sendMsg(1, m)"),
    bypass("raw_send", "def f(c, m):\n    c.sendMsgProtoBuf(1, m)"),
    bypass("raw_send", IB_HEAD + "def f(c, m):\n    EClient.sendMsg(c, 1, m)"),
    bypass("raw_send", "from ibapi.client import sendMsg"),
    bypass("raw_send", "class Other:\n    def sendMsg(self, msg_id, msg):\n        return None"),
    bypass("raw_send", "class ReadOnlyClient:\n    def sendMsg(self, msg_id, msg):\n        return None"),
    bypass("raw_send", IB_HEAD + GUARDED_CLASS + "    def sendMsg(self, msg_id, msg):\n"
           "        return super().sendMsg(msg_id, msg)", where=OTHER_AT),
    bypass("raw_send", IB_HEAD + GUARDED_CLASS + "    def other(self, msg_id, msg):\n"
           "        return super().sendMsg(msg_id, msg)", where=CLIENT_AT),
    bypass("raw_send", IB_HEAD + GUARDED_CLASS + "    def sendMsg(self, msg_id, msg):\n"
           "        return EClient.sendMsg(self, msg_id, msg)", where=CLIENT_AT),
    # a message id for an order, chosen by name
    bypass("out_id", OUT_HEAD + "def f(c, m):\n    c.sendMsg(OUT.PLACE_ORDER, m)"),
    bypass("out_id", OUT_HEAD + "X = OUT.PLACE_ORDER"),
    bypass("out_id", OUT_HEAD + "X = OUT.CANCEL_ORDER", where=CLIENT_AT),
    bypass("out_id", OUT_HEAD + "X = OUT.REQ_GLOBAL_CANCEL"),
    bypass("out_id", OUT_HEAD + "X = OUT.EXERCISE_OPTIONS"),
    bypass("out_id", "from ibapi.message import OUT as O\nX = O.PLACE_ORDER"),
    bypass("out_id", "import ibapi.message\nX = ibapi.message.OUT.PLACE_ORDER"),
    bypass("out_id", "import ibapi.message as m\nX = m.OUT.PLACE_ORDER"),
    bypass("out_id", "from .ib_readonly_client import OUT\nX = OUT.PLACE_ORDER"),
    bypass("out_id", OUT_HEAD + "X = getattr(OUT, 'PLACE_ORDER')"),
    bypass("out_id", OUT_HEAD + "def f(name):\n    return getattr(OUT, name)"),
    bypass("out_id", OUT_HEAD + "X = vars(OUT)"),
    bypass("out_id", OUT_HEAD + "X = OUT"),
    # a raw network path, or the library's own connection layer
    bypass("import", "import socket"),
    bypass("import", "import socket as s\ns.create_connection(('127.0.0.1', 7497))"),
    bypass("import", "from socket import create_connection"),
    bypass("import", "import ssl"),
    # the one sanction (__main__.py binds the loopback socket) is narrow: nowhere else, and never to connect or send
    bypass("import", MAIN_BIND, where=DESKTOP_AT),
    bypass("import", MAIN_BIND, where=OTHER_AT),
    bypass("import", "import socket as s\ns.create_connection(('127.0.0.1', 7497))", where=MAIN_AT),
    bypass("import", "import socket\nsocket.create_connection(('127.0.0.1', 7497))", where=MAIN_AT),
    bypass("import", "import socket\ns = socket.socket()\ns.connect(('127.0.0.1', 7497))", where=MAIN_AT),
    bypass("import", "import socket\ns = socket.socket()\ns.sendall(b'x')", where=MAIN_AT),
    bypass("import", "from socket import socket", where=MAIN_AT),
    bypass("import", "import _socket", where=MAIN_AT),
    bypass("import", "import ssl", where=MAIN_AT),
    bypass("import", "import importlib\nm = importlib.import_module('socket')"),
    bypass("import", "m = __import__('ssl')"),
    bypass("import", "m = __import__('socket')", where=CLIENT_AT),
    bypass("import", "import socket", where=CLIENT_AT),
    bypass("import", "from ibapi.connection import Connection"),
    bypass("import", "from ibapi import connection"),
    bypass("import", "import ibapi.connection"),
    bypass("import", "from ibapi.comm import make_msg"),
    bypass("import", "from ibapi.client import *"),
    bypass("import", "from nq_terminal.services.ib_readonly_client import *"),
]

BYPASS_ALLOWED = [
    pytest.param(CLIENT_AT, "from ibapi.client import EClient\nfrom ibapi.common import PROTOBUF_MSG_ID\n"
                 "from ibapi.execution import ExecutionFilter\nfrom ibapi.message import OUT\n"
                 "from ibapi.wrapper import EWrapper", id="the client own imports"),
    pytest.param(CLIENT_AT, IB_HEAD + GUARDED_CLASS + "    def sendMsg(self, msg_id, msg):\n"
                 "        check_outgoing(msg_id)\n        return super().sendMsg(msg_id, msg)\n"
                 "    def sendMsgProtoBuf(self, msg_id, msg):\n        check_outgoing(msg_id)\n"
                 "        return super().sendMsgProtoBuf(msg_id, msg)", id="the two guarded overrides"),
    pytest.param(OTHER_AT, OUT_HEAD + "IDS = {OUT.START_API, OUT.REQ_POSITIONS, OUT.REQ_ALL_OPEN_ORDERS}",
                 id="allowed message ids"),
    pytest.param(OTHER_AT, OUT_HEAD + "X = getattr(OUT, 'START_API')", id="getattr on an allowed id"),
    pytest.param(OTHER_AT, IB_HEAD + "def f(state):\n    return getattr(state, 'ib_snapshot', None)",
                 id="a literal harmless getattr"),
    pytest.param(OTHER_AT, "def f(obj, name):\n    return getattr(obj, name)", id="dynamic getattr, no ib module"),
    pytest.param(OTHER_AT, "def f(conn):\n    return conn.cursor()", id="a plain conn name"),
    pytest.param(OTHER_AT, "import threading\nimport time\nimport math", id="harmless imports"),
    pytest.param(MAIN_AT, MAIN_BIND, id="the loopback bind of the start-up file"),
    pytest.param(OTHER_AT, "def f(c):\n    return c.reqAllOpenOrders()", id="the read request"),
]


class TestBypassShapes:
    @pytest.mark.parametrize(("rule", "where", "snippet"), BYPASS_CASES)
    def test_a_bypass_shape_is_found(self, rule: str, where: str, snippet: str):
        found = ib_bypass_uses(textwrap.dedent(snippet), where)
        assert rule in {f.rule for f in found}, f"[{rule}] not flagged:\n{snippet}\nfound: {found}"

    @pytest.mark.parametrize(("where", "snippet"), BYPASS_ALLOWED)
    def test_the_allowed_look_alikes_are_not_flagged(self, where: str, snippet: str):
        assert ib_bypass_uses(textwrap.dedent(snippet), where) == []

    def test_the_protobuf_order_call_by_name_is_found_by_the_name_ban(self):
        assert order_uses(f"def f(c, p):\n    c.{PROTO_NAME}(p)", allow_defs=False)

    def test_the_protobuf_twins_are_on_the_ban_list_and_every_rule_has_cases(self):
        assert sum(n.endswith("ProtoBuf") for n in ORDER_NAMES) == 6
        assert {case.values[0] for case in BYPASS_CASES} == {"dynamic_attr", "raw_send", "out_id", "import"}

    def test_the_allowed_message_ids_are_the_eight_documented_requests(self):
        assert ALLOWED_OUT_NAMES == {"START_API", "REQ_CURRENT_TIME", "REQ_ACCOUNT_SUMMARY", "CANCEL_ACCOUNT_SUMMARY",
                                     "REQ_POSITIONS", "CANCEL_POSITIONS", "REQ_ALL_OPEN_ORDERS", "REQ_EXECUTIONS"}

    def test_the_real_production_tree_has_no_bypass_shape(self):
        problems = {}
        for path in sorted(PACKAGE.rglob("*.py")):
            if SKIP_DIRS & set(path.parts):
                continue
            where = path.resolve().relative_to(TERMINAL.resolve()).as_posix()
            found = ib_bypass_uses(path.read_text(encoding="utf-8"), where)
            if found:
                problems[where] = [str(f) for f in found]
        assert problems == {}

"""Global window and foreground watch.

Every 100 ms: EnumWindows over ALL processes, plus GetForegroundWindow. Any top-level window that is visible now
and was not visible at the start (a "new" window), and any change of the foreground window, is written as one JSON
line to stdout (the Node parent keeps them in the raw file). A WinEvent hook (EVENT_OBJECT_SHOW, EVENT_SYSTEM_FOREGROUND) catches changes shorter than one tick.
Cloaked windows (other virtual desktops, suspended app windows) and zero-size windows do not count as shown.
Each line carries "chain": the owner process and its ancestors, nearest first, read from a process snapshot when the event
fires, so winwatch.mjs can tell the run's own app tree from other programs (an owner already gone has an empty chain).

Protocol (stdout): first line {"type":"ready", ...baseline}; events as they happen; on stdin EOF a last {"type":"summary"} line.
Python is the nq-lab venv python.exe. Nothing here writes a file: the parent process captures stdout.
"""
import argparse, ctypes, json, sys, threading, time
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
dwmapi = ctypes.WinDLL("dwmapi", use_last_error=True)

WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
WINEVENTPROC = ctypes.WINFUNCTYPE(None, wintypes.HANDLE, wintypes.DWORD, wintypes.HWND, wintypes.LONG, wintypes.LONG, wintypes.DWORD, wintypes.DWORD)
user32.EnumWindows.argtypes = [WNDENUMPROC, wintypes.LPARAM]
user32.GetForegroundWindow.restype = wintypes.HWND
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.GetParent.argtypes = [wintypes.HWND]
user32.GetParent.restype = wintypes.HWND
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
user32.GetWindowLongW.restype = wintypes.LONG
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.SetWinEventHook.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.HMODULE, WINEVENTPROC, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD]
user32.SetWinEventHook.restype = wintypes.HANDLE
user32.PeekMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT, wintypes.UINT]
kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel32.OpenProcess.restype = wintypes.HANDLE
kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
dwmapi.DwmGetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]

EVENT_SYSTEM_FOREGROUND = 0x0003
EVENT_OBJECT_SHOW = 0x8002
WINEVENT_OUTOFCONTEXT = 0x0000
OBJID_WINDOW = 0
DWMWA_CLOAKED = 14
PM_REMOVE = 1
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
GWL_STYLE = -16
WS_CHILD = 0x40000000
TH32CS_SNAPPROCESS = 0x00000002
INVALID_HANDLE_VALUE = wintypes.HANDLE(-1).value
ANCESTRY_DEPTH = 8


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
                ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", wintypes.LONG), ("dwFlags", wintypes.DWORD),
                ("szExeFile", wintypes.WCHAR * 260)]


kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]


def hv(h):
    return int(h) if h else 0


def shown(hwnd):
    """Visible, not cloaked, non-empty, top level. Owned popups (dialogs, message boxes) are top level and count:
    GetParent returns the owner for them, so the test is the WS_CHILD style, not GetParent."""
    if not user32.IsWindowVisible(hwnd) or (user32.GetWindowLongW(hwnd, GWL_STYLE) & WS_CHILD):
        return False
    cloaked = wintypes.DWORD(0)
    dwmapi.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, ctypes.byref(cloaked), 4)
    if cloaked.value:
        return False
    r = wintypes.RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(r)):
        return False
    return (r.right - r.left) > 0 and (r.bottom - r.top) > 0


def describe(hwnd):
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    cls = buf.value
    user32.GetWindowTextW(hwnd, buf, 256)
    title = buf.value
    pid = wintypes.DWORD(0)
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    exe = ""
    h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
    if h:
        n = wintypes.DWORD(520)
        pbuf = ctypes.create_unicode_buffer(520)
        if kernel32.QueryFullProcessImageNameW(h, 0, pbuf, ctypes.byref(n)):
            exe = pbuf.value.rsplit("\\", 1)[-1]
        kernel32.CloseHandle(h)
    r = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    return {"hwnd": hv(hwnd), "pid": pid.value, "exe": exe, "cls": cls, "title": title[:120], "rect": [r.left, r.top, r.right, r.bottom],
            "style": hex(user32.GetWindowLongW(hwnd, -16) & 0xFFFFFFFF), "exstyle": hex(user32.GetWindowLongW(hwnd, -20) & 0xFFFFFFFF)}


def process_table():
    """pid -> (parent pid, exe name) of every process, from one Toolhelp snapshot; empty when the snapshot fails."""
    table = {}
    snap = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if not snap or snap == INVALID_HANDLE_VALUE:
        return table
    try:
        entry = PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
        more = kernel32.Process32FirstW(snap, ctypes.byref(entry))
        while more:
            table[entry.th32ProcessID] = (entry.th32ParentProcessID, entry.szExeFile)
            more = kernel32.Process32NextW(snap, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snap)
    return table


def ancestry(pid):
    """The process and its ancestors, nearest first, at most ANCESTRY_DEPTH links; empty when the process is gone."""
    table = process_table()
    links, seen = [], set()
    while pid and pid in table and pid not in seen and len(links) < ANCESTRY_DEPTH:
        seen.add(pid)
        parent, exe = table[pid]
        links.append({"pid": pid, "exe": exe})
        pid = parent
    return links


# A window nobody can see: a layered, click-through, no-activate tool window of at most 5 by 5 pixels. Tao (the event
# loop under Tauri) creates one at start, class "Tao Thread Event Target". It is recorded as inert and does not fail a run.
INERT_EX = 0x00080000 | 0x00000020 | 0x08000000 | 0x00000080  # LAYERED | TRANSPARENT | NOACTIVATE | TOOLWINDOW


def is_inert(info):
    left, top, right, bottom = info["rect"]
    ex = int(info["exstyle"], 16)
    return (right - left) <= 5 and (bottom - top) <= 5 and (ex & INERT_EX) == INERT_EX


def enum_shown():
    found = set()

    def cb(hwnd, _lp):
        if shown(hwnd):
            found.add(hv(hwnd))
        return True

    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval-ms", type=int, default=100)
    args = ap.parse_args()
    t_start = time.perf_counter()

    def emit(obj):
        obj["t"] = round(time.time(), 3)
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()

    baseline = enum_shown()
    base_fg = hv(user32.GetForegroundWindow())
    seen = set(baseline)
    state = {"fg": base_fg, "ticks": 0, "max_gap_ms": 0.0, "hook_events": 0}
    stop = threading.Event()
    threading.Thread(target=lambda: (sys.stdin.read(), stop.set()), daemon=True).start()

    def check_new(hwnd, via):
        h = hv(hwnd)
        if h in seen or not shown(hwnd):
            return
        seen.add(h)
        info = describe(hwnd)
        emit({"type": "inert_window" if is_inert(info) else "new_window", "via": via, **info, "chain": ancestry(info["pid"])})

    def check_fg(via):
        cur = hv(user32.GetForegroundWindow())
        if cur != state["fg"]:
            info = describe(cur) if cur else {}
            chain = ancestry(info["pid"]) if info.get("pid") else []
            emit({"type": "foreground", "via": via, "from": state["fg"], "to": cur, **{k: info.get(k) for k in ("pid", "exe", "cls", "title")}, "chain": chain})
            state["fg"] = cur

    def on_event(_hook, event, hwnd, id_object, _id_child, _thread, _time):
        state["hook_events"] += 1
        if event == EVENT_OBJECT_SHOW and id_object == OBJID_WINDOW and hwnd:
            check_new(hwnd, "show-event")
        elif event == EVENT_SYSTEM_FOREGROUND:
            check_fg("foreground-event")

    proc = WINEVENTPROC(on_event)
    hooks = [user32.SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, proc, 0, 0, WINEVENT_OUTOFCONTEXT),
             user32.SetWinEventHook(EVENT_OBJECT_SHOW, EVENT_OBJECT_SHOW, None, proc, 0, 0, WINEVENT_OUTOFCONTEXT)]
    emit({"type": "ready", "baseline_windows": len(baseline), "baseline_foreground": base_fg, "hooks": [bool(h) for h in hooks], "interval_ms": args.interval_ms})

    interval = args.interval_ms / 1000.0
    last = time.perf_counter()
    msg = wintypes.MSG()
    while not stop.is_set():
        tick0 = time.perf_counter()
        while user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, PM_REMOVE):  # delivers the WinEvent callbacks
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))
        for h in enum_shown() - seen:
            check_new(h, "enum")
        check_fg("poll")
        state["ticks"] += 1
        state["max_gap_ms"] = max(state["max_gap_ms"], (tick0 - last) * 1000)
        last = tick0
        time.sleep(max(0.0, interval - (time.perf_counter() - tick0)))
    emit({"type": "summary", "ticks": state["ticks"], "max_gap_ms": round(state["max_gap_ms"], 1), "hook_events": state["hook_events"],
          "seconds": round(time.perf_counter() - t_start, 2)})
    for h in hooks:
        if h:
            user32.UnhookWinEvent(h)


if __name__ == "__main__":
    main()

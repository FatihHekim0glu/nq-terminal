"""Window and monitor helper of the harness. Prints one JSON document to stdout; writes no file.

  monitors                          every monitor: primary flag, full rectangle, work area
  windows --pid N                   the top-level windows of process N (rectangle, DWM frame bounds, iconic, visible)
  foreground                        the foreground window (handle, pid)
  close --pid N                     WM_CLOSE to the windows of process N that are not the Tao event target
  show --pid N --hwnd H --cmd minimise|restore
                                    ShowWindow with SW_SHOWMINNOACTIVE or SW_SHOWNOACTIVATE (never an activating command)
  size --pid N --hwnd H --state minimized|restored
                                    a WM_SIZE message to the window (the message only: the window itself is not changed)

Every action on a window checks that the window belongs to the process named by --pid: the harness only ever touches the
windows of the shell it started. Python is the nq-lab venv python.exe.
"""
import argparse, ctypes, json, sys
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)
dwmapi = ctypes.WinDLL("dwmapi", use_last_error=True)

WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
MONITORENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HANDLE, wintypes.HDC, ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)
user32.EnumWindows.argtypes = [WNDENUMPROC, wintypes.LPARAM]
user32.EnumDisplayMonitors.argtypes = [wintypes.HDC, ctypes.POINTER(wintypes.RECT), MONITORENUMPROC, wintypes.LPARAM]
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.IsIconic.argtypes = [wintypes.HWND]
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.SendMessageW.restype = wintypes.LPARAM
user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
user32.GetWindowLongW.restype = wintypes.LONG
user32.GetForegroundWindow.restype = wintypes.HWND
dwmapi.DwmGetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]

DWMWA_EXTENDED_FRAME_BOUNDS = 9
DWMWA_CLOAKED = 14
WM_CLOSE = 0x0010
WM_SIZE = 0x0005
SIZE_RESTORED = 0
SIZE_MINIMIZED = 1
SW_SHOWNOACTIVATE = 4
SW_SHOWMINNOACTIVE = 7
MONITORINFOF_PRIMARY = 1
TAO_CLASS = "Tao Thread Event Target"


class MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]


user32.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MONITORINFO)]


def rect_list(r):
    return [r.left, r.top, r.right, r.bottom]


def monitors():
    found = []

    def cb(handle, _dc, _rect, _lp):
        info = MONITORINFO()
        info.cbSize = ctypes.sizeof(MONITORINFO)
        if user32.GetMonitorInfoW(handle, ctypes.byref(info)):
            found.append({"primary": bool(info.dwFlags & MONITORINFOF_PRIMARY), "rect": rect_list(info.rcMonitor), "work": rect_list(info.rcWork)})
        return True

    user32.EnumDisplayMonitors(None, None, MONITORENUMPROC(cb), 0)
    return found


def text_of(fn, hwnd):
    buf = ctypes.create_unicode_buffer(256)
    fn(hwnd, buf, 256)
    return buf.value


def pid_of(hwnd):
    pid = wintypes.DWORD(0)
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return pid.value


def describe(hwnd):
    r = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    frame = wintypes.RECT()
    has_frame = dwmapi.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, ctypes.byref(frame), ctypes.sizeof(frame)) == 0
    cloaked = wintypes.DWORD(0)
    dwmapi.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, ctypes.byref(cloaked), 4)
    return {"hwnd": int(hwnd or 0), "pid": pid_of(hwnd), "cls": text_of(user32.GetClassNameW, hwnd), "title": text_of(user32.GetWindowTextW, hwnd)[:120],
            "rect": rect_list(r), "frame": rect_list(frame) if has_frame else None, "visible": bool(user32.IsWindowVisible(hwnd)),
            "iconic": bool(user32.IsIconic(hwnd)), "cloaked": bool(cloaked.value), "style": hex(user32.GetWindowLongW(hwnd, -16) & 0xFFFFFFFF),
            "exstyle": hex(user32.GetWindowLongW(hwnd, -20) & 0xFFFFFFFF)}


def windows_of(pid):
    found = []

    def cb(hwnd, _lp):
        if pid_of(hwnd) == pid:
            found.append(describe(hwnd))
        return True

    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return found


def owned_window(pid, hwnd):
    """The window, only when it belongs to process `pid`; anything else is refused."""
    if pid_of(hwnd) != pid:
        raise SystemExit(f"refused: window {hwnd} does not belong to process {pid}")
    return hwnd


def do_close(pid):
    sent = []
    for w in windows_of(pid):
        if w["cls"] != TAO_CLASS:
            user32.PostMessageW(w["hwnd"], WM_CLOSE, 0, 0)
            sent.append(w["hwnd"])
    return {"closed": sent}


def do_show(pid, hwnd, cmd):
    owned_window(pid, hwnd)
    code = {"minimise": SW_SHOWMINNOACTIVE, "restore": SW_SHOWNOACTIVATE}[cmd]
    user32.ShowWindow(hwnd, code)
    return {"hwnd": hwnd, "cmd": cmd, "code": code}


def do_size(pid, hwnd, state):
    owned_window(pid, hwnd)
    r = wintypes.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(r))
    lparam = ((r.bottom - r.top) << 16) | (r.right - r.left)
    wparam = SIZE_MINIMIZED if state == "minimized" else SIZE_RESTORED
    user32.SendMessageW(hwnd, WM_SIZE, wparam, lparam)
    return {"hwnd": hwnd, "state": state}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["monitors", "windows", "foreground", "close", "show", "size"])
    ap.add_argument("--pid", type=int)
    ap.add_argument("--hwnd", type=int)
    ap.add_argument("--cmd", choices=["minimise", "restore"])
    ap.add_argument("--state", choices=["minimized", "restored"])
    a = ap.parse_args()
    if a.action == "monitors":
        out = monitors()
    elif a.action == "foreground":
        h = user32.GetForegroundWindow()
        out = {"hwnd": int(h or 0), "pid": pid_of(h) if h else 0}
    elif a.pid is None:
        raise SystemExit("--pid is required")
    elif a.action == "windows":
        out = windows_of(a.pid)
    elif a.action == "close":
        out = do_close(a.pid)
    elif a.action == "show":
        out = do_show(a.pid, a.hwnd, a.cmd)
    else:
        out = do_size(a.pid, a.hwnd, a.state)
    sys.stdout.write(json.dumps(out) + "\n")


if __name__ == "__main__":
    main()

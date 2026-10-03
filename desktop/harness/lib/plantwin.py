"""Self-test helper: one small no-activate tool window on screen 2 (X=-1080, Y=228) for about 1.5 s, then destroyed.
It proves the global window watch detects a new visible top-level window. It never takes focus.
With --owned the window is an OWNED popup (like a dialog or message box): a hidden owner is created and never shown, and the
popup is shown with SW_SHOWNOACTIVATE. GetParent returns the owner for such a window, so the watch must still detect it."""
import ctypes, sys, time
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                   wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID]
user32.CreateWindowExW.restype = wintypes.HWND
user32.PeekMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT, wintypes.UINT]
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.DestroyWindow.argtypes = [wintypes.HWND]

WS_POPUP = 0x80000000
WS_EX_TOOLWINDOW = 0x80
WS_EX_NOACTIVATE = 0x08000000
SW_SHOWNOACTIVATE = 4

owned = "--owned" in sys.argv[1:]
owner = None
if owned:
    owner = user32.CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, "STATIC", "t2 plant owner", WS_POPUP, -1080, 228, 120, 80, None, None, None, None)
    if not owner:
        raise SystemExit("could not create the hidden owner window")
hwnd = user32.CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, "STATIC", "t2 plant owned" if owned else "t2 plant", WS_POPUP, -1080, 228, 120, 80,
                              owner, None, None, None)
if not hwnd:
    raise SystemExit("could not create the planted window")
user32.ShowWindow(hwnd, SW_SHOWNOACTIVATE)
msg = wintypes.MSG()
end = time.time() + 1.5
while time.time() < end:
    while user32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 1):
        user32.TranslateMessage(ctypes.byref(msg))
        user32.DispatchMessageW(ctypes.byref(msg))
    time.sleep(0.02)
user32.DestroyWindow(hwnd)
if owner:
    user32.DestroyWindow(owner)
print("planted window shown and destroyed")

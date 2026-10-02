"""pywebview host (EdgeChromium = WebView2): one HIDDEN window, CDP on a spare port.
argv: url cdp_port storage [force_visible]
force_visible=1 sets the controller's IsVisible=true on the hidden form (reflection on the WinForms control);
no window is shown, only the page's visibility state changes."""
import sys, time
import webview
url, cdp_port, storage = sys.argv[1], int(sys.argv[2]), sys.argv[3]
force_visible = len(sys.argv) > 4 and sys.argv[4] == "1"
webview.settings["REMOTE_DEBUGGING_PORT"] = cdp_port

def make_visible(window):
    if not force_visible:
        return
    from webview.platforms.winforms import BrowserView
    from System import Action
    from System.Reflection import BindingFlags
    while window.uid not in BrowserView.instances:
        time.sleep(0.05)
    bf = BrowserView.instances[window.uid]
    wv = bf.browser.webview
    field = wv.GetType().GetField("_coreWebView2Controller", BindingFlags.NonPublic | BindingFlags.Instance)
    ctrl = None
    for _ in range(400):
        ctrl = field.GetValue(wv)
        if ctrl is not None:
            break
        time.sleep(0.05)
    def flip():
        ctrl.IsVisible = True
        print("IsVisible forced", ctrl.IsVisible, flush=True)
    bf.Invoke(Action(flip))

w = webview.create_window("nq-lab spike", url, width=1600, height=900, hidden=True)
webview.start(make_visible, w, gui="edgechromium", debug=False, private_mode=False, storage_path=storage)

# The global window and foreground watch of the desktop end-to-end project (04 standing rule 4). It starts a native loop
# that lists every top-level window of every process every 100 ms, plus the foreground window, and prints one JSON line
# per event: `ready` once the baseline is taken, `new` for a window that was not visible at the start, `foreground` for
# a change of the foreground window, and `done` (with the sample count and the longest gap) when a line arrives on
# standard input. watch.ts judges the lines. It reads and reports; it never changes a window.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class NqtWatch {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] static extern bool GetLayeredWindowAttributes(IntPtr h, out uint key, out byte alpha, out uint flags);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out int value, int size);

  const int GWL_EXSTYLE = -20;
  const int WS_EX_LAYERED = 0x80000;
  const int DWMWA_CLOAKED = 14;
  static volatile bool stop = false;

  static string Esc(string s) {
    var b = new StringBuilder();
    foreach (char c in s) {
      if (c == '"' || c == '\\') { b.Append('\\').Append(c); }
      else if (c < 32) { b.Append(' '); }
      else { b.Append(c); }
    }
    return b.ToString();
  }

  static HashSet<long> Visible() {
    var set = new HashSet<long>();
    EnumWindows((h, l) => { if (IsWindowVisible(h)) set.Add(h.ToInt64()); return true; }, IntPtr.Zero);
    return set;
  }

  static string Describe(long handle) {
    var h = new IntPtr(handle);
    uint pid; GetWindowThreadProcessId(h, out pid);
    var cls = new StringBuilder(256); GetClassNameW(h, cls, 256);
    var title = new StringBuilder(256); GetWindowTextW(h, title, 256);
    RECT r; GetWindowRect(h, out r);
    int cloaked; DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4);
    bool layered = (GetWindowLong(h, GWL_EXSTYLE) & WS_EX_LAYERED) != 0;
    uint key, flags; byte alpha = 0;
    bool attrs = layered && GetLayeredWindowAttributes(h, out key, out alpha, out flags);
    bool undrawnLayer = layered && (!attrs || alpha == 0);
    long area = (long)Math.Max(0, r.Right - r.Left) * Math.Max(0, r.Bottom - r.Top);
    bool drawn = IsWindowVisible(h) && cloaked == 0 && area > 0 && !undrawnLayer;
    string proc = "";
    try { proc = Process.GetProcessById((int)pid).ProcessName; } catch (Exception) { }
    return "\"pid\":" + pid + ",\"process\":\"" + Esc(proc) + "\",\"class\":\"" + Esc(cls.ToString()) + "\",\"title\":\"" + Esc(title.ToString())
      + "\",\"rect\":[" + r.Left + "," + r.Top + "," + r.Right + "," + r.Bottom + "],\"drawn\":" + (drawn ? "true" : "false");
  }

  static void Emit(string line) { Console.Out.WriteLine(line); Console.Out.Flush(); }

  public static void Run() {
    var baseline = Visible();
    long foreground = GetForegroundWindow().ToInt64();
    var seen = new HashSet<long>();
    var reader = new Thread(() => { Console.In.ReadLine(); stop = true; });
    reader.IsBackground = true; reader.Start();
    Emit("{\"event\":\"ready\"," + Describe(foreground == 0 ? 0 : foreground) + "}");
    long samples = 0, maxGap = 0;
    var clock = Stopwatch.StartNew(); long last = 0;
    while (!stop) {
      foreach (long h in Visible()) {
        if (!baseline.Contains(h) && seen.Add(h)) Emit("{\"event\":\"new\"," + Describe(h) + "}");
      }
      long now = GetForegroundWindow().ToInt64();
      if (now != foreground) { foreground = now; Emit("{\"event\":\"foreground\"," + Describe(now) + "}"); }
      samples++;
      long t = clock.ElapsedMilliseconds; maxGap = Math.Max(maxGap, t - last); last = t;
      Thread.Sleep(100);
    }
    Emit("{\"event\":\"done\",\"samples\":" + samples + ",\"maxGapMs\":" + maxGap + "}");
  }
}
'@
[NqtWatch]::Run()

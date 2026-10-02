#!/bin/bash
R=D:/dev/spikes/results
echo "START $(date -Iseconds)"
for i in 1 2 3 4 5; do
  node D:/dev/spikes/tauri-shell/drive/drive.mjs tauri $i $R/webview 
  node D:/dev/spikes/tauri-shell/drive/drive.mjs edge $i $R/webview
done
echo "WEBVIEW DONE $(date -Iseconds)"
for i in 1 2 3 4 5; do
  for m in both chart chart-dec table; do
    (cd D:/dev/spikes/native-egui && node run.mjs $m $i $R/egui --offscreen)
  done
  (cd D:/dev/spikes/native-egui && node run.mjs both $i $R/egui-window)
done
echo "ALL DONE $(date -Iseconds)"

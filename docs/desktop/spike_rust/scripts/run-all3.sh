#!/bin/bash
R=D:/dev/spikes/results
cd D:/dev/spikes/native-egui
echo "START3 $(date -Iseconds)"
for i in 1 2 3 4 5 6 7 8; do
  echo "gpu_before $(nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader)"
  node run.mjs both-dec $((10+i)) $R/egui --offscreen
  echo "gpu_after $(nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader)"
done
echo "ALL DONE3 $(date -Iseconds)"

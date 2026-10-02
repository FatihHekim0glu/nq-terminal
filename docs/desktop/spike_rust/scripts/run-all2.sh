#!/bin/bash
R=D:/dev/spikes/results
cd D:/dev/spikes/native-egui
echo "START2 $(date -Iseconds)"
for i in 1 2 3 4 5; do node run.mjs both-dec $i $R/egui --offscreen; done
for i in 1 2 3; do WGPU_BACKEND=dx12 node run.mjs both-dec $i $R/egui-dx12 --offscreen; done
for i in 1 2 3; do WGPU_BACKEND=dx12 node run.mjs both-dec $i $R/egui-window-dx12; done
for i in 1 2 3; do WGPU_BACKEND=vulkan node run.mjs both-dec $i $R/egui-window-vk; done
echo "ALL DONE2 $(date -Iseconds)"

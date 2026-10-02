
### tauri: 5 runs
| metric | median | min to max | all runs |
|---|---|---|---|
| spawn to HOME ready (ms) | 1960 | 1590 to 3089 | 2070, 3089, 1590, 1743, 1960 |
| navigation start after spawn (ms) | 314 | 286 to 428 | 428, 331, 286, 310, 314 |
| HOME frame mark from nav start (ms) | 213 | 166 to 469 | 270, 469, 178, 166, 213 |
| HOME ready from nav start (ms) | 1642 | 1304 to 2758 | 1642, 2758, 1304, 1434, 1646 |
| first contentful paint from nav start (ms) | 208 | 164 to 464 | 272, 464, 176, 164, 208 |
| milestone main after spawn (ms) | 23 | 16 to 49 | 49, 23, 16, 20, 31 |
| milestone setup after spawn (ms) | 35 | 25 to 59 | 59, 35, 25, 29, 40 |
| milestone window_built after spawn (ms) | 318 | 292 to 435 | 435, 340, 292, 314, 318 |
| milestone page_started after spawn (ms) | 329 | 300 to 450 | 450, 351, 300, 321, 329 |
| milestone page_finished after spawn (ms) | 369 | 341 to 512 | 512, 399, 341, 361, 369 |
| private working set at open (HOME, idle 2.5 s) (MB) | 191 | 188 to 195 | 195, 193, 188, 191, 190 |
| working set (shared counted per process) at open (HOME, idle 2.5 s) (MB) | 479 | 478 to 487 | 487, 484, 478, 479, 478 |
| private bytes at open (HOME, idle 2.5 s) (MB) | 435 | 429 to 441 | 441, 429, 435, 435, 432 |
| process count at open (HOME, idle 2.5 s) | 7 | 7 to 7 | 7, 7, 7, 7, 7 |
| private working set after 8 screens + HOME, idle 3 s (MB) | 238 | 235 to 244 | 244, 238, 244, 238, 235 |
| working set (shared counted per process) after 8 screens + HOME, idle 3 s (MB) | 543 | 541 to 551 | 551, 543, 549, 541, 541 |
| private bytes after 8 screens + HOME, idle 3 s (MB) | 489 | 484 to 493 | 493, 489, 490, 487, 484 |
| process count after 8 screens + HOME, idle 3 s | 7 | 7 to 7 | 7, 7, 7, 7, 7 |

| screen | settle ms (median) | private MB after it (median) | runs ok |
|---|---|---|---|
| LEDG | 350 | 201 | 5 |
| OOS | 339 | 197 | 5 |
| NQ GP 1d | 620 | 203 | 5 |
| volmanaged_v0 EQ | 2330 | 221 | 5 |
| LIVE | 356 | 221 | 5 |
| 27F MON | 128 | 223 | 5 |
| REG | 1248 | 224 | 5 |
| HOME | 722 | 242 | 5 |

Total CPU % just before each run: [47, 54, 25, 33, 42]; after: [36, 63, 40, 35, 27]

### edge: 5 runs
| metric | median | min to max | all runs |
|---|---|---|---|
| spawn to HOME ready (ms) | 2437 | 2215 to 2568 | 2215, 2437, 2375, 2484, 2568 |
| navigation start after spawn (ms) | 386 | 316 to 411 | 378, 411, 395, 386, 316 |
| HOME frame mark from nav start (ms) | 398 | 346 to 461 | 346, 377, 423, 398, 461 |
| HOME ready from nav start (ms) | 2026 | 1837 to 2251 | 1837, 2026, 1980, 2098, 2251 |
| first contentful paint from nav start (ms) | 344 | 316 to 552 | 348, 344, 552, 316, 320 |
| private working set at open (HOME, idle 2.5 s) (MB) | 348 | 339 to 359 | 348, 358, 359, 342, 339 |
| working set (shared counted per process) at open (HOME, idle 2.5 s) (MB) | 993 | 979 to 1004 | 993, 1004, 1004, 979, 982 |
| private bytes at open (HOME, idle 2.5 s) (MB) | 613 | 595 to 619 | 613, 619, 617, 602, 595 |
| process count at open (HOME, idle 2.5 s) | 17 | 17 to 17 | 17, 17, 17, 17, 17 |
| private working set after 8 screens + HOME, idle 3 s (MB) | 293 | 284 to 297 | 293, 297, 294, 284, 288 |
| working set (shared counted per process) after 8 screens + HOME, idle 3 s (MB) | 682 | 668 to 686 | 682, 686, 684, 668, 675 |
| private bytes after 8 screens + HOME, idle 3 s (MB) | 505 | 479 to 516 | 505, 516, 508, 479, 498 |
| process count after 8 screens + HOME, idle 3 s | 8 | 8 to 8 | 8, 8, 8, 8, 8 |

| screen | settle ms (median) | private MB after it (median) | runs ok |
|---|---|---|---|
| LEDG | 355 | 359 | 5 |
| OOS | 338 | 363 | 5 |
| NQ GP 1d | 601 | 295 | 5 |
| volmanaged_v0 EQ | 2322 | 307 | 5 |
| LIVE | 323 | 304 | 5 |
| 27F MON | 113 | 304 | 5 |
| REG | 1270 | 294 | 5 |
| HOME | 710 | 294 | 5 |

Total CPU % just before each run: [39, 49, 29, 35, 18]; after: [40, 32, 40, 12, 16]

### egui offscreen (no window), Vulkan, mode both: 5 runs
| metric | median | min to max | all runs |
|---|---|---|---|
| spawn to first frame (ms) | 640 | 622 to 1160 | 622, 630, 1160, 649, 640 |
| idle private WS (MB) | 84 | 84 to 85 | 84, 84, 85, 84, 84 |
| idle WS (MB) | 130 | 129 to 131 | 130, 129, 131, 130, 129 |
| working private WS (MB) | 245 | 102 to 299 | 184, 245, 299, 297, 102 |
| working WS (MB) | 291 | 148 to 344 | 230, 291, 344, 343, 148 |
| CPU total % at work sample | 30 | 22 to 37 | 22, 30, 26, 35, 37 |
| frames in 9 s | 73 | 26 to 77 | 73, 74, 26, 77, 61 |
| first frame incl. GPU (ms) | 130.5 | 121.7 to 313.6 | 133.6, 121.7, 313.6, 130.5, 122.2 |
| frame ms median (CPU build + GPU, waited) | 120.32 | 107.09 to 130.70 | 118.49, 122.15, -1.00, 107.09, 130.70 |
| frame ms p95 | 130.01 | 124.82 to 158.19 | 127.28, 132.74, -1.00, 124.82, 158.19 |
| frame ms p99 | 134.20 | 133.68 to 174.78 | 133.68, 134.61, -1.00, 133.79, 174.78 |
| CPU build ms median (egui pass + tessellation) | 75.87 | 67.56 to 84.16 | 73.78, 77.96, -1.00, 67.56, 84.16 |
| sort ms median | 0.117 | 0.034 to 0.299 | 0.034, 0.070, 0.164, 0.299 |
adapter: NVIDIA GeForce RTX 4080 SUPER Vulkan

### egui offscreen (no window), Vulkan, mode chart: 5 runs
| metric | median | min to max | all runs |
|---|---|---|---|
| spawn to first frame (ms) | 616 | 603 to 1356 | 616, 603, 1356, 678, 616 |
| idle private WS (MB) | 84 | 82 to 84 | 82, 84, 84, 84, 84 |
| idle WS (MB) | 129 | 127 to 130 | 127, 129, 130, 129, 129 |
| working private WS (MB) | 106 | 90 to 227 | 227, 90, 159, 90, 106 |
| working WS (MB) | 152 | 135 to 273 | 273, 136, 205, 135, 152 |
| CPU total % at work sample | 34 | 19 to 51 | 34, 51, 19, 38, 29 |
| frames in 9 s | 70 | 46 to 82 | 70, 64, 46, 82, 71 |
| first frame incl. GPU (ms) | 124.4 | 115.7 to 313.5 | 115.7, 124.4, 313.5, 143.0, 122.6 |
| frame ms median (CPU build + GPU, waited) | 118.09 | 102.76 to 133.35 | 116.98, 133.35, 121.25, 102.76, 118.09 |
| frame ms p95 | 163.52 | 108.40 to 193.01 | 176.33, 193.01, 163.52, 108.40, 130.96 |
| frame ms p99 | 181.64 | 111.60 to 277.16 | 181.64, 221.79, 277.16, 111.60, 154.67 |
| CPU build ms median (egui pass + tessellation) | 73.86 | 64.22 to 83.08 | 71.06, 83.08, 73.86, 64.22, 76.66 |
| sort ms median | n/a | | |
adapter: NVIDIA GeForce RTX 4080 SUPER Vulkan

### egui offscreen (no window), Vulkan, mode chart-dec: 5 runs
| metric | median | min to max | all runs |
|---|---|---|---|
| spawn to first frame (ms) | 730 | 484 to 1063 | 1063, 730, 970, 484, 509 |
| idle private WS (MB) | 84 | 83 to 84 | 84, 83, 84, 83, 84 |
| idle WS (MB) | 129 | 129 to 130 | 129, 129, 129, 129, 130 |
| working private WS (MB) | 85 | 82 to 86 | 85, 82, 86, 85, 86 |
| working WS (MB) | 131 | 128 to 132 | 131, 128, 132, 131, 132 |
| CPU total % at work sample | 23 | 13 to 33 | 15, 23, 27, 13, 33 |
| frames in 9 s | 4450 | 106 to 5279 | 1340, 106, 4450, 5279, 4990 |
| first frame incl. GPU (ms) | 10.1 | 9.2 to 54.6 | 9.2, 24.0, 54.6, 10.1, 9.9 |
| frame ms median (CPU build + GPU, waited) | 1.15 | 1.07 to 64.70 | 1.07, 64.70, 1.15, 1.12, 1.22 |
| frame ms p95 | 2.02 | 1.86 to 338.31 | 15.39, 338.31, 1.98, 1.86, 2.02 |
| frame ms p99 | 2.62 | 2.37 to 400.15 | 132.63, 400.15, 2.62, 2.37, 2.59 |
| CPU build ms median (egui pass + tessellation) | 0.59 | 0.53 to 0.82 | 0.67, 0.82, 0.54, 0.53, 0.59 |
| sort ms median | n/a | | |
adapter: NVIDIA GeForce RTX 4080 SUPER Vulkan

### egui offscreen (no window), Vulkan, mode both-dec: 13 runs
| metric | median | min to max | all runs |
|---|---|---|---|
| spawn to first frame (ms) | 932 | 584 to 1092 | 1074, 1092, 1005, 810, 1029, 1039, 990, 932, 902, 810, 931, 862, 584 |
| idle private WS (MB) | 84 | 83 to 85 | 84, 84, 84, 84, 84, 84, 85, 84, 85, 84, 83, 84, 85 |
| idle WS (MB) | 130 | 129 to 131 | 130, 130, 130, 129, 130, 130, 131, 130, 131, 130, 129, 130, 131 |
| working private WS (MB) | 84 | 83 to 87 | 87, 84, 84, 83, 84, 84, 85, 85, 84, 84, 83, 85, 86 |
| working WS (MB) | 130 | 129 to 133 | 133, 130, 130, 129, 130, 130, 130, 131, 130, 130, 129, 131, 132 |
| CPU total % at work sample | 21 | 8 to 58 | 11, 58, 18, 25, 20, 8, 21, 19, 29, 18, 30, 31, 32 |
| frames in 9 s | 109 | 94 to 4352 | 4352, 105, 127, 105, 103, 106, 107, 382, 109, 94, 121, 581, 519 |
| first frame incl. GPU (ms) | 53.7 | 14.8 to 203.1 | 55.0, 116.6, 49.6, 22.7, 55.1, 203.1, 53.0, 53.7, 53.0, 54.9, 53.2, 54.7, 14.8 |
| frame ms median (CPU build + GPU, waited) | 62.52 | 1.44 to 62.85 | 1.44, 62.58, 62.64, 62.52, 62.72, 62.73, 62.51, 1.56, 62.71, 62.85, 62.36, 2.04, 2.83 |
| frame ms p95 | 302.80 | 2.37 to 320.21 | 2.37, 272.55, 302.80, 309.32, 305.73, 254.23, 308.37, 63.29, 308.25, 320.21, 318.33, 59.23, 62.07 |
| frame ms p99 | 366.73 | 2.94 to 466.60 | 2.94, 366.73, 316.96, 400.61, 466.60, 326.28, 368.17, 307.89, 372.42, 378.08, 367.70, 155.09, 184.59 |
| CPU build ms median (egui pass + tessellation) | 1.54 | 0.77 to 2.10 | 0.77, 2.10, 1.82, 1.74, 1.82, 1.82, 1.48, 1.18, 1.82, 1.54, 1.48, 1.19, 1.21 |
| sort ms median | 0.038 | 0.024 to 0.408 | 0.408, 0.039, 0.035, 0.026, 0.027, 0.039, 0.024, 0.213, 0.035, 0.036, 0.038, 0.356, 0.364 |
adapter: NVIDIA GeForce RTX 4080 SUPER Vulkan

### egui offscreen (no window), Vulkan, mode table: 5 runs
| metric | median | min to max | all runs |
|---|---|---|---|
| spawn to first frame (ms) | 506 | 490 to 909 | 506, 909, 490, 545, 493 |
| idle private WS (MB) | 84 | 84 to 85 | 84, 85, 84, 84, 84 |
| idle WS (MB) | 130 | 129 to 131 | 130, 131, 130, 129, 129 |
| working private WS (MB) | 84 | 84 to 84 | 84, 84, 84, 84, 84 |
| working WS (MB) | 130 | 130 to 130 | 130, 130, 130, 130, 130 |
| CPU total % at work sample | 38 | 9 to 49 | 9, 39, 27, 38, 49 |
| frames in 9 s | 6971 | 119 to 7578 | 1152, 119, 7578, 7417, 6971 |
| first frame incl. GPU (ms) | 11.9 | 10.0 to 56.6 | 21.9, 56.6, 10.0, 11.9, 10.9 |
| frame ms median (CPU build + GPU, waited) | 1.16 | 1.07 to 65.09 | 4.95, 65.09, 1.07, 1.10, 1.16 |
| frame ms p95 | 1.94 | 1.70 to 214.25 | 15.61, 214.25, 1.70, 1.86, 1.94 |
| frame ms p99 | 2.65 | 2.30 to 226.35 | 17.09, 226.35, 2.30, 2.54, 2.65 |
| CPU build ms median (egui pass + tessellation) | 0.61 | 0.54 to 1.77 | 0.63, 1.77, 0.57, 0.54, 0.61 |
| sort ms median | 0.478 | 0.039 to 0.614 | 0.412, 0.039, 0.571, 0.478, 0.614 |
adapter: NVIDIA GeForce RTX 4080 SUPER Vulkan

### egui offscreen, DX12, mode both-dec: 3 runs
| metric | median | min to max | all runs |
|---|---|---|---|
| spawn to first frame (ms) | 403 | 388 to 488 | 488, 403, 388 |
| idle private WS (MB) | 123 | 123 to 125 | 125, 123, 123 |
| idle WS (MB) | 160 | 160 to 173 | 173, 160, 160 |
| working private WS (MB) | 126 | 126 to 128 | 128, 126, 126 |
| working WS (MB) | 163 | 162 to 176 | 176, 163, 162 |
| CPU total % at work sample | 22 | 12 to 26 | 26, 12, 22 |
| frames in 9 s | 372 | 187 to 907 | 907, 372, 187 |
| first frame incl. GPU (ms) | 16.8 | 14.6 to 20.2 | 16.8, 20.2, 14.6 |
| frame ms median (CPU build + GPU, waited) | 2.97 | 1.83 to 19.67 | 1.83, 2.97, 19.67 |
| frame ms p95 | 90.54 | 21.40 to 174.73 | 21.40, 90.54, 174.73 |
| frame ms p99 | 267.71 | 146.87 to 506.67 | 146.87, 267.71, 506.67 |
| CPU build ms median (egui pass + tessellation) | 1.30 | 1.00 to 1.46 | 1.00, 1.46, 1.30 |
| sort ms median | 0.312 | 0.218 to 0.658 | 0.658, 0.312, 0.218 |
adapter: NVIDIA GeForce RTX 4080 SUPER Dx12

### eframe hidden window, Vulkan, window init only, mode both: 5 runs
| metric | median | min to max | all runs |
|---|---|---|---|
| spawn to first frame (ms) | 568 | 478 to 1209 | 512, 1209, 478, 997, 568 |
| idle private WS (MB) | 359 | 210 to 367 | 359, 358, 210, 367, 359 |
| idle WS (MB) | 426 | 279 to 434 | 426, 425, 279, 434, 426 |
| working private WS (MB) | 331 | 144 to 362 | 254, 362, 144, 331, 361 |
| working WS (MB) | 398 | 213 to 429 | 321, 429, 213, 398, 428 |
| CPU total % at work sample | 26 | 10 to 36 | 10, 32, 25, 36, 26 |

### eframe hidden window, Vulkan (explicit), both-dec, mode both-dec: 3 runs
| metric | median | min to max | all runs |
|---|---|---|---|
| spawn to first frame (ms) | 493 | 442 to 660 | 442, 660, 493 |
| idle private WS (MB) | 77 | 77 to 77 | 77, 77, 77 |
| idle WS (MB) | 124 | 124 to 124 | 124, 124, 124 |
| working private WS (MB) | 79 | 79 to 79 | 79, 79, 79 |
| working WS (MB) | 126 | 126 to 127 | 126, 127, 126 |
| CPU total % at work sample | 61 | 48 to 70 | 70, 48, 61 |

### eframe hidden window, DX12, both-dec, mode both-dec: 3 runs
| metric | median | min to max | all runs |
|---|---|---|---|
| spawn to first frame (ms) | 408 | 395 to 536 | 408, 395, 536 |
| idle private WS (MB) | 162 | 162 to 163 | 163, 162, 162 |
| idle WS (MB) | 212 | 212 to 216 | 216, 212, 212 |
| working private WS (MB) | 165 | 164 to 165 | 165, 164, 165 |
| working WS (MB) | 215 | 214 to 218 | 218, 214, 215 |
| CPU total % at work sample | 19 | 17 to 21 | 19, 17, 21 |

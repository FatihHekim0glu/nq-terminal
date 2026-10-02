import json, glob, statistics as st, os, sys
R = 'D:/dev/spikes/results'
MB = 1048576.0

def med(v):
    v = [x for x in v if x is not None and x != -1]
    return st.median(v) if v else None

def rng(v):
    v = [x for x in v if x is not None and x != -1]
    return (min(v), max(v)) if v else (None, None)

def row(name, v, fmt='{:.0f}'):
    m = med(v); lo, hi = rng(v)
    if m is None: return f'| {name} | n/a | | |'
    return f'| {name} | ' + fmt.format(m) + ' | ' + fmt.format(lo) + ' to ' + fmt.format(hi) + ' | ' + ', '.join(fmt.format(x) for x in v if x is not None) + ' |'

out = []
for target in ('tauri', 'edge'):
    runs = [json.load(open(f)) for f in sorted(glob.glob(f'{R}/webview/{target}-[0-9].json'))]
    out.append(f'\n### {target}: {len(runs)} runs')
    out.append('| metric | median | min to max | all runs |\n|---|---|---|---|')
    out.append(row('spawn to HOME ready (ms)', [r.get('coldStartToHomeReadyMs') for r in runs]))
    out.append(row('navigation start after spawn (ms)', [r.get('navStartAfterSpawnMs') for r in runs]))
    out.append(row('HOME frame mark from nav start (ms)', [r['home'].get('frame') for r in runs if 'home' in r]))
    out.append(row('HOME ready from nav start (ms)', [r['home'].get('ready') for r in runs if 'home' in r]))
    out.append(row('first contentful paint from nav start (ms)', [r['home'].get('fcp') for r in runs if 'home' in r]))
    if target == 'tauri':
        for k in ('main', 'setup', 'window_built', 'page_started', 'page_finished'):
            out.append(row(f'milestone {k} after spawn (ms)', [r.get('milestones', {}).get(k) for r in runs]))
    for key, label in (('memOpen', 'at open (HOME, idle 2.5 s)'), ('memAfter', 'after 8 screens + HOME, idle 3 s')):
        out.append(row(f'private working set {label} (MB)', [r[key]['wsPrivate'] / MB for r in runs if key in r]))
        out.append(row(f'working set (shared counted per process) {label} (MB)', [r[key]['ws'] / MB for r in runs if key in r]))
        out.append(row(f'private bytes {label} (MB)', [r[key]['privateBytes'] / MB for r in runs if key in r]))
        out.append(row(f'process count {label}', [r[key]['n'] for r in runs if key in r]))
    lines = []
    for r in runs:
        for s in r.get('screens', []):
            if s.get('settled'): lines.append(s['line'])
    names = []
    for r in runs:
        for s in r.get('screens', []):
            if s['line'] not in names: names.append(s['line'])
    out.append('\n| screen | settle ms (median) | private MB after it (median) | runs ok |\n|---|---|---|---|')
    for n in names:
        ss = [s for r in runs for s in r.get('screens', []) if s['line'] == n and s.get('settled')]
        out.append(f"| {n} | {med([s['ms'] for s in ss]):.0f} | {med([s['memPrivMB'] for s in ss]):.0f} | {len(ss)} |" if ss else f'| {n} | none settled | | 0 |')
    cpu = [r['load']['cpuBefore'] for r in runs]
    out.append(f'\nTotal CPU % just before each run: {cpu}; after: {[r["load"].get("cpuAfter") for r in runs]}')
    fat = [r.get('fatal') for r in runs if r.get('fatal')]
    if fat: out.append('FATAL: ' + str(fat))

for d, title in (('egui', 'egui offscreen (no window), Vulkan'), ('egui-dx12', 'egui offscreen, DX12'), ('egui-window', 'eframe hidden window, Vulkan, window init only'), ('egui-window-vk', 'eframe hidden window, Vulkan (explicit), both-dec'), ('egui-window-dx12', 'eframe hidden window, DX12, both-dec')):
    for mode in ('both', 'chart', 'chart-dec', 'both-dec', 'table'):
        runs = [json.load(open(f)) for f in sorted(glob.glob(f'{R}/{d}/{mode}-[0-9]*.run.json'))]
        if not runs: continue
        out.append(f'\n### {title}, mode {mode}: {len(runs)} runs')
        out.append('| metric | median | min to max | all runs |\n|---|---|---|---|')
        out.append(row('spawn to first frame (ms)', [r.get('spawnToFirstFrameMs') for r in runs]))
        out.append(row('idle private WS (MB)', [r['memIdle']['wsPrivate'] / MB for r in runs if 'memIdle' in r]))
        out.append(row('idle WS (MB)', [r['memIdle']['ws'] / MB for r in runs if 'memIdle' in r]))
        out.append(row('working private WS (MB)', [r['memWork']['wsPrivate'] / MB for r in runs if 'memWork' in r]))
        out.append(row('working WS (MB)', [r['memWork']['ws'] / MB for r in runs if 'memWork' in r]))
        out.append(row('CPU total % at work sample', [r.get('cpuTotalDuringWork') for r in runs]))
        apps = [r['app'] for r in runs if r.get('app')]
        if apps and 'frame_ms' in apps[0]:
            out.append(row('frames in 9 s', [a['frames'] for a in apps]))
            out.append(row('first frame incl. GPU (ms)', [a['first_frame_ms'] for a in apps], '{:.1f}'))
            out.append(row('frame ms median (CPU build + GPU, waited)', [a['frame_ms']['median'] for a in apps], '{:.2f}'))
            out.append(row('frame ms p95', [a['frame_ms']['p95'] for a in apps], '{:.2f}'))
            out.append(row('frame ms p99', [a['frame_ms']['p99'] for a in apps], '{:.2f}'))
            out.append(row('CPU build ms median (egui pass + tessellation)', [a['cpu_build_ms']['median'] for a in apps], '{:.2f}'))
            out.append(row('sort ms median', [a['sort_ms_median'] for a in apps if a['sorts']], '{:.3f}'))
            out.append('adapter: ' + apps[0]['adapter'])
        fat = [r.get('fatal') for r in runs if r.get('fatal')]
        if fat: out.append('FATAL: ' + str(fat))
print('\n'.join(out))

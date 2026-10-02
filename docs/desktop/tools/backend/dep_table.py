import json, sys, os
from importlib import metadata
from pathlib import Path
c=json.load(open('census.json'))
mods=set(c['modules_after_sweep'])|set(c['modules_after_create_app'])
tops={m.split('.')[0] for m in mods if not m.startswith('_')}
std=set(sys.stdlib_module_names)
pd_=metadata.packages_distributions()
# static imports from modules.json (direct)
ms=json.load(open('modules.json'))
direct={}
for m in ms:
    for t in m['imports']['third_party']:
        direct.setdefault(t,set()).add(m['module'])
SITE=Path(sys.prefix)/'Lib'/'site-packages'
def dist_info(name):
    d=metadata.distribution(name)
    size=0; native=[]; n=0
    for f in d.files or []:
        p=Path(d.locate_file(f))
        try:
            if p.is_file():
                size+=p.stat().st_size; n+=1
                if p.suffix.lower() in ('.pyd','.dll','.so','.dylib'): native.append(p.name)
        except OSError: pass
    return d.version,size,n,native
rows={}
for t in sorted(tops-std):
    if t in ('nq_terminal','nq_lab','cython_runtime'): continue
    dists=pd_.get(t,[t])
    for dn in dists:
        if dn in rows: rows[dn]['imports'].append(t); continue
        try: v,size,n,nat=dist_info(dn)
        except Exception as e: rows[dn]={'dist':dn,'imports':[t],'error':str(e)}; continue
        rows[dn]={'dist':dn,'version':v,'imports':[t],'size_mb':round(size/1048576,1),'files':n,'native_files':len(nat),'native_examples':sorted(set(nat))[:4],
                  'direct_by':sorted(direct.get(t,[]))}
# tag when first loaded
after_create=set(m.split('.')[0] for m in c['modules_after_create_app'])
for r in rows.values():
    r['loaded_at']='app start' if any(i in after_create for i in r['imports']) else 'on first use of a route'
# all installed dists by size for context
allsz=[]
for d in metadata.distributions():
    try:
        s=sum(Path(d.locate_file(f)).stat().st_size for f in (d.files or []) if Path(d.locate_file(f)).is_file())
    except OSError: s=0
    allsz.append((d.metadata['Name'],d.version,round(s/1048576,1)))
allsz.sort(key=lambda x:-x[2])
total=sum(x[2] for x in allsz)
json.dump({'rows':list(rows.values()),'all_installed_top':allsz[:25],'all_installed_total_mb':round(total,1),'n_installed':len(allsz)},open('deps.json','w'),indent=1)
for r in sorted(rows.values(),key=lambda r:-r.get('size_mb',0)): print(r['dist'],r.get('version'),r.get('size_mb'),r.get('native_files'),r['loaded_at'],r['imports'])
print(total,len(allsz)); print(allsz[:12])

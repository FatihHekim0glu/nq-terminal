import sys, json, os
sys.path.insert(0, r"C:\Users\Fatih Hekimoglu\nq-lab\terminal\backend")
from nq_terminal.app import create_app
o = create_app().openapi()
out = {}
for path, v in o["paths"].items():
    for m, d in v.items():
        q = [(x["name"] + ("*" if x.get("required") else "")) for x in d.get("parameters", []) if x["in"] == "query"]
        resp = d.get("responses", {})
        body = "yes" if d.get("requestBody") else ""
        out[f"{m.upper()} {path}"] = {"query": q, "codes": sorted(resp), "body": body, "tags": d.get("tags", [])}
json.dump({"paths": out, "n_schemas": len(o["components"]["schemas"]), "n_ops": len(out)}, open("oa_params.json", "w"), indent=1)
print(len(out), len(o["components"]["schemas"]))

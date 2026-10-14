import json
import sys
import time
import urllib.request as u

BASE = "http://127.0.0.1:8080"


def call(path, body=None):
    req = u.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None)
    return json.load(u.urlopen(req))


plan = int(sys.argv[1])
devices = [int(x) for x in sys.argv[2].split(",")]
run_id = call("/api/test-runs", {"plan_id": plan, "device_ids": devices})["run_id"]
while True:
    r = call(f"/api/test-runs/{run_id}")
    if r["run"]["status"] in ("completed", "failed"):
        break
    time.sleep(1)
print("status", r["run"]["status"])
for x in r["results"]:
    print(x["device_id"], x["device_type"], x["test"], x["verdict"], x["attempt"], x["message"][:110])

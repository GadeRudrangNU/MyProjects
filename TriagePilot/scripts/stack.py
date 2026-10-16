"""Starts the instance and the agent as local processes and waits until both answer.

    python scripts/stack.py up [--fresh] [--exclude-test]
    python scripts/stack.py down
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / "data" / "runtime"
PIDS = RUN / "pids.json"
VENV_PY = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
SN_PORT, AGENT_PORT = 8070, 8000


def wait_http(url: str, timeout: float = 90):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(url, timeout=2):
                return
        except Exception:
            time.sleep(0.4)
    raise SystemExit(f"timed out waiting for {url}")


def spawn(name: str, cmd: list[str], env: dict | None = None, cwd: Path = ROOT) -> int:
    log = open(RUN / f"{name}.log", "ab")
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    p = subprocess.Popen(cmd, cwd=cwd, env={**os.environ, **(env or {})}, stdout=log, stderr=log, creationflags=flags)
    return p.pid


def up(fresh: bool, exclude_test: bool):
    RUN.mkdir(parents=True, exist_ok=True)
    down()
    sn_cmd = ["node", "sim/cli.js", "serve", "--port", str(SN_PORT), "--agent", f"http://127.0.0.1:{AGENT_PORT}"]
    if fresh:
        sn_cmd.append("--fresh")
    pids = {"instance": spawn("instance", sn_cmd)}
    wait_http(f"http://127.0.0.1:{SN_PORT}/healthz")
    env = {"TP_SN_URL": f"http://127.0.0.1:{SN_PORT}", "PYTHONDONTWRITEBYTECODE": "1"}
    if exclude_test:
        env["TP_RETRIEVAL_EXCLUDE_SPLITS"] = json.dumps(["test"])
    pids["agent"] = spawn("agent", [str(VENV_PY), "-m", "uvicorn", "triagepilot.api:app_factory", "--factory", "--port", str(AGENT_PORT)], env, ROOT / "agent")
    PIDS.write_text(json.dumps(pids))
    wait_http(f"http://127.0.0.1:{AGENT_PORT}/healthz")
    print(f"instance http://127.0.0.1:{SN_PORT}   agent http://127.0.0.1:{AGENT_PORT}")


def down():
    if not PIDS.exists():
        return
    for pid in json.loads(PIDS.read_text()).values():
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
        else:
            try:
                os.kill(pid, 15)
            except ProcessLookupError:
                pass
    PIDS.unlink()
    time.sleep(1.5)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["up", "down"])
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--exclude-test", action="store_true")
    a = ap.parse_args()
    up(a.fresh, a.exclude_test) if a.action == "up" else down()

"""Starts the whole platform as local processes: Postgres, MongoDB, simulator, gateway, runner."""

import argparse
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PG_PORT = 5433
MONGO_PORT = 27018
PG_URL = f"postgresql://voltbench@127.0.0.1:{PG_PORT}/voltbench"
MONGO_URI = f"mongodb://127.0.0.1:{MONGO_PORT}"
GATEWAY = "http://127.0.0.1:8080"
LAB = "http://127.0.0.1:9100"
QUIET = subprocess.DEVNULL


def find(name: str, *fallbacks: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    for f in fallbacks:
        if Path(f).exists():
            return f
    raise SystemExit(f"cannot find {name}")


def pg_bin(tool: str) -> str:
    base = os.environ.get("PG_BIN") or "C:/Program Files/PostgreSQL/18/bin"
    return find(tool, f"{base}/{tool}.exe")


def wait_http(url: str, timeout: float = 40):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2):
                return
        except Exception:
            time.sleep(0.3)
    raise SystemExit(f"timed out waiting for {url}")


class Stack:
    def __init__(self, devices: int = 30, baseline_seconds: int = 30, web: bool = False, fresh: bool = False):
        self.devices = devices
        self.baseline = baseline_seconds
        self.web = web
        self.fresh = fresh
        self.procs: list[subprocess.Popen] = []
        (DATA / "logs").mkdir(parents=True, exist_ok=True)

    def _spawn(self, name: str, cmd: list[str], env: dict | None = None) -> subprocess.Popen:
        log = open(DATA / "logs" / f"{name}.log", "ab")
        flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        proc = subprocess.Popen(cmd, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, env={**os.environ, **(env or {})}, creationflags=flags)
        self.procs.append(proc)
        return proc

    def _postgres(self):
        pgdata = DATA / "pg"
        if self.fresh and pgdata.exists():
            subprocess.run([pg_bin("pg_ctl"), "-D", str(pgdata), "stop", "-m", "fast"], stdout=QUIET, stderr=QUIET, check=False)
            shutil.rmtree(pgdata, ignore_errors=True)
        if not (pgdata / "PG_VERSION").exists():
            subprocess.run([pg_bin("initdb"), "-D", str(pgdata), "-U", "voltbench", "--auth=trust", "-E", "UTF8"], check=True, stdout=QUIET, stderr=QUIET)
        status = subprocess.run([pg_bin("pg_ctl"), "-D", str(pgdata), "status"], stdout=QUIET, stderr=QUIET, check=False)
        if status.returncode != 0:
            subprocess.run(
                [pg_bin("pg_ctl"), "-D", str(pgdata), "-o", f"-p {PG_PORT}", "-l", str(DATA / "logs" / "postgres.log"), "-w", "start"],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        with psycopg.connect(f"postgresql://voltbench@127.0.0.1:{PG_PORT}/postgres", autocommit=True) as conn:
            if not conn.execute("SELECT 1 FROM pg_database WHERE datname='voltbench'").fetchone():
                conn.execute("CREATE DATABASE voltbench")
        with psycopg.connect(PG_URL, autocommit=True) as conn:
            if self.fresh:
                conn.execute("DROP SCHEMA IF EXISTS lab CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public")
            conn.execute((ROOT / "db" / "schema.sql").read_text())

    def _mongo(self):
        dbpath = DATA / "mongo"
        if self.fresh and dbpath.exists():
            shutil.rmtree(dbpath, ignore_errors=True)
        dbpath.mkdir(parents=True, exist_ok=True)
        mongod = find("mongod", "C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe")
        self._spawn("mongo", [mongod, "--dbpath", str(dbpath), "--port", str(MONGO_PORT), "--bind_ip", "127.0.0.1", "--quiet"])
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                import socket

                socket.create_connection(("127.0.0.1", MONGO_PORT), timeout=1).close()
                return
            except OSError:
                time.sleep(0.3)
        raise SystemExit("mongod did not start")

    def _gateway_binary(self) -> Path:
        exe = ROOT / "gateway" / "bin" / ("gateway.exe" if os.name == "nt" else "gateway")
        go = find("go", "C:/Program Files/Go/bin/go.exe")
        subprocess.run([go, "build", "-o", str(exe), "."], cwd=ROOT / "gateway", check=True)
        return exe

    def start(self):
        py = sys.executable
        print("starting postgres", flush=True)
        self._postgres()
        print("starting mongodb", flush=True)
        self._mongo()
        print("building gateway", flush=True)
        gateway = self._gateway_binary()
        print("starting simulator, gateway and runner", flush=True)
        manifest = DATA / "manifest.json"
        manifest.unlink(missing_ok=True)
        self._spawn("simulator", [py, "-m", "simulator", "--devices", str(self.devices), "--manifest", str(manifest), "--db-url", PG_URL])
        wait_http(f"{LAB}/healthz")
        self._spawn(
            "gateway",
            [str(gateway), "-pg", PG_URL, "-mongo", MONGO_URI, "-catalog", str(ROOT / "spec" / "catalog.json"),
             "-manifest", str(manifest), "-baseline-seconds", str(self.baseline)]
            + (["-web", str(ROOT / "web" / "dist")] if self.web else []),
        )
        subprocess.run([py, "-m", "runner", "seed", "--pg-url", PG_URL], cwd=ROOT, check=True)
        self._spawn("runner", [py, "-m", "runner", "serve", "--pg-url", PG_URL])
        wait_http(f"{GATEWAY}/readyz")
        wait_http("http://127.0.0.1:8090/healthz")
        return self

    def stop(self):
        for p in reversed(self.procs):
            if p.poll() is None:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], stdout=QUIET, stderr=QUIET, check=False)
                else:
                    p.terminate()
        self.procs.clear()
        subprocess.run([pg_bin("pg_ctl"), "-D", str(DATA / "pg"), "stop", "-m", "fast"], stdout=QUIET, stderr=QUIET, check=False)

    def __enter__(self):
        try:
            return self.start()
        except BaseException:
            self.stop()
            raise

    def __exit__(self, *exc):
        self.stop()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--devices", type=int, default=30)
    parser.add_argument("--baseline-seconds", type=int, default=30)
    parser.add_argument("--web", action="store_true", help="serve the built dashboard from the gateway")
    parser.add_argument("--fresh", action="store_true", help="wipe data first")
    args = parser.parse_args()
    stack = Stack(args.devices, args.baseline_seconds, args.web, args.fresh)
    try:
        stack.start()
        print(f"platform up: gateway {GATEWAY}, lab {LAB}, {args.devices} devices", flush=True)
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        stack.stop()


if __name__ == "__main__":
    main()

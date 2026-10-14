"""Start the whole PayFlow stack locally, no Docker: Postgres, Redis-compatible broker,
migrations, API, Celery worker and beat. Ctrl+C stops everything.

    python scripts/dev_up.py            # then open http://localhost:8000/api/docs/
    python scripts/dev_up.py --seed     # also create a demo tenant and write frontend/.env.local
"""

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".dev-services.env"
LOGS = ROOT / ".devdata" / "logs"
PY = sys.executable


def spawn(name: str, *args: str, env=None) -> subprocess.Popen:
    LOGS.mkdir(parents=True, exist_ok=True)
    log = open(LOGS / f"{name}.log", "w")  # noqa: SIM115 - kept open for the child's lifetime
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    return subprocess.Popen([PY, *args], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, env=env, creationflags=flags)


def run(*args: str) -> None:
    subprocess.run([PY, *args], cwd=ROOT, check=True)


def wait_for(path: Path, timeout: float = 90) -> None:
    deadline = time.time() + timeout
    while not path.exists():
        if time.time() > deadline:
            raise SystemExit(f"timed out waiting for {path.name}; see {LOGS}")
        time.sleep(0.5)


def wait_for_http(url: str, timeout: float = 60) -> None:
    import urllib.request

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=2)  # noqa: S310 - fixed local URL
            return
        except OSError:
            time.sleep(0.5)
    raise SystemExit(f"API did not come up; see {LOGS / 'api.log'}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", action="store_true", help="create a demo tenant")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    procs: list[subprocess.Popen] = []
    try:
        ENV_FILE.unlink(missing_ok=True)
        procs.append(spawn("services", "scripts/dev_services.py"))
        wait_for(ENV_FILE)
        time.sleep(1)
        run("manage.py", "migrate", "--noinput", "-v", "0")
        if args.seed:
            run("manage.py", "seed_demo")
        procs.append(
            spawn(
                "api", "-m", "waitress", f"--listen=127.0.0.1:{args.port}", "--threads=16", "payflow.wsgi:application"
            )
        )
        procs.append(
            spawn(
                "worker",
                "-m",
                "celery",
                "-A",
                "payflow",
                "worker",
                "-P",
                "threads",
                "-c",
                "8",
                "-l",
                "info",
                "--without-mingle",
                "--without-gossip",
            )
        )
        procs.append(
            spawn(
                "beat",
                "-m",
                "celery",
                "-A",
                "payflow",
                "beat",
                "-l",
                "info",
                "-s",
                str(ROOT / ".devdata" / "celerybeat-schedule"),
            )
        )
        wait_for_http(f"http://127.0.0.1:{args.port}/health/")
        print(f"PayFlow is up:  API http://127.0.0.1:{args.port}   docs http://127.0.0.1:{args.port}/api/docs/")
        print(f"logs: {LOGS}   (Ctrl+C to stop)", flush=True)
        while all(p.poll() is None for p in procs):
            time.sleep(1)
        print("a service exited unexpectedly; see logs", file=sys.stderr)
    except KeyboardInterrupt:
        pass
    finally:
        for p in reversed(procs):
            if p.poll() is None:
                p.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGINT)
        for p in reversed(procs):
            try:
                p.wait(timeout=20)
            except subprocess.TimeoutExpired:
                p.kill()


if __name__ == "__main__":
    main()

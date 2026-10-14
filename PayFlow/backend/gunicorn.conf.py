import os

from prometheus_client import multiprocess

bind = "0.0.0.0:8000"
workers = int(os.environ.get("WEB_CONCURRENCY", "3"))
timeout = 30
graceful_timeout = 20
accesslog = "-"
max_requests = 5000  # recycle workers occasionally; the jitter avoids restarting them all at once
max_requests_jitter = 500


def child_exit(server, worker):
    multiprocess.mark_process_dead(worker.pid)

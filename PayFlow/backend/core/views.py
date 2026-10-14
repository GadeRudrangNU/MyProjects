import logging
import os

from django.db import connection
from django.http import HttpResponse, JsonResponse
from prometheus_client import REGISTRY, CollectorRegistry, generate_latest, multiprocess

from .prometheus import database_registry

log = logging.getLogger(__name__)


def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:
        return JsonResponse({"status": "error", "database": "down"}, status=503)
    return JsonResponse({"status": "ok", "database": "up"})


def metrics(request):
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry)
    else:
        registry = REGISTRY
    body = generate_latest(registry)
    try:
        body += generate_latest(database_registry())
    except Exception:  # keep request metrics flowing even if the database is unreachable
        log.warning("database metrics unavailable", exc_info=True)
    return HttpResponse(body, content_type="text/plain; version=0.0.4; charset=utf-8")

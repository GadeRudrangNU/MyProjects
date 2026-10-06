import time

from fastapi import FastAPI, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

HTTP_LATENCY = Histogram("http_request_duration_seconds", "HTTP latency", ["method", "path", "status"])
INFERENCE_LATENCY = Histogram(
    "inference_latency_seconds", "Model inference latency", ["model"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.25, 0.5, 1, 2.5),
)
RUNS_TOTAL = Counter("evaluation_runs_total", "Finished evaluation runs", ["status"])


def setup_observability(app: FastAPI) -> None:
    @app.middleware("http")
    async def timing(request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        route = request.scope.get("route")
        path = route.path if route else "unmatched"
        HTTP_LATENCY.labels(request.method, path, response.status_code).observe(time.perf_counter() - start)
        return response

    @app.get("/metrics", include_in_schema=False)
    def metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

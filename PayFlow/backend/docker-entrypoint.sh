#!/bin/sh
set -e
# Prometheus multiprocess mode: every gunicorn worker writes metrics into this directory.
rm -rf "$PROMETHEUS_MULTIPROC_DIR" && mkdir -p "$PROMETHEUS_MULTIPROC_DIR"
if [ "$RUN_MIGRATIONS" = "1" ]; then
    python manage.py migrate --noinput
fi
exec "$@"

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PROMETHEUS_MULTIPROC_DIR=/tmp/prometheus

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
RUN useradd --create-home --uid 10001 app \
    && DJANGO_DEBUG=1 python manage.py collectstatic --noinput \
    && chmod +x docker-entrypoint.sh \
    && chown -R app /app
USER app

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/', timeout=2)"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["gunicorn", "payflow.wsgi:application", "--config", "gunicorn.conf.py"]

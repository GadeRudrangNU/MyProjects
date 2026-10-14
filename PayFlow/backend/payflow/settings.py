"""PayFlow settings. All configuration comes from environment variables.

For local development without Docker, ``scripts/dev_services.py`` writes
``.dev-services.env`` (DATABASE_URL, CELERY_BROKER_URL); it is read here when present.
"""

import os
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from celery.schedules import crontab

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dev_env() -> None:
    path = BASE_DIR / ".dev-services.env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


_load_dev_env()


def env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).lower() in {"1", "true", "yes", "on"}


DEBUG = env_bool("DJANGO_DEBUG", False)
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "dev-only-insecure-key-do-not-use-in-production"  # noqa: S105 - only reachable with DJANGO_DEBUG
    else:
        raise RuntimeError("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is off")

ALLOWED_HOSTS = [h for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "corsheaders",
    "django_prometheus",
    "core",
    "ledger",
    "payments",
    "fraud",
    "webhooks",
    "backoffice",
]

MIDDLEWARE = [
    "django_prometheus.middleware.PrometheusBeforeMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "django_prometheus.middleware.PrometheusAfterMiddleware",
]

ROOT_URLCONF = "payflow.urls"
WSGI_APPLICATION = "payflow.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]


def _database_from_url(url: str) -> dict:
    parsed = urlparse(url)
    return {
        "ENGINE": "django_prometheus.db.backends.postgresql",
        "NAME": parsed.path.lstrip("/") or "postgres",
        "USER": unquote(parsed.username or "postgres"),
        "PASSWORD": unquote(parsed.password or ""),
        "HOST": parsed.hostname or "localhost",
        "PORT": parsed.port or 5432,
        "CONN_MAX_AGE": int(os.environ.get("DB_CONN_MAX_AGE", "60")),
        "OPTIONS": {"sslmode": os.environ.get("DB_SSLMODE", "prefer")}
        if parsed.hostname not in {"localhost", "127.0.0.1", "db"}
        else {},
    }


# PostgreSQL only: the ledger relies on row locks (SELECT ... FOR UPDATE) and
# deferred constraint triggers.
DATABASES = {
    "default": _database_from_url(
        os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/payflow")
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["core.auth.ApiKeyAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "core.pagination.StandardPagination",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_THROTTLE_CLASSES": [],
    "EXCEPTION_HANDLER": "core.errors.api_exception_handler",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "PayFlow API",
    "DESCRIPTION": (
        "Payments ledger and fraud detection service. Amounts are integers in minor units "
        "(cents). Money-moving POST endpoints require an `Idempotency-Key` header."
    ),
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SECURITY": [{"ApiKeyAuth": []}],
    "APPEND_COMPONENTS": {
        "securitySchemes": {"ApiKeyAuth": {"type": "http", "scheme": "bearer", "description": "pf_... API key"}}
    },
}

CORS_ALLOWED_ORIGINS = [
    o for o in os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o
]
CORS_ALLOW_HEADERS = ["authorization", "content-type", "idempotency-key", "x-api-key"]
CORS_EXPOSE_HEADERS = ["Idempotent-Replayed"]

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = env_bool("DJANGO_SSL_REDIRECT", False)
    SESSION_COOKIE_SECURE = SECURE_SSL_REDIRECT
    CSRF_COOKIE_SECURE = SECURE_SSL_REDIRECT

# --- Celery -----------------------------------------------------------------
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_TASK_ALWAYS_EAGER = env_bool("CELERY_TASK_ALWAYS_EAGER", False)
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_TASK_ACKS_LATE = True
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
CELERY_BROKER_TRANSPORT_OPTIONS = {"socket_connect_timeout": 2, "socket_timeout": 5}
CELERY_BROKER_CONNECTION_TIMEOUT = 2
CELERY_BROKER_CONNECTION_MAX_RETRIES = 1
CELERY_TIMEZONE = "UTC"
CELERY_BEAT_SCHEDULE = {
    "dispatch-due-webhooks": {
        "task": "webhooks.dispatch_due_deliveries",
        "schedule": float(os.environ.get("WEBHOOK_SWEEP_SECONDS", "15")),
    },
    "nightly-reconciliation": {
        "task": "backoffice.run_reconciliation",
        "schedule": crontab(hour=2, minute=0),
    },
    "nightly-settlement": {
        "task": "backoffice.run_settlement",
        "schedule": crontab(hour=3, minute=0),
    },
}

# --- PayFlow domain settings ---------------------------------------------------
PAYFLOW: dict[str, Any] = {
    # Fraud rules. Amounts in cents.
    "FRAUD": {
        "VELOCITY_WINDOW_SECONDS": 60,
        "VELOCITY_REVIEW_COUNT": int(os.environ.get("FRAUD_VELOCITY_REVIEW_COUNT", "5")),
        "VELOCITY_BLOCK_COUNT": int(os.environ.get("FRAUD_VELOCITY_BLOCK_COUNT", "10")),
        "LARGE_AMOUNT_REVIEW": 500_000,
        "ZSCORE_MIN_HISTORY": 5,
        "ZSCORE_REVIEW": 4.0,
        "ZSCORE_BLOCK": 10.0,
        "NEW_DEVICE_MIN_HISTORY": 3,
        "NEW_DEVICE_AMOUNT_REVIEW": 20_000,
        "MODEL_ENABLED": env_bool("FRAUD_MODEL_ENABLED", True),
        # None -> use the thresholds chosen at training time (see ml/).
        "MODEL_REVIEW_THRESHOLD": None,
        "MODEL_BLOCK_THRESHOLD": None,
    },
    # Webhooks
    "WEBHOOK_MAX_ATTEMPTS": int(os.environ.get("WEBHOOK_MAX_ATTEMPTS", "8")),
    "WEBHOOK_BACKOFF_BASE_SECONDS": float(os.environ.get("WEBHOOK_BACKOFF_BASE_SECONDS", "10")),
    "WEBHOOK_BACKOFF_MAX_SECONDS": float(os.environ.get("WEBHOOK_BACKOFF_MAX_SECONDS", "3600")),
    "WEBHOOK_TIMEOUT_SECONDS": float(os.environ.get("WEBHOOK_TIMEOUT_SECONDS", "5")),
    "WEBHOOK_ALLOW_PRIVATE_HOSTS": env_bool("WEBHOOK_ALLOW_PRIVATE_HOSTS", DEBUG),
    # Settlement: captured payments older than this are swept into a payout.
    "SETTLEMENT_DELAY_SECONDS": int(os.environ.get("SETTLEMENT_DELAY_SECONDS", "86400")),
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO")},
}

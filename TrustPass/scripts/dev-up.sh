#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_PORT="${API_PORT:-8080}"
WORKER_PORT="${WORKER_PORT:-8081}"
WEB_PORT="${WEB_PORT:-5173}"
PARTNER_PORT="${PARTNER_PORT:-5174}"
DB_PORT="${DB_PORT:-5434}"
SMTP_PORT="${SMTP_PORT:-3025}"
WORKERS="${WORKERS:-1}"

mkdir -p logs .run
if [ -f .run/pids ]; then "$ROOT/scripts/dev-down.sh" || true; fi

if [ ! -f api/target/api-1.0.0.jar ] || [ ! -f worker/target/worker-1.0.0.jar ]; then
  ./mvnw -B -q -DskipTests package
fi

wait_for() {
  local url="$1" name="$2" seconds="$3" waited=0
  until curl -fsS -o /dev/null "$url"; do
    sleep 2
    waited=$((waited + 2))
    if [ "$waited" -ge "$seconds" ]; then
      echo "$name did not become ready at $url" >&2
      exit 1
    fi
  done
}

start() {
  local log="$1" dir="$2"
  shift 2
  (cd "$dir" && nohup "$@" > "$ROOT/logs/$log.log" 2>&1 & echo $! >> "$ROOT/.run/pids")
}

WEB_ORIGIN="http://localhost:$WEB_PORT"
PARTNER_ORIGIN="http://localhost:$PARTNER_PORT"
API_URL="http://localhost:$API_PORT"

export TRUSTPASS_DB_PORT="$DB_PORT" TRUSTPASS_SEED=true TRUSTPASS_SECURITY_ISSUER="$API_URL" \
  TRUSTPASS_FRONTEND_URL="$WEB_ORIGIN" TRUSTPASS_CORS_ALLOWED_ORIGINS="$WEB_ORIGIN,$PARTNER_ORIGIN" \
  TRUSTPASS_PARTNER_REDIRECT_URI="$PARTNER_ORIGIN/callback"

SERVER_PORT="$API_PORT" start api "$ROOT" java -jar api/target/api-1.0.0.jar
wait_for "$API_URL/actuator/health" "The API" 240

for i in $(seq 0 $((WORKERS - 1))); do
  embedded=false
  if [ "$i" -eq 0 ]; then embedded=true; fi
  SERVER_PORT=$((WORKER_PORT + i)) TRUSTPASS_MAIL_SMTP_PORT="$SMTP_PORT" TRUSTPASS_MAIL_EMBEDDED="$embedded" \
    start "worker$((i + 1))" "$ROOT" java -jar worker/target/worker-1.0.0.jar
done
wait_for "http://localhost:$WORKER_PORT/actuator/health" "The worker" 120

export VITE_API_URL="$API_URL" VITE_MAIL_URL="http://localhost:$WORKER_PORT" VITE_TRUSTPASS_URL="$API_URL"
for app in web partner-demo; do
  [ -d "$app/node_modules" ] || (cd "$app" && npm ci --no-audit --no-fund)
done
WEB_PORT="$WEB_PORT" start web "$ROOT/web" npm run dev
PARTNER_PORT="$PARTNER_PORT" start partner-demo "$ROOT/partner-demo" npm run dev
wait_for "$WEB_ORIGIN" "The web app" 90
wait_for "$PARTNER_ORIGIN" "The partner demo" 90

echo "Web app: $WEB_ORIGIN"
echo "Partner demo: $PARTNER_ORIGIN"
echo "API docs: $API_URL/swagger-ui.html"

#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -f "$ROOT/.run/pids" ]; then
  while read -r pid; do
    [ -n "$pid" ] && pkill -P "$pid" 2>/dev/null
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
  done < "$ROOT/.run/pids"
  rm -f "$ROOT/.run/pids"
fi

if [ -f "$ROOT/.data/pg/postmaster.pid" ]; then
  kill "$(head -1 "$ROOT/.data/pg/postmaster.pid")" 2>/dev/null
fi
echo "Stopped."

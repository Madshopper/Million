#!/usr/bin/env bash
# Kør madshopper.dk helt offline med mock-data (docs/offline.md).
#
#   bash scripts/offline.sh                 # start på http://127.0.0.1:5001 (Ctrl+C stopper)
#   bash scripts/offline.sh --shots [dir]   # start, tag skærmbilleder, stop igen
#
# Ingen kald forlader maskinen: Supabase/KV/D1 er erstattet af mockdata/, og
# proxy-variablerne peger på en død port, så et glemt kald fejler i stedet for
# at slippe ud. --shots fejler, hvis browseren prøver at hente noget udefra.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-5001}"
export MADSHOPPER_OFFLINE=1
export FLASK_DEBUG="${FLASK_DEBUG:-0}"
# Fang utilsigtede udgående kald fra Python (httpx/requests respekterer dem).
export HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9
export http_proxy=$HTTP_PROXY https_proxy=$HTTPS_PROXY NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost

PY=(uv run --offline python)
[ -x .venv/bin/python ] && PY=(.venv/bin/python)

if [ "${1:-}" != "--shots" ]; then
  echo "==> Offline: http://127.0.0.1:${PORT}  (mock-skrivninger: /__mock/writes)"
  PORT="$PORT" exec "${PY[@]}" app.py
fi

OUT="${2:-offline-shots}"
shift $(( $# >= 2 ? 2 : 1 ))
LOG="$(mktemp)"
PORT="$PORT" "${PY[@]}" app.py >"$LOG" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null --noproxy "*" "http://127.0.0.1:${PORT}/" 2>/dev/null && break
  sleep 1
done
curl -fsS -o /dev/null --noproxy '*' "http://127.0.0.1:${PORT}/" || { echo "Flask kom aldrig op:"; tail -40 "$LOG"; exit 1; }
node scripts/offline-preview.mjs "http://127.0.0.1:${PORT}" "$OUT" "$@"

#!/bin/zsh
set -u

cd "$(dirname "$0")" || exit 1

export YOLO_CONFIG_DIR=/tmp/parkview-ultralytics
export PARKVIEW_PUBLIC_RELAY=true
export PARKVIEW_DEBUG=false

SERVER_PID=""

cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
  fi
  exit 0
}

trap cleanup EXIT INT TERM

python3 server.py --host 127.0.0.1 --port 5180 &
SERVER_PID=$!

echo "ParkView CCTV server is starting..."
for _ in {1..30}; do
  if curl -fsS --max-time 1 http://127.0.0.1:5180/api/health >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "ParkView server stopped before it became ready."
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 1
done

echo "Keep this window open. The tunnel reconnects automatically if it drops."

node scripts/run-public-tunnel.mjs

if kill -0 "$SERVER_PID" 2>/dev/null; then
  wait "$SERVER_PID"
fi

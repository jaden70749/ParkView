#!/bin/zsh
cd "$(dirname "$0")"
echo "ParkView server starting..."
echo
LOCAL_HOST="$(scutil --get LocalHostName 2>/dev/null || hostname -s)"
LOCAL_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
echo "Mac:    http://localhost:5180/?v=74"
echo "iPhone: http://${LOCAL_HOST}.local:5180/?v=74"
if [[ -n "${LOCAL_IP}" ]]; then
  echo "IP:     http://${LOCAL_IP}:5180/?v=74"
fi
echo
export YOLO_CONFIG_DIR=/tmp/parkview-ultralytics
export PARKVIEW_DEBUG=false
exec python3 server.py --host 0.0.0.0 --port 5180

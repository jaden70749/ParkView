#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo ./deploy/install-raspberry-pi.sh"
  exit 1
fi

APP_DIR=/opt/parkview
APP_USER=parkview
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

apt-get update
apt-get install -y python3-venv python3-pip ffmpeg libopenblas-dev

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/parkview --shell /usr/sbin/nologin "${APP_USER}"
fi

install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}" /var/lib/parkview/ultralytics
cp -R "${SOURCE_DIR}/." "${APP_DIR}/"
if [[ ! -f /var/lib/parkview/parking_regions.json ]]; then
  cp "${APP_DIR}/parking_regions.json" /var/lib/parkview/parking_regions.json
fi
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}" /var/lib/parkview
chown -R "${APP_USER}:${APP_USER}" /var/lib/parkview

python3 -m venv "${APP_DIR}/.venv"
"${APP_DIR}/.venv/bin/pip" install --upgrade pip wheel
"${APP_DIR}/.venv/bin/pip" install -r "${APP_DIR}/requirements.txt"

if [[ ! -f "${APP_DIR}/.env" ]]; then
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  ADMIN_TOKEN="$(openssl rand -hex 32)"
  sed -i "s/CHANGE_THIS_TO_A_LONG_RANDOM_VALUE/${ADMIN_TOKEN}/" "${APP_DIR}/.env"
  chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
  chmod 600 "${APP_DIR}/.env"
  echo "Created ${APP_DIR}/.env. Set the camera URL before starting the service."
fi

install -m 0644 "${APP_DIR}/deploy/parkview-edge.service" /etc/systemd/system/parkview-edge.service
systemctl daemon-reload
systemctl enable parkview-edge.service

echo "Installation complete."
echo "1. Edit /opt/parkview/.env"
echo "2. Run: sudo systemctl start parkview-edge"
echo "3. Check: sudo journalctl -u parkview-edge -f"

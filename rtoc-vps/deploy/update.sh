#!/usr/bin/env bash
# Deploy the latest code from GitHub.
# Usage (from your sudo user):  sudo bash /opt/rtoc/app/deploy/update.sh
set -euo pipefail
APP_DIR=/opt/rtoc/app

echo "==> Pulling latest code"
sudo -H -u rtoc git -C "$APP_DIR" pull --ff-only

echo "==> Installing dependencies"
sudo -H -u rtoc bash -c "cd '$APP_DIR' && npm install --omit=dev --no-audit --no-fund"

echo "==> Restarting service"
systemctl restart rtoc
sleep 2

echo "==> Health check"
curl -fsS http://127.0.0.1:3000/healthz && echo "  <- app is up"
systemctl --no-pager --lines=5 status rtoc | head -n 12

#!/bin/bash
# HA Linux Companion — Installer for Raspberry Pi OS
set -e

echo "=== HA Linux Companion Installer ==="

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "Node.js: $(node -v)"
echo "npm: $(npm -v)"

# Install app
echo "Installing dependencies..."
npm install --production

# Create systemd service
echo "Creating systemd service..."
USER=$(whoami)
cat << EOF | sudo tee /etc/systemd/system/ha-linux-companion.service
[Unit]
Description=HA Linux Companion (Electron)
After=graphical-session.target

[Service]
Type=simple
User=$USER
Environment=DISPLAY=:0
Environment=XDG_RUNTIME_DIR=/run/user/$(id -u)
WorkingDirectory=$(pwd)
ExecStart=$(which npx) electron . --no-sandbox --disable-gpu-sandbox
Restart=on-failure
RestartSec=5

[Install]
WantedBy=graphical-session.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ha-linux-companion

echo ""
echo "✅ Install complete!"
echo "Start now:  systemctl --user start ha-linux-companion"
echo "Auto-start: enabled on boot"

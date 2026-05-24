# HA Linux Companion

Home Assistant companion app for Linux touchscreen panels — built with Electron.

![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- 🔐 **Login** — Username/password + 2FA/MFA, or long-lived token
- 📱 **Device registration** — Registers as `mobile_app` in HA integrations
- 📊 **System sensors** — CPU temp, CPU%, RAM%, disk%, uptime, IP, display state
- 🔔 **Notifications** — Real-time via WebSocket, shown as overlay on dashboard
- 🎛️ **Settings overlay** — Volume, brightness, Bluetooth, right on the dashboard
- ⚡ **Auto-login** — Token persists across restarts
- 🔒 **Self-signed certs** — Works with local HTTPS (Caddy, Nginx)
- 🖥️ **Fullscreen kiosk** — Optimized for 7" and 10" touch panels
- ⌨️ **On-screen keyboard** — With shift, CAPS, symbols, URL shortcuts

## Supported Hardware

- Raspberry Pi 4/5 (arm64) with touchscreen
- Any Linux with X11/Wayland + Electron support

## Quick Start

```bash
git clone https://github.com/SimoneB79/ha-linux-companion.git
cd ha-linux-companion
npm install
npm start
```

## System Install (Raspberry Pi)

```bash
chmod +x install.sh
sudo ./install.sh
```

Creates a systemd service for auto-start on boot.

## Settings Menu

Tap the ⚙ gear icon (top-right of dashboard) to access:

| Control | Description |
|---------|-------------|
| Volume | System volume slider + mute |
| Brightness | Display brightness (ddcutil or rpi-backlight) |
| Bluetooth | Scan and connect devices |
| Reload | Refresh the HA dashboard |
| Fullscreen | Toggle fullscreen mode |
| Logout | Clear config and return to login |
| Exit | Quit the app |

## Sensors Published to HA

| Sensor | Type | Unit |
|--------|------|------|
| CPU Temperature | sensor | °C |
| CPU Usage | sensor | % |
| RAM Usage | sensor | % |
| RAM Free | sensor | MB |
| Disk Usage | sensor | % |
| System Uptime | sensor | — |
| IP Address | sensor | — |
| Display State | binary_sensor | on/off |

## Configuration

Stored in `~/.config/ha-linux-companion/config.json`:

```json
{
  "url": "https://homeassistant.local:8123",
  "token": "***",
  "deviceName": "My Panel",
  "deviceId": "...",
  "webhookId": "...",
  "registered": true,
  "fullscreen": true
}
```

## Notifications

After login, the app connects via WebSocket to receive real-time notifications.
Send from HA using the `notify.mobile_app_<device_name>` service.

## Building

```bash
npm run dist
```

## License

MIT

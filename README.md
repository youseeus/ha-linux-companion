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

Real-time push notifications from Home Assistant, displayed as toast overlays on the dashboard.

### Sending notifications

Use the standard `notify.mobile_app_<device_name>` service:

```yaml
service: notify.mobile_app_pannello
data:
  title: "🔔 Alert"
  message: "Front door opened!"
  data:
    priority: high
    push_sound: warning
    channel: alarm
    channel_name: Allarmi
```

### Toast overlay

- Custom HTML/CSS toast injected into the Lovelace dashboard
- Animated slide-in/out with progress bar for auto-dismiss
- Up to 3 stacked toasts
- Priority levels: `urgent` (persistent + action button), `high`, `default`, `low`, `min`
- Color-coded borders: 🔴 urgent, 🟡 high, 🔵 default, ⚪ low, ⚫ min

### Notification settings (⚙ menu)

| Setting | Description |
|---------|-------------|
| Enable | Toggle all notifications |
| Sound | Toggle notification sounds |
| Do Not Disturb | Silence everything |
| Popup duration | 4s / 6s / 10s / Never |
| Melody | Default / Success / Warning / Error / Custom |

Custom sounds: place `.wav`, `.ogg`, `.mp3`, or `.flac` files in `~/.config/ha-linux-companion/sounds/`.

### Channels

Notifications can be organized into channels via `data.channel`. Channels are **auto-created** when HA first sends a notification with that channel ID. Each channel can be individually:

- Enabled / disabled
- Assigned a custom sound
- Assigned a priority override

Channel settings persist in `~/.config/ha-linux-companion/channels.json` and are configurable from the overlay menu.

## Building

```bash
npm run dist
```

## License

MIT

# v2.2.0 — Auto-Reconnect + Kiosk Status Bar

## 🆕 Features

### 🔄 Auto-Reconnect (Health Monitor)
- Companion automatically reconnects when HA or the server restarts
- Pings HA every 60s (normal) or 10s (when offline)
- On reconnect: refreshes token, reloads dashboard, restarts sensors, reconnects WebSocket

### 📊 Kiosk Status Bar
- Professional top bar replaces the floating ⚙ gear button
- Shows: clock, date, CPU temp, device name, settings gear
- Auto-hides after 5 seconds — reappears on top-edge touch/mouse
- Settings panel opens via gear tap or right-edge swipe
- 50px height with 40×40 touch-friendly gear button

## 🐛 Bug Fixes
- Companion no longer gets stuck on error page after HA restart
- WebSocket reconnects properly with token refresh

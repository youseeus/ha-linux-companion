# Release Notes

## v2.5.0 (2026-06-08)

### Bug Fixes
- **WS reconnect storm** — when HA returns 502, the companion no longer opens 15-20 parallel WebSocket connections. Added `wsConnecting` guard and `cleanupWs()` to ensure single-connection reconnect.
- **Dashboard shows login page after HA restart** — `loadDashboard()` now reloads config from disk (`config = loadConfig()`) and uses `auth.getAccessToken()` instead of stale `config.token` for localStorage injection.
- **WebView stuck on HA login page** — added `did-navigate` listener that detects HA `/auth/authorize`, `/auth/login`, `/auth/token` URLs and auto-reloads the dashboard with a fresh token after 1 second.
- **HA 2026.6.x sensor payload breaking change** — `register_sensor` now sends `unique_id` + `state` + `type` + `name` + `icon` only (no `device_class`, `state_class`, `unit_of_measurement`). `update_sensor_states` strips to `unique_id` + `state` + `type`.

### Compatibility
- Home Assistant 2026.6.x (required due to mobile_app webhook API changes)
- Home Assistant 2025.x and earlier may still work but sensor registration behavior differs

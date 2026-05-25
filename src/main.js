/**
 * HA Linux Companion — Electron Main Process
 * Professional Home Assistant companion for Linux panels
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, shell, dialog, screen, Notification } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const si = require('systeminformation');

// ── Config ──
const CONFIG_DIR = path.join(os.homedir(), '.config', 'ha-linux-companion');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const APP_VERSION = app.getVersion();

let mainWindow = null;
let tray = null;
let sensorInterval = null;
let config = null;

// ── Config Management ──
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureConfigDir();
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch { return {}; }
  }
  return {};
}

function saveConfig(data) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

// ── HA API Client ──
class HAClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.deviceId = null;
    this.webhookId = null;
  }

  async request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(this.baseUrl);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;

      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: path,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        rejectUnauthorized: false,
      };

      if (this.token && !headers.Authorization) {
        options.headers['Authorization'] = `Bearer ${this.token}`;
      }

      const req = lib.request(options, (res) => {
        let chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          try {
            resolve({ status: res.statusCode, data: JSON.parse(raw), headers: res.headers });
          } catch {
            resolve({ status: res.statusCode, data: raw, headers: res.headers });
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(new Error('Connection timeout')); });

      if (body) {
        const data = typeof body === 'string' ? body : JSON.stringify(body);
        req.write(data);
      }
      req.end();
    });
  }

  // ── Auth Flow: Username + Password (+ optional 2FA) ──
  async initiateAuth() {
    const res = await this.request('POST', '/auth/login_flow', {
      client_id: `${this.baseUrl}/`,
      handler: ['homeassistant', null],
      redirect_uri: `${this.baseUrl}/?auth_callback=1`,
    });
    return res;
  }

  async submitPassword(flowId, username, password) {
    const res = await this.request('POST', `/auth/login_flow/${flowId}`, {
      client_id: `${this.baseUrl}/`, username: username, password: password,
    });
    return res;
  }

  async submitMfaCode(flowId, mfaCode) {
    const res = await this.request('POST', `/auth/login_flow/${flowId}`, {
      client_id: `${this.baseUrl}/`, user_code: mfaCode,
    });
    return res;
  }

  async exchangeCodeForToken(code) {
    const res = await this.request('POST', '/auth/token',
      `grant_type=authorization_code&code=${encodeURIComponent(code)}&client_id=${encodeURIComponent(this.baseUrl + '/')}`,
      { 'Content-Type': 'application/x-www-form-urlencoded' }
    );
    return res;
  }

  // Refresh the access token using a stored refresh token
  async refreshAccessToken(refreshToken) {
    try {
      const res = await this.request('POST', '/auth/token',
        `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
        { 'Content-Type': 'application/x-www-form-urlencoded' }
      );
      if (res.status === 200 && res.data.access_token) {
        log('[AUTH] Token refreshed successfully');
        this.token = res.data.access_token;
        return { token: res.data.access_token, refresh_token: res.data.refresh_token || refreshToken, expires_in: res.data.expires_in };
      }
      log('[AUTH] Token refresh failed: ' + res.status);
    } catch (e) {
      log('[AUTH] Token refresh error: ' + e.message);
    }
    return null;
  }

  async registerDevice(deviceName) {
    // Stable deviceId from MAC address — prevents duplicate registrations
    if (!this.deviceId) {
      const mac = getMacAddress();
      this.deviceId = crypto.createHash('sha256').update(mac || os.hostname()).digest('hex').substring(0, 32);
    }
    const deviceId = this.deviceId;
    this.deviceId = deviceId;
    try {
      const res = await this.request('POST', '/api/mobile_app/registrations',
        JSON.stringify({
          device_name: deviceName || os.hostname(),
          app_id: 'io.homeassistant.linux-companion',
          app_name: 'HA Linux Companion',
          app_version: APP_VERSION,
          os_name: 'Linux', os_version: os.release(),
          manufacturer: 'Raspberry Pi',
          model: os.hostname(),
          device_id: deviceId,
          supports_encryption: false,
          app_data: {
            push_url: `http://${getLocalIP()}:0/notify`,
            push_token: 'pending',
            push_websocket_channel: true,
          },
        }),
        { 'Content-Type': 'application/json' }
      );
      if (res.status === 201 && res.data) {
        this.webhookId = res.data.webhook_id || res.data.webhookId;
        this.cloudhookUrl = res.data.cloudhook_url || res.data.cloudhookUrl;
        log('[REG] status: ' + res.status + ' data: ' + JSON.stringify(res.data));
        return true;
      }
      log('[REG] failed: ' + res.status + ' ' + JSON.stringify(res.data));
    } catch (e) {
      log('[REG] error: ' + e.message);
    }
    return false;
  }

  async webhook(type, data = {}) {
    if (!this.webhookId) return null;
    try {
      const res = await this.request('POST',
        `/api/webhook/${this.webhookId}`,
        JSON.stringify({ type, data }),
        { 'Content-Type': 'application/json' }
      );
      log('[WEBHOOK] ' + type + ': ' + res.status);
      return res;
    } catch (e) {
      log('[WEBHOOK] error: ' + e.message);
      return null;
    }
  }

  async updateSensors(sensors) {
    if (!this.webhookId) return;
    for (const sensor of sensors) {
      await this.webhook('register_sensor', sensor);
    }
    await this.webhook('update_sensor_states', sensors);
  }

  async updatePushUrl(pushUrl, pushToken) {
    if (!this.webhookId) return;
    try {
      const result = await this.webhook('update_registration', {
        app_data: { push_url: pushUrl, push_token: pushToken, push_websocket_channel: true },
      });
      log('[PushNotify] Updated push_url: ' + pushUrl + ' -> ' + JSON.stringify(result?.data));
      return true;
    } catch (e) {
      log('[PushNotify] Failed to update push_url: ' + e.message);
      return false;
    }
  }
}

let haClient = null;

// ── Sensors ──
const LOG_FILE = path.join(os.homedir(), '.config', 'ha-linux-companion', 'app.log');
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(line.trim());
}

async function collectSensors() {
  const sensors = [];
  try {
    try { const t = parseFloat(fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8')) / 1000; sensors.push({ unique_id: 'cpu_temperature', state: t.toFixed(1), type: 'sensor', name: 'CPU Temperature', unit_of_measurement: '\u00b0C', device_class: 'temperature', state_class: 'measurement' }); } catch (e) {}
    try { const cpu = await si.currentLoad(); sensors.push({ unique_id: 'cpu_usage', state: cpu.currentLoad.toFixed(1), type: 'sensor', name: 'CPU Usage', unit_of_measurement: '%', state_class: 'measurement' }); } catch (e) {}
    try { const mem = await si.mem(); sensors.push({ unique_id: 'ram_usage', state: ((mem.used / mem.total) * 100).toFixed(1), type: 'sensor', name: 'RAM Usage', unit_of_measurement: '%', state_class: 'measurement' }); sensors.push({ unique_id: 'ram_free_mb', state: (mem.available / 1048576).toFixed(0), type: 'sensor', name: 'RAM Free', unit_of_measurement: 'MB', state_class: 'measurement' }); } catch (e) {}
    try { const disk = await si.fsSize(); const root = disk.find(d => d.mount === '/') || disk[0]; if (root) sensors.push({ unique_id: 'disk_usage', state: root.use.toFixed(1), type: 'sensor', name: 'Disk Usage', unit_of_measurement: '%', state_class: 'measurement' }); } catch (e) {}
    const upSec = os.uptime();
    sensors.push({ unique_id: 'system_uptime', state: Math.floor(upSec / 86400) + 'd ' + Math.floor((upSec % 86400) / 3600) + 'h', type: 'sensor', name: 'System Uptime', icon: 'mdi:clock' });
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) { for (const n of nets[name]) { if (n.family === 'IPv4' && !n.internal && (name.startsWith('eth') || name.startsWith('wlan') || name.startsWith('end'))) sensors.push({ unique_id: 'ip_address', state: n.address, type: 'sensor', name: 'IP Address', icon: 'mdi:ip-network' }); } }
    sensors.push({ unique_id: 'display_state', state: mainWindow && !mainWindow.isDestroyed() ? 'on' : 'off', type: 'binary_sensor', name: 'Display', device_class: 'power' });
  } catch (err) { log('Sensor error: ' + err.message); }
  return sensors;
}

async function startSensorUpdates() {
  if (sensorInterval) clearInterval(sensorInterval);
  log('[Sensors] Starting updates, webhookId: ' + (haClient ? haClient.webhookId : 'null'));
  const update = async () => {
    if (!haClient || !haClient.webhookId) return;
    try { const s = await collectSensors(); if (s.length > 0) { await haClient.updateSensors(s); log('[Sensors] ' + s.length + ' updated'); } } catch (err) { log('[Sensors] Error: ' + err.message); }
  };
  await update();
  sensorInterval = setInterval(update, 60000);
}

function stopSensorUpdates() { if (sensorInterval) { clearInterval(sensorInterval); sensorInterval = null; } }

// ── Window ──
function createMainWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({ width: config.windowWidth || screenWidth, height: config.windowHeight || screenHeight, fullscreen: config.fullscreen !== false, autoHideMenuBar: true, icon: path.join(__dirname, '..', 'assets', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true }, show: false });
  mainWindow.once('ready-to-show', () => { mainWindow.show(); if (config.fullscreen !== false) mainWindow.setFullScreen(true); });
  loadAppView();
  mainWindow.on('closed', () => { mainWindow = null; });
}

function loadAppView() { if (!mainWindow || mainWindow.isDestroyed()) return; if (config.url && config.token) loadDashboard(); else loadLoginView(); }
function loadLoginView() { mainWindow.loadFile(path.join(__dirname, 'views', 'login.html')); }

let dashboardLoaded = false, authInjected = false;

function loadDashboard() {
  if (!config.url) return;
  const haUrl = config.url.replace(/\/+$/, '');
  dashboardLoaded = false; authInjected = false;
  mainWindow.loadURL(haUrl, { userAgent: 'HA-Linux-Companion/' + APP_VERSION + ' (Linux; ' + os.hostname() + ')' });
  mainWindow.webContents.removeAllListeners('did-finish-load');
  mainWindow.webContents.on('did-finish-load', () => {
    if (authInjected) return;
    authInjected = true;
    const injectCode = '(function() { var tokens = { hassUrl: "' + haUrl + '", clientId: null, expires: ' + (Date.now() + 86400000) + ', refresh_token: false, access_token: "' + config.token + '", expires_in: 86400, token_type: "Bearer" }; localStorage.setItem("hassTokens", JSON.stringify(tokens)); return true; })()';
    mainWindow.webContents.executeJavaScript(injectCode).then(() => {
      dashboardLoaded = false;
      mainWindow.webContents.on('did-finish-load', function onLoad() {
        if (dashboardLoaded) return;
        dashboardLoaded = true;
        mainWindow.webContents.removeListener('did-finish-load', onLoad);
        mainWindow.webContents.insertCSS('ha-sidebar { display: none !important; } hui-root { --sidebar-width: 0px !important; }');
        try { mainWindow.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, 'views', 'overlay.js'), 'utf8')); } catch (e) {}
        if (haClient) startSensorUpdates();
        connectNotifications();
      });
      mainWindow.webContents.reload();
    });
  });
}

// ── Utility ──
function getLocalIP() { const nets = os.networkInterfaces(); for (const name of Object.keys(nets)) { for (const n of nets[name]) { if (n.family === 'IPv4' && !n.internal && (name.startsWith('eth') || name.startsWith('wlan') || name.startsWith('end'))) return n.address; } } return '127.0.0.1'; }
function getMacAddress() { const nets = os.networkInterfaces(); for (const name of Object.keys(nets)) { for (const n of nets[name]) { if (n.family === 'IPv4' && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00') return n.mac; } } return null; }

// ── Push Notification Server ──
let pushServer = null, pushPort = 0, pushToken = crypto.randomBytes(16).toString('hex');

function startPushServer() {
  if (pushServer) return;
  pushServer = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.push_token && data.push_token !== pushToken) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid push token' })); return; }
        showNotification(data.title || 'Home Assistant', data.message || '');
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true }));
      } catch (e) { res.writeHead(400); res.end(); }
    });
  });
  pushServer.listen(0, '0.0.0.0', () => { pushPort = pushServer.address().port; log('[PushNotify] Server listening on 0.0.0.0:' + pushPort); });
}
function stopPushServer() { if (pushServer) { pushServer.close(); pushServer = null; pushPort = 0; } }

// ── WebSocket Notifications ──
let haWs = null, wsReconnectTimer = null;

function connectNotifications() {
  if (!config.url || !config.token) return;
  const wsUrl = config.url.replace(/\/+$/, '').replace(/^http/, 'ws') + '/api/websocket';
  log('[WS] Connecting to ' + wsUrl);
  const WebSocket = require('ws');
  try { haWs = new WebSocket(wsUrl, { rejectUnauthorized: false }); } catch (e) { return; }
  haWs.on('open', () => { haWs.send(JSON.stringify({ type: 'auth', access_token: config.token })); log('[WS] Connected'); });
  haWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'auth_ok') {
        haWs.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'persistent_notifications_updated' }));
        if (config.webhookId) { haWs.send(JSON.stringify({ id: 2, type: 'mobile_app/push_notification_channel', webhook_id: config.webhookId, support_confirm: true })); log('[WS] Subscribed to push notification channel'); }
        log('[WS] Authenticated');
      }
      if (msg.type === 'event' && msg.event) {
        const ev = msg.event;
        if (ev.message !== undefined || ev.title !== undefined) {
          showNotification(ev.title || 'Home Assistant', ev.message || '');
          if (ev.hass_confirm_id) haWs.send(JSON.stringify({ id: 3, type: 'mobile_app/push_notification_confirm', webhook_id: config.webhookId, confirm_id: ev.hass_confirm_id }));
          return;
        }
        if (ev.event_type === 'persistent_notifications_updated' && ev.data) { for (const [, n] of Object.entries(ev.data)) { if (n.title || n.message) showNotification(n.title || 'Home Assistant', n.message || ''); } }
      }
    } catch (e) {}
  });
  haWs.on('close', () => { log('[WS] Disconnected, reconnecting in 10s'); wsReconnectTimer = setTimeout(connectNotifications, 10000); });
  haWs.on('error', (err) => { log('[WS] Error: ' + err.message); });
}

// ── Notification System ──
const NOTIFICATION_THEMES = { default: { accent: '#0A84FF', icon: '\ud83d\udd14', sound: 'default' }, success: { accent: '#30D158', icon: '\u2705', sound: 'success' }, warning: { accent: '#FFD60A', icon: '\u26a0\ufe0f', sound: 'warning' }, error: { accent: '#FF453A', icon: '\u274c', sound: 'error' }, info: { accent: '#64D2FF', icon: '\u2139\ufe0f', sound: 'default' } };
const SOUND_GENERATORS = { default: '(function(ctx){var o=ctx.createOscillator();var g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.setValueAtTime(880,ctx.currentTime);o.frequency.exponentialRampToValueAtTime(440,ctx.currentTime+0.15);g.gain.setValueAtTime(0.3,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.3);o.start(ctx.currentTime);o.stop(ctx.currentTime+0.3);})', success: '(function(ctx){var o=ctx.createOscillator();var g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.setValueAtTime(523,ctx.currentTime);o.frequency.setValueAtTime(659,ctx.currentTime+0.1);o.frequency.setValueAtTime(784,ctx.currentTime+0.2);g.gain.setValueAtTime(0.3,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.5);o.start(ctx.currentTime);o.stop(ctx.currentTime+0.5);})', warning: '(function(ctx){var o=ctx.createOscillator();var g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.type="square";o.frequency.setValueAtTime(600,ctx.currentTime);o.frequency.setValueAtTime(400,ctx.currentTime+0.15);o.frequency.setValueAtTime(600,ctx.currentTime+0.3);g.gain.setValueAtTime(0.2,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.5);o.start(ctx.currentTime);o.stop(ctx.currentTime+0.5);})', error: '(function(ctx){var o=ctx.createOscillator();var g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.type="sawtooth";o.frequency.setValueAtTime(300,ctx.currentTime);o.frequency.exponentialRampToValueAtTime(150,ctx.currentTime+0.4);g.gain.setValueAtTime(0.3,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.5);o.start(ctx.currentTime);o.stop(ctx.currentTime+0.5);})' };

const notifHistory = [];
function addToHistory(title, message) { notifHistory.unshift({ title, message, time: new Date().toISOString() }); if (notifHistory.length > 50) notifHistory.pop(); }

function showNotification(title, message, options = {}) {
  const theme = NOTIFICATION_THEMES[options.theme] || NOTIFICATION_THEMES.default;
  const duration = options.duration || 6000;
  log('[Notify] ' + title + ': ' + message);
  addToHistory(title, message);
  try {
    const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
    const pw = 340, ph = 110, px = sw - pw - 16, py = 40;
    const accent = theme.accent, icon = options.icon || theme.icon;
    const soundGen = SOUND_GENERATORS[options.sound || theme.sound] || SOUND_GENERATORS.default;
    const safeTitle = title.replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const safeMsg = message.replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const nw = new BrowserWindow({ x: px, y: py, width: pw, height: ph, frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    nw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box}body{background:transparent;overflow:hidden;font-family:-apple-system,sans-serif}.c{background:rgba(28,28,30,0.96);color:#fff;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.5);overflow:hidden;animation:in .35s cubic-bezier(.16,1,.3,1);cursor:pointer}.a{height:3px;background:' + accent + '}.b{padding:14px 18px 10px;display:flex;align-items:flex-start;gap:10px}.i{font-size:20px;flex-shrink:0}.t{font-weight:600;font-size:13.5px;line-height:1.3;margin-bottom:2px}.m{color:#ababab;font-size:12.5px;line-height:1.4;word-break:break-word}@keyframes in{from{opacity:0;transform:translateX(50px)}to{opacity:1;transform:translateX(0)}}@keyframes out{from{opacity:1}to{opacity:0;transform:translateX(50px)}}</style></head><body><div class="c" id="c"><div class="a"></div><div class="b"><span class="i">' + icon + '</span><div><div class="t">' + safeTitle + '</div><div class="m">' + safeMsg + '</div></div></div></div><script>try{var ctx=new(window.AudioContext||window.webkitAudioContext)();(' + soundGen + ')(ctx)}catch(e){}document.getElementById("c").onclick=function(){document.getElementById("c").style.animation="out .25s ease forwards";setTimeout(function(){window.close()},260)};setTimeout(function(){document.getElementById("c").style.animation="out .25s ease forwards";setTimeout(function(){window.close()},260)},' + duration + ')</script></body></html>'));
    nw.showInactive();
  } catch(e) { log('[Notify] Error: ' + e.message); }
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, '..', 'assets', 'icon.png'));
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Dashboard', click: () => { if (mainWindow) mainWindow.show(); } },
      { label: 'Reload', click: () => { if (mainWindow) mainWindow.webContents.reload(); } },
      { type: 'separator' },
      { label: 'Toggle Fullscreen', click: () => { if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen()); } },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray.setToolTip('HA Linux Companion');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => { if (mainWindow) mainWindow.show(); });
  } catch (err) { console.log('Tray not available:', err.message); }
}

// ── IPC Handlers ──
ipcMain.handle('get-config', () => config);

ipcMain.handle('connect', async (event, { url: haUrl, token, deviceName }) => {
  try {
    haUrl = haUrl.replace(/\/+$/, '');
    const client = new HAClient(haUrl, token);
    const test = await client.request('GET', '/api/');
    if (test.status !== 200) return { success: false, error: 'Connection failed: HTTP ' + test.status };
    const registered = await client.registerDevice(deviceName || os.hostname());
    config = { url: haUrl, token: client.token || token, deviceName: deviceName || os.hostname(), deviceId: client.deviceId, webhookId: client.webhookId, registered, fullscreen: true };
    saveConfig(config); haClient = client;
    if (registered) startSensorUpdates();
    loadDashboard(); return { success: true, registered };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('toggle-fullscreen', () => { if (mainWindow) { mainWindow.setFullScreen(!mainWindow.isFullScreen()); config.fullscreen = mainWindow.isFullScreen(); saveConfig(config); return mainWindow.isFullScreen(); } return false; });
ipcMain.handle('get-sensors', async () => collectSensors());
ipcMain.handle('get-version', () => APP_VERSION);
ipcMain.handle('get-notification-history', () => notifHistory);

const { execSync } = require('child_process');
function runShell(cmd) { try { return execSync(cmd, { timeout: 5000 }).toString().trim(); } catch (e) { return ''; } }

ipcMain.handle('set-volume', (e, vol) => { runShell('amixer set Master ' + vol + '%'); return true; });
ipcMain.handle('set-mute', (e, muted) => { runShell('amixer set Master ' + (muted ? 'mute' : 'unmute')); return true; });
ipcMain.handle('set-brightness', (e, val) => { runShell('ddcutil setvcp 10 ' + val + ' --sleep-multiplier 0.1 2>/dev/null'); try { const blPath = '/sys/class/backlight/rpi-backlight/brightness'; if (fs.existsSync(blPath)) { const maxBright = parseInt(fs.readFileSync('/sys/class/backlight/rpi-backlight/max_brightness', 'utf8').trim()); fs.writeFileSync(blPath, Math.round((val / 100) * maxBright).toString()); } } catch (e) {} return true; });
ipcMain.handle('bluetooth-scan', async () => { const out = runShell('bluetoothctl --timeout 5 scan on 2>/dev/null; bluetoothctl devices 2>/dev/null'); if (!out) return []; return out.split('\n').map(l => { const m = l.match(/Device ([0-9A-F:]+) (.+)/i); return m ? { mac: m[1], name: m[2] } : null; }).filter(Boolean); });
ipcMain.handle('bluetooth-connect', (e, mac) => { runShell('bluetoothctl trust ' + mac + ' && bluetoothctl connect ' + mac); return true; });
ipcMain.handle('get-system-info', () => { let vol = 50; const m = runShell('amixer get Master 2>/dev/null').match(/\[(\d+)%\]/); if (m) vol = parseInt(m[1]); return { volume: vol, brightness: 100, hasBacklight: fs.existsSync('/sys/class/backlight/rpi-backlight/brightness') || runShell('ddcutil detect 2>/dev/null').includes('Display'), deviceName: config ? config.deviceName : 'Unknown', version: 'v' + APP_VERSION, sensors: config && config.registered ? 'active' : 'inactive' }; });
ipcMain.handle('logout', () => { stopSensorUpdates(); try { fs.unlinkSync(CONFIG_FILE); } catch (e) {} config = {}; haClient = null; if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.removeAllListeners('did-finish-load'); mainWindow.loadFile(path.join(__dirname, 'views', 'login.html')); } return true; });
ipcMain.handle('quit', () => app.quit());

ipcMain.handle('login-with-credentials', async (event, { url: haUrl, username, password, deviceName }) => {
  try {
    haUrl = haUrl.replace(/\/+$/, '');
    const client = new HAClient(haUrl, null);
    const init = await client.initiateAuth();
    if (init.status !== 200 || !init.data.flow_id) return { success: false, error: 'Auth init failed: ' + init.status };
    const flowId = init.data.flow_id;
    const result = await client.submitPassword(flowId, username, password);
    if (result.status === 200 && result.data.type === 'create_entry') {
      const tokenRes = await client.exchangeCodeForToken(result.data.result);
      if (tokenRes.status === 200 && tokenRes.data.access_token) {
        const token = tokenRes.data.access_token;
        const refreshToken = tokenRes.data.refresh_token || null;
        client.token = token;
        const registered = await client.registerDevice(deviceName || os.hostname());
        config = { url: haUrl, token: client.token || token, refreshToken, tokenExpires: tokenRes.data.expires_in ? Date.now() + tokenRes.data.expires_in * 1000 : null, deviceName: deviceName || os.hostname(), deviceId: client.deviceId, webhookId: client.webhookId, registered, fullscreen: true };
        saveConfig(config); haClient = client;
        if (registered) startSensorUpdates();
        loadDashboard(); return { success: true, registered };
      }
      return { success: false, error: 'Token exchange failed' };
    }
    if (result.data.errors) return { success: false, error: result.data.errors.base || result.data.errors.password || 'Invalid credentials' };
    if (result.data.step && (result.data.step.id === 'mfa' || result.data.type === 'form')) return { mfa_required: true, flow_id: flowId, flow_type: result.data.step?.type || 'totp', providers: result.data.step?.data || [] };
    return { success: false, error: 'Unexpected: ' + result.status };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('submit-mfa', async (event, { url: haUrl, flowId, mfaCode }) => {
  try {
    const client = new HAClient(haUrl.replace(/\/+$/, ''), null);
    const result = await client.submitMfaCode(flowId, mfaCode);
    if (result.status === 200 && result.data.type === 'create_entry') {
      const tokenRes = await client.exchangeCodeForToken(result.data.result);
      if (tokenRes.status === 200 && tokenRes.data.access_token) {
        client.token = tokenRes.data.access_token;
        const registered = await client.registerDevice(os.hostname());
        config = { url: haUrl.replace(/\/+$/, ''), token: client.token || tokenRes.data.access_token, refreshToken: tokenRes.data.refresh_token || null, tokenExpires: tokenRes.data.expires_in ? Date.now() + tokenRes.data.expires_in * 1000 : null, deviceName: os.hostname(), deviceId: client.deviceId, webhookId: client.webhookId, registered, fullscreen: true };
        saveConfig(config); haClient = client;
        loadDashboard(); return { success: true, registered };
      }
      return { success: false, error: 'Token exchange failed' };
    }
    if (result.data.errors) return { success: false, error: result.data.errors.code || 'Invalid code' };
    return { success: false, error: 'Unexpected: ' + result.status };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.on('quit', () => app.quit());

// ── App Lifecycle ──
app.whenReady().then(async () => {
  config = loadConfig();
  startPushServer();
  if (config.url && config.token) {
    if (config.tokenExpires && Date.now() > config.tokenExpires && config.refreshToken) {
      log('[AUTH] Token expired, refreshing...');
      const tempClient = new HAClient(config.url, config.token);
      const refreshed = await tempClient.refreshAccessToken(config.refreshToken);
      if (refreshed) { config.token = refreshed.token; if (refreshed.refresh_token) config.refreshToken = refreshed.refresh_token; config.tokenExpires = refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : null; saveConfig(config); log('[AUTH] Token refreshed and saved'); }
      else { log('[AUTH] Token refresh failed, will re-login'); config = {}; saveConfig(config); }
    }
    if (config.url && config.token) {
      haClient = new HAClient(config.url, config.token);
      if (config.deviceId) haClient.deviceId = config.deviceId;
      if (config.webhookId) haClient.webhookId = config.webhookId;
      const waitForPushServer = setInterval(() => { if (pushPort > 0 && haClient) { clearInterval(waitForPushServer); haClient.updatePushUrl('http://' + getLocalIP() + ':' + pushPort + '/notify', pushToken); } }, 500);
      setTimeout(() => clearInterval(waitForPushServer), 10000);
    }
  }
  createMainWindow();
  createTray();
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => { stopSensorUpdates(); stopPushServer(); });
app.commandLine.appendSwitch('ignore-certificate-errors');

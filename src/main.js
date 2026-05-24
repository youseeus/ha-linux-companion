/**
 * HA Linux Companion — Electron Main Process
 * Professional Home Assistant companion for Linux panels
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, shell, dialog, screen, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const si = require('systeminformation');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'ha-linux-companion');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const APP_VERSION = app.getVersion();

let mainWindow = null;
let tray = null;
let sensorInterval = null;
let config = null;

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function loadConfig() {
  ensureConfigDir();
  if (fs.existsSync(CONFIG_FILE)) {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
  }
  return {};
}

function saveConfig(data) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

const LOG_FILE = path.join(CONFIG_DIR, 'app.log');
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

// ── HA API Client ──
class HAClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.deviceId = null;
    this.webhookId = null;
  }

  async request(method, reqPath, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(this.baseUrl);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: reqPath, method,
        headers: { 'Content-Type': 'application/json', ...headers },
        rejectUnauthorized: false,
      };
      if (this.token && !headers.Authorization) options.headers['Authorization'] = `Bearer ${this.token}`;
      const req = lib.request(options, (res) => {
        let chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, data: raw }); }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('Connection timeout')));
      if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      req.end();
    });
  }

  async initiateAuth() {
    return this.request('POST', '/auth/login_flow', {
      client_id: `${this.baseUrl}/`, handler: ['homeassistant', null],
      redirect_uri: `${this.baseUrl}/?auth_callback=1`,
    });
  }

  async submitPassword(flowId, username, password) {
    return this.request('POST', `/auth/login_flow/${flowId}`, {
      client_id: `${this.baseUrl}/`, username, password,
    });
  }

  async submitMfaCode(flowId, mfaCode) {
    return this.request('POST', `/auth/login_flow/${flowId}`, {
      client_id: `${this.baseUrl}/`, user_code: mfaCode,
    });
  }

  async exchangeCodeForToken(code) {
    return this.request('POST', '/auth/token',
      `grant_type=authorization_code&code=${encodeURIComponent(code)}&client_id=${encodeURIComponent(this.baseUrl + '/')}`,
      { 'Content-Type': 'application/x-www-form-urlencoded' }
    );
  }

  async webhook(type, data) {
    if (!this.webhookId) return null;
    return this.request('POST', `/api/webhook/${this.webhookId}`, { type, data });
  }

  async registerDevice(name = 'HA Linux Companion') {
    const deviceId = crypto.randomUUID();
    try {
      const res = await this.request('POST', '/api/mobile_app/registrations', {
        device_name: name, app_name: 'HA Linux Companion', app_id: 'ha-linux-companion',
        app_version: APP_VERSION, device_id: deviceId,
        os_name: 'Linux', os_version: os.type() + ' ' + os.release(),
        manufacturer: 'Linux', model: os.arch() + ' ' + os.hostname(),
        supports_encryption: false,
      });
      log('[REG] status: ' + res.status);
      if ((res.status === 200 || res.status === 201) && res.data && res.data.webhook_id) {
        this.deviceId = deviceId;
        this.webhookId = res.data.webhook_id;
        if (res.data.access_token) this.token = res.data.access_token;
        return true;
      }
      log('[REG] FAILED: ' + res.status);
      return false;
    } catch (err) { log('[REG] ERROR: ' + err.message); return false; }
  }

  async updateSensors(sensors) {
    if (!this.webhookId) return;
    for (const s of sensors) await this.webhook('register_sensor', s);
    await this.webhook('update_sensor_states', sensors);
  }
}

let haClient = null;

// ── Sensors ──
async function collectSensors() {
  const sensors = [];
  try {
    try {
      const t = parseFloat(fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8')) / 1000;
      sensors.push({ unique_id: 'cpu_temperature', state: t.toFixed(1), type: 'sensor', name: 'CPU Temperature', unit_of_measurement: '°C', device_class: 'temperature', state_class: 'measurement' });
    } catch (e) {}
    try {
      const cpu = await si.currentLoad();
      sensors.push({ unique_id: 'cpu_usage', state: cpu.currentLoad.toFixed(1), type: 'sensor', name: 'CPU Usage', unit_of_measurement: '%', state_class: 'measurement' });
    } catch (e) {}
    try {
      const mem = await si.mem();
      sensors.push({ unique_id: 'ram_usage', state: ((mem.used / mem.total) * 100).toFixed(1), type: 'sensor', name: 'RAM Usage', unit_of_measurement: '%', state_class: 'measurement' });
      sensors.push({ unique_id: 'ram_free_mb', state: (mem.available / 1048576).toFixed(0), type: 'sensor', name: 'RAM Free', unit_of_measurement: 'MB', state_class: 'measurement' });
    } catch (e) {}
    try {
      const disk = await si.fsSize();
      const root = disk.find(d => d.mount === '/') || disk[0];
      if (root) sensors.push({ unique_id: 'disk_usage', state: root.use.toFixed(1), type: 'sensor', name: 'Disk Usage', unit_of_measurement: '%', state_class: 'measurement' });
    } catch (e) {}
    const upSec = os.uptime();
    sensors.push({ unique_id: 'system_uptime', state: Math.floor(upSec / 86400) + 'd ' + Math.floor((upSec % 86400) / 3600) + 'h', type: 'sensor', name: 'System Uptime', icon: 'mdi:clock' });
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const n of nets[name]) {
        if (n.family === 'IPv4' && !n.internal && (name.startsWith('eth') || name.startsWith('wlan') || name.startsWith('end')))
          sensors.push({ unique_id: 'ip_address', state: n.address, type: 'sensor', name: 'IP Address', icon: 'mdi:ip-network' });
      }
    }
    sensors.push({ unique_id: 'display_state', state: mainWindow && !mainWindow.isDestroyed() ? 'on' : 'off', type: 'binary_sensor', name: 'Display', device_class: 'power' });
  } catch (err) { log('Sensor error: ' + err.message); }
  return sensors;
}

async function startSensorUpdates() {
  if (sensorInterval) clearInterval(sensorInterval);
  log('[Sensors] Starting, webhook: ' + (haClient ? haClient.webhookId : 'null'));
  const update = async () => {
    if (!haClient || !haClient.webhookId) return;
    try {
      const s = await collectSensors();
      if (s.length) { await haClient.updateSensors(s); log('[Sensors] ' + s.length + ' updated'); }
    } catch (err) { log('[Sensors] Error: ' + err.message); }
  };
  await update();
  sensorInterval = setInterval(update, 60000);
}

function stopSensorUpdates() { if (sensorInterval) { clearInterval(sensorInterval); sensorInterval = null; } }

// ── Window ──
function createMainWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: config.windowWidth || sw, height: config.windowHeight || sh,
    fullscreen: config.fullscreen !== false, autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true },
    show: false,
  });
  mainWindow.once('ready-to-show', () => { mainWindow.show(); if (config.fullscreen !== false) mainWindow.setFullScreen(true); });
  loadAppView();
  mainWindow.on('closed', () => { mainWindow = null; });
}

function loadAppView() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (config.url && config.token) loadDashboard(); else mainWindow.loadFile(path.join(__dirname, 'views', 'login.html'));
}

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
    const injectCode = '(function(){localStorage.setItem("hassTokens",JSON.stringify({hassUrl:"' + haUrl + '",clientId:null,expires:' + (Date.now() + 86400000) + ',refresh_token:false,access_token:"' + config.token + '",expires_in:86400,token_type:"Bearer"}));return true})()';
    mainWindow.webContents.executeJavaScript(injectCode).then(() => {
      dashboardLoaded = false;
      mainWindow.webContents.on('did-finish-load', function onLoad() {
        if (dashboardLoaded) return;
        dashboardLoaded = true;
        mainWindow.webContents.removeListener('did-finish-load', onLoad);
        mainWindow.webContents.insertCSS('ha-sidebar{display:none!important}hui-root{--sidebar-width:0!important}');
        try { mainWindow.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, 'views', 'overlay.js'), 'utf8')); } catch (e) {}
        if (haClient) startSensorUpdates();
        connectNotifications();
      });
      mainWindow.webContents.reload();
    });
  });
}

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
        haWs.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'call_service' }));
        haWs.send(JSON.stringify({ id: 2, type: 'subscribe_events', event_type: 'persistent_notifications_updated' }));
        log('[WS] Subscribed');
      }
      if (msg.type === 'event' && msg.event) {
        const ev = msg.event;
        if (ev.event_type === 'call_service' && ev.data && ev.data.domain === 'notify' && ev.data.service && ev.data.service.startsWith('mobile_app'))
          showNotification((ev.data.service_data || {}).title || 'HA', (ev.data.service_data || {}).message || '');
        if (ev.event_type === 'persistent_notifications_updated' && ev.data)
          for (const [, n] of Object.entries(ev.data)) { if (n.title || n.message) showNotification(n.title || 'Home Assistant', n.message || ''); }
      }
    } catch (e) {}
  });
  haWs.on('close', () => { log('[WS] Disconnected'); wsReconnectTimer = setTimeout(connectNotifications, 10000); });
  haWs.on('error', (err) => { log('[WS] Error: ' + err.message); });
}

function showNotification(title, message) {
  log('[Notify] ' + title + ': ' + message);
  if (Notification.isSupported()) new Notification({ title, body: message }).show();
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.executeJavaScript(`(function(){var n=document.createElement('div');n.style.cssText='position:fixed;top:60px;right:16px;z-index:999999;background:rgba(30,30,30,0.95);color:#fff;padding:14px 20px;border-radius:12px;max-width:280px;font-family:sans-serif;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,0.4);border:1px solid #3A3A3C;transition:opacity 0.3s;cursor:pointer';n.innerHTML='<div style="font-weight:600;margin-bottom:4px">'+${JSON.stringify(title)}+'</div><div style="color:#ABABAB;font-size:13px">'+${JSON.stringify(message)}+'</div>';document.body.appendChild(n);n.onclick=function(){n.style.opacity='0';setTimeout(function(){n.remove()},300)};setTimeout(function(){n.style.opacity='0';setTimeout(function(){n.remove()},300)},5000)})()`).catch(() => {});
}

// ── System Controls ──
const { execSync } = require('child_process');
function runShell(cmd) { try { return execSync(cmd, { timeout: 5000 }).toString().trim(); } catch (e) { return ''; } }

ipcMain.handle('set-volume', (e, v) => { runShell('amixer set Master ' + v + '%'); return true; });
ipcMain.handle('set-mute', (e, m) => { runShell('amixer set Master ' + (m ? 'mute' : 'unmute')); return true; });
ipcMain.handle('set-brightness', (e, v) => {
  runShell('ddcutil setvcp 10 ' + v + ' --sleep-multiplier 0.1 2>/dev/null');
  try { fs.writeFileSync('/sys/class/backlight/rpi-backlight/brightness', Math.round(v * 2.55).toString()); } catch (e) {}
  return true;
});
ipcMain.handle('bluetooth-scan', async () => {
  const out = runShell('bluetoothctl --timeout 5 scan on 2>/dev/null; bluetoothctl devices 2>/dev/null');
  if (!out) return [];
  return out.split('\n').map(l => { const m = l.match(/Device ([0-9A-F:]+) (.+)/i); return m ? { mac: m[1], name: m[2] } : null; }).filter(Boolean);
});
ipcMain.handle('bluetooth-connect', (e, mac) => { runShell('bluetoothctl trust ' + mac + ' && bluetoothctl connect ' + mac); return true; });
ipcMain.handle('get-system-info', () => {
  let vol = 50; const m = runShell('amixer get Master 2>/dev/null').match(/\[(\d+)%\]/);
  if (m) vol = parseInt(m[1]);
  return { volume: vol, brightness: 100, deviceName: config ? config.deviceName : '', version: 'v' + APP_VERSION, sensors: config && config.registered ? 'active' : 'inactive' };
});
ipcMain.handle('logout', () => {
  stopSensorUpdates(); try { fs.unlinkSync(CONFIG_FILE); } catch (e) {}
  config = {}; haClient = null;
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.removeAllListeners('did-finish-load'); mainWindow.loadFile(path.join(__dirname, 'views', 'login.html')); }
  return true;
});
ipcMain.handle('quit', () => app.quit());

// ── Auth ──
ipcMain.handle('login-with-credentials', async (event, { url: haUrl, username, password, deviceName }) => {
  try {
    haUrl = haUrl.replace(/\/+$/, '');
    const client = new HAClient(haUrl, null);
    const init = await client.initiateAuth();
    if (init.status !== 200 || !init.data.flow_id) return { success: false, error: 'Auth init failed: ' + init.status };
    const result = await client.submitPassword(init.data.flow_id, username, password);
    if (result.status === 200 && result.data.type === 'create_entry') {
      const tokenRes = await client.exchangeCodeForToken(result.data.result);
      if (tokenRes.status === 200 && tokenRes.data.access_token) {
        client.token = tokenRes.data.access_token;
        const registered = await client.registerDevice(deviceName || os.hostname());
        config = { url: haUrl, token: client.token || tokenRes.data.access_token, deviceName: deviceName || os.hostname(), deviceId: client.deviceId, webhookId: client.webhookId, registered, fullscreen: true };
        saveConfig(config); haClient = client;
        if (registered) startSensorUpdates();
        loadDashboard(); return { success: true, registered };
      }
      return { success: false, error: 'Token exchange failed' };
    }
    if (result.data.errors) return { success: false, error: result.data.errors.base || result.data.errors.password || 'Invalid credentials' };
    return { success: false, error: 'Unexpected: ' + result.status };
  } catch (err) { return { success: false, error: err.message }; }
});

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

ipcMain.handle('toggle-fullscreen', () => { if (mainWindow) { mainWindow.setFullScreen(!mainWindow.isFullScreen()); return mainWindow.isFullScreen(); } return false; });
ipcMain.handle('get-sensors', async () => collectSensors());
ipcMain.handle('get-version', () => APP_VERSION);
ipcMain.handle('get-config', () => config);

// ── App Lifecycle ──
app.whenReady().then(() => {
  config = loadConfig();
  if (config.url && config.token) {
    haClient = new HAClient(config.url, config.token);
    if (config.deviceId) haClient.deviceId = config.deviceId;
    if (config.webhookId) haClient.webhookId = config.webhookId;
  }
  createMainWindow();
  try { tray = new Tray(path.join(__dirname, '..', 'assets', 'icon.png')); tray.setToolTip('HA Linux Companion'); } catch (e) {}
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => stopSensorUpdates());
app.commandLine.appendSwitch('ignore-certificate-errors');

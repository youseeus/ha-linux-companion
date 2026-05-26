// HA Linux Companion — Settings Overlay
(function() {
  if (window.__haCompanionMenu) return;
  window.__haCompanionMenu = true;

  const style = document.createElement('style');
  style.textContent = `
    #ha-comp-toggle { position:fixed;top:12px;right:12px;z-index:99999;width:44px;height:44px;border-radius:22px;background:rgba(30,30,30,0.85);border:1px solid #555;color:#fff;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);transition:all 0.2s;box-shadow:0 2px 8px rgba(0,0,0,0.3); }
    #ha-comp-toggle:hover { background:rgba(60,60,60,0.95);transform:scale(1.1); }
    #ha-comp-panel { position:fixed;top:0;right:-320px;z-index:99998;width:300px;height:100vh;background:rgba(28,28,30,0.97);backdrop-filter:blur(20px);border-left:1px solid #3A3A3C;color:#fff;transition:right 0.3s ease;overflow-y:auto;font-family:-apple-system,sans-serif;padding:20px 16px;box-sizing:border-box; }
    #ha-comp-panel.open { right:0; }
    #ha-comp-panel h3 { font-size:15px;font-weight:600;color:#8E8E93;text-transform:uppercase;letter-spacing:0.5px;margin:20px 0 10px;padding-top:12px;border-top:1px solid #2C2C2E; }
    #ha-comp-panel h3:first-child { margin-top:0;border-top:none;padding-top:0; }
    .comp-row { display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #2C2C2E; }
    .comp-label { font-size:14px;color:#fff; }
    .comp-sub { font-size:11px;color:#8E8E93;margin-top:2px; }
    .comp-slider { -webkit-appearance:none;width:120px;height:4px;background:#3A3A3C;border-radius:2px;outline:none; }
    .comp-slider::-webkit-slider-thumb { -webkit-appearance:none;width:20px;height:20px;background:#4A90D9;border-radius:10px;cursor:pointer; }
    .comp-btn { padding:8px 16px;border-radius:8px;border:none;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:background 0.15s; }
    .comp-btn.danger { background:#FF3B30;color:#fff; }
    .comp-btn.danger:hover { background:#FF453A; }
    .comp-btn.primary { background:#4A90D9;color:#fff; }
    .comp-btn.secondary { background:#3A3A3C;color:#fff; }
    .comp-val { font-size:13px;color:#8E8E93;min-width:36px;text-align:right; }
    .comp-bt-item { display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #2C2C2E;font-size:13px; }
    .comp-close-panel { position:absolute;top:12px;right:12px;background:none;border:none;color:#8E8E93;font-size:20px;cursor:pointer; }
    .comp-header { display:flex;align-items:center;justify-content:space-between;margin-bottom:8px; }
    .comp-header-title { font-size:18px;font-weight:700; }
    .comp-version { font-size:11px;color:#636366; }
    #comp-backdrop { position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.3);z-index:99997;display:none; }
    #comp-backdrop.open { display:block; }
    .comp-toggle { position:relative;width:44px;height:26px;background:#3A3A3C;border-radius:13px;cursor:pointer;transition:background 0.2s;border:none;flex-shrink:0; }
    .comp-toggle.on { background:#30D158; }
    .comp-toggle::after { content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;background:#fff;border-radius:10px;transition:transform 0.2s; }
    .comp-toggle.on::after { transform:translateX(18px); }
    .comp-select { background:#2C2C2E;color:#fff;border:1px solid #3A3A3C;border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;min-width:100px; }
    .comp-notif-row { display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #2C2C2E;font-size:13px; }
    .comp-notif-row .comp-label { font-size:13px; }
    .comp-section-desc { font-size:11px;color:#636366;margin-bottom:8px; }
  `;
  document.head.appendChild(style);

  const toggle = document.createElement('button');
  toggle.id = 'ha-comp-toggle'; toggle.innerHTML = '⚙'; toggle.title = 'Settings';
  document.body.appendChild(toggle);

  const backdrop = document.createElement('div');
  backdrop.id = 'comp-backdrop'; document.body.appendChild(backdrop);

  const panel = document.createElement('div');
  panel.id = 'ha-comp-panel';
  panel.innerHTML = `
    <div class="comp-header"><span class="comp-header-title">HA Linux Companion</span><button class="comp-close-panel" id="comp-close">✕</button></div>
    <div class="comp-version" id="comp-version">v1.0.0</div>
    <h3>🔊 Audio</h3>
    <div class="comp-row"><div class="comp-label">Volume</div><div style="display:flex;align-items:center;gap:8px"><input type="range" class="comp-slider" id="comp-volume" min="0" max="100" value="50"><span class="comp-val" id="comp-volume-val">50%</span></div></div>
    <div class="comp-row"><div class="comp-label">Mute</div><button class="comp-btn secondary" id="comp-mute">Off</button></div>
    <h3>📶 Bluetooth</h3>
    <div class="comp-row"><div class="comp-label">Bluetooth</div><button class="comp-btn secondary" id="comp-bt-toggle">Scan</button></div>
    <div id="comp-bt-list"></div>
    <h3>☀️ Display</h3>
    <div class="comp-row" id="comp-brightness-row"><div class="comp-label">Brightness</div><div style="display:flex;align-items:center;gap:8px"><input type="range" class="comp-slider" id="comp-brightness" min="10" max="100" value="100"><span class="comp-val" id="comp-brightness-val">100%</span></div></div>
    <h3>📊 Device</h3>
    <div class="comp-row"><div><div class="comp-label" id="comp-device-name">Panel</div><div class="comp-sub" id="comp-sensor-info">Sensors: --</div></div></div>
    <h3>\uD83D\uDD14 Notifications</h3>
    <div class=\"comp-notif-row\"><div class=\"comp-label\">🔔 Notifiche</div><button class=\"comp-toggle\" id=\"comp-notif-enabled\"></button></div>
    <div class=\"comp-notif-row\"><div class=\"comp-label\">Suono</div><button class=\"comp-toggle on\" id=\"comp-notif-sound\"></button></div>
    <div class=\"comp-notif-row\"><div class=\"comp-label\">🌙 Non disturbare</div><button class=\"comp-toggle\" id=\"comp-notif-dnd\"></button></div>
    <div class=\"comp-notif-row\"><div class=\"comp-label\">Durata popup</div><select class=\"comp-select\" id=\"comp-notif-duration\"><option value=\"4000\">4 sec</option><option value=\"6000\" selected>6 sec</option><option value=\"10000\">10 sec</option><option value=\"0\">Mai</option></select></div>
    <div class=\"comp-notif-row\"><div class=\"comp-label\">Melodia</div><select class=\"comp-select\" id=\"comp-notif-melody\"><option value=\"default\">Default</option><option value=\"success\">Success</option><option value=\"warning\">Warning</option><option value=\"error\">Error</option></select></div>
    <div class=\"comp-section-desc\">Ultime notifiche</div>
    <div class=\"comp-row\"><div class=\"comp-label\" id=\"comp-notif-count\">Nessuna notifica</div><button class=\"comp-btn secondary\" id=\"comp-notif-clear\">Cancella</button></div>
    <div id=\"comp-notif-list\" style=\"max-height:200px;overflow-y:auto;\"></div>
    <h3>⚙ Actions</h3>
    <div class="comp-row"><button class="comp-btn secondary" id="comp-refresh">🔄 Reload</button></div>
    <div class="comp-row"><button class="comp-btn secondary" id="comp-fullscreen">⛶ Fullscreen</button></div>
    <div class="comp-row"><button class="comp-btn danger" id="comp-logout">Logout</button></div>
    <div class="comp-row"><button class="comp-btn danger" id="comp-quit">✕ Exit App</button></div>
  `;
  document.body.appendChild(panel);

  let open = false;
  function togglePanel() { open = !open; panel.classList.toggle('open', open); backdrop.classList.toggle('open', open); }
  toggle.addEventListener('click', togglePanel);
  backdrop.addEventListener('click', togglePanel);
  document.getElementById('comp-close').addEventListener('click', togglePanel);

  function ipc(name, data) { return window.haCompanion[name](data); }

  const volSlider = document.getElementById('comp-volume'), volVal = document.getElementById('comp-volume-val'), muteBtn = document.getElementById('comp-mute');
  volSlider.addEventListener('input', async () => { volVal.textContent = volSlider.value + '%'; await ipc('setVolume', parseInt(volSlider.value)); try{var c=new(window.AudioContext||window.webkitAudioContext)();var o=c.createOscillator();var g=c.createGain();o.connect(g);g.connect(c.destination);o.frequency.setValueAtTime(600,c.currentTime);g.gain.setValueAtTime(0.15,c.currentTime);g.gain.exponentialRampToValueAtTime(0.01,c.currentTime+0.1);o.start(c.currentTime);o.stop(c.currentTime+0.1)}catch(e){} });
  muteBtn.addEventListener('click', async () => { const m = muteBtn.textContent === 'Off'; muteBtn.textContent = m ? 'On' : 'Off'; muteBtn.style.background = m ? '#FF3B30' : '#3A3A3C'; await ipc('setMute', m); });

  const brightSlider = document.getElementById('comp-brightness'), brightVal = document.getElementById('comp-brightness-val');
  brightSlider.addEventListener('input', async () => { brightVal.textContent = brightSlider.value + '%'; await ipc('setBrightness', parseInt(brightSlider.value)); });

  const btBtn = document.getElementById('comp-bt-toggle'), btList = document.getElementById('comp-bt-list');
  btBtn.addEventListener('click', async () => {
    btBtn.textContent = 'Scanning...'; btBtn.disabled = true;
    const devices = await ipc('bluetoothScan');
    btBtn.textContent = 'Scan'; btBtn.disabled = false;
    btList.innerHTML = '';
    if (devices && devices.length) {
      devices.forEach(d => {
        const item = document.createElement('div'); item.className = 'comp-bt-item';
        item.innerHTML = '<span>' + d.name + '</span><button class="comp-btn secondary comp-bt-connect" data-mac="' + d.mac + '">Connect</button>';
        btList.appendChild(item);
      });
      btList.querySelectorAll('.comp-bt-connect').forEach(btn => btn.addEventListener('click', async () => { btn.textContent = '...'; await ipc('bluetoothConnect', btn.dataset.mac); btn.textContent = '✓'; }));
    } else btList.innerHTML = '<div style="color:#8E8E93;font-size:12px">No devices found</div>';
  });

  document.getElementById('comp-refresh').addEventListener('click', () => location.reload());
  document.getElementById('comp-fullscreen').addEventListener('click', () => ipc('toggleFullscreen'));
  document.getElementById('comp-logout').addEventListener('click', () => ipc('logout'));
  document.getElementById('comp-quit').addEventListener('click', () => ipc('quit'));

  // Notification history
  const notifList = document.getElementById('comp-notif-list');
  const notifCount = document.getElementById('comp-notif-count');
  function renderNotifHistory(history) {
    if (!history || !history.length) {
      notifCount.textContent = 'No notifications';
      notifList.innerHTML = '';
      return;
    }
    notifCount.textContent = history.length + ' notification' + (history.length > 1 ? 's' : '');
    notifList.innerHTML = history.map(function(n) {
      var d = new Date(n.time);
      var ts = d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
      return '<div style="padding:8px 0;border-bottom:1px solid #2C2C2E"><div style="font-size:13px;font-weight:600">' + n.title + ' <span style="color:#636366;font-size:11px">' + ts + '</span></div><div style="color:#ABABAB;font-size:12px;margin-top:2px">' + n.message + '</div></div>';
    }).join('');
  }
  document.getElementById('comp-notif-clear').addEventListener('click', function() {
    notifList.innerHTML = '';
    notifCount.textContent = 'No notifications';
  });
  // Load notification history when panel opens
  var origToggle = togglePanel;
  togglePanel = function() { open = !open; panel.classList.toggle('open', open); backdrop.classList.toggle('open', open); if(open) ipc('getNotificationHistory').then(renderNotifHistory); };
  toggle.addEventListener('click', function(e) { e.stopImmediatePropagation(); togglePanel(); }, true);

  // Notification settings
  var notifEnabledBtn = document.getElementById('comp-notif-enabled');
  var notifSoundBtn = document.getElementById('comp-notif-sound');
  var notifDndBtn = document.getElementById('comp-notif-dnd');
  var notifDuration = document.getElementById('comp-notif-duration');
  var notifMelody = document.getElementById('comp-notif-melody');

  // Load saved notif settings
  var notifSettings = JSON.parse(localStorage.getItem('ha_notif_settings') || '{}');
  if (notifSettings.enabled === false) notifEnabledBtn.classList.remove('on'); else notifEnabledBtn.classList.add('on');
  if (notifSettings.sound === false) notifSoundBtn.classList.remove('on'); else notifSoundBtn.classList.add('on');
  if (notifSettings.dnd) notifDndBtn.classList.add('on'); else notifDndBtn.classList.remove('on');
  if (notifSettings.duration) notifDuration.value = notifSettings.duration;
  if (notifSettings.melody) notifMelody.value = notifSettings.melody;

  function saveNotifSettings() {
    localStorage.setItem('ha_notif_settings', JSON.stringify(notifSettings));
  }

  notifEnabledBtn.addEventListener('click', function() {
    notifSettings.enabled = !notifEnabledBtn.classList.contains('on');
    notifEnabledBtn.classList.toggle('on'); saveNotifSettings();
  });
  notifSoundBtn.addEventListener('click', function() {
    notifSettings.sound = !notifSoundBtn.classList.contains('on');
    notifSoundBtn.classList.toggle('on'); saveNotifSettings();
    // Preview sound
    if (notifSettings.sound) ipc('playNotificationSound', notifMelody.value);
  });
  notifDndBtn.addEventListener('click', function() {
    notifSettings.dnd = !notifDndBtn.classList.contains('on');
    notifDndBtn.classList.toggle('on'); saveNotifSettings();
  });
  notifDuration.addEventListener('change', function() {
    notifSettings.duration = parseInt(notifDuration.value); saveNotifSettings();
  });
  notifMelody.addEventListener('change', function() {
    notifSettings.melody = notifMelody.value; saveNotifSettings();
    ipc('playNotificationSound', notifMelody.value);
  });

  ipc('getSystemInfo').then(info => {
    if (!info) return;
    if (info.volume !== undefined) { volSlider.value = info.volume; volVal.textContent = info.volume + '%'; }
    if (info.brightness !== undefined) { brightSlider.value = info.brightness; brightVal.textContent = info.brightness + '%'; }
    if (info.deviceName) document.getElementById('comp-device-name').textContent = info.deviceName;
    if (info.version) document.getElementById('comp-version').textContent = info.version;
    if (info.sensors) document.getElementById('comp-sensor-info').textContent = 'Sensors: ' + info.sensors;
    if (!info.hasBacklight) { var br = document.getElementById('comp-brightness-row'); if(br) br.style.display='none'; }
  });
})();
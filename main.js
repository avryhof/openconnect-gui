const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, shell, Notification, safeStorage } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

// Some Linux GPU/driver combinations and headless or remote sessions cannot start
// Chromium's GPU process, which crashes the app on launch. Fall back to software
// rendering there; this UI does not need hardware acceleration.
if (isLinux) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('in-process-gpu');
}

let mainWindow;
let splashWindow;
let installerWindow;
let tray;
let openconnectProcess = null;
let connectionStatus = 'disconnected';
const PROFILES_FILE = path.join(app.getPath('userData'), 'profiles.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const AUTOSTART_DIR = path.join(app.getPath('home'), '.config', 'autostart');
const AUTOSTART_FILE = path.join(AUTOSTART_DIR, 'openconnect-gui.desktop');
const DEFAULT_SETTINGS = {
  minimizeToTray: true,
  startHiddenToTray: false,
  startWithSystem: false,
  trayNoticeShown: false
};
const startInBackground = process.argv.includes('--background');
let appSettings = loadSettingsSync();
let systemChecksComplete = false;
let autoConnectAttempted = false;

function loadSettingsSync() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    }
  } catch (error) {
    console.log(`Failed to load settings: ${error.message}`);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettingsSync(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    return true;
  } catch (error) {
    console.log(`Failed to save settings: ${error.message}`);
    return false;
  }
}

function getAutostartCommand() {
  const exec = process.env.APPIMAGE || process.execPath;
  return `"${exec}" --background`;
}

function applyAutostart(enabled) {
  try {
    if (enabled) {
      fs.mkdirSync(AUTOSTART_DIR, { recursive: true });
      const desktopEntry = [
        '[Desktop Entry]',
        'Type=Application',
        'Name=OpenConnect VPN',
        'Comment=OpenConnect VPN client (runs in system tray)',
        `Exec=${getAutostartCommand()}`,
        'Terminal=false',
        'StartupNotify=false',
        'X-GNOME-Autostart-enabled=true',
        ''
      ].join('\n');
      fs.writeFileSync(AUTOSTART_FILE, desktopEntry);
    } else if (fs.existsSync(AUTOSTART_FILE)) {
      fs.unlinkSync(AUTOSTART_FILE);
    }
    return true;
  } catch (error) {
    console.log(`Failed to update autostart entry: ${error.message}`);
    return false;
  }
}

function loadProfilesSync() {
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      const profiles = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
      return Array.isArray(profiles) ? profiles.map(decryptProfileFromDisk) : [];
    }
  } catch (error) {
    console.log(`Failed to load profiles: ${error.message}`);
  }
  return [];
}

// --- Profile password encryption (issue #6) ---
// Passwords are encrypted at rest with Electron safeStorage, which on Linux
// uses a key held by the system keyring (libsecret/KWallet). If no keyring is
// available we fall back to plaintext storage; the UI warns about that.

const PASSWORD_ENC_PREFIX = 'enc:v1:';

function keyringAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch (error) {
    return false;
  }
}

function encryptProfileForDisk(profile) {
  const out = { ...profile };
  if (typeof out.password === 'string' && out.password !== '') {
    if (keyringAvailable()) {
      try {
        out.password_enc = PASSWORD_ENC_PREFIX + safeStorage.encryptString(out.password).toString('base64');
        delete out.password;
      } catch (error) {
        console.log(`Password encryption failed, storing plaintext: ${error.message}`);
      }
    }
  }
  return out;
}

function decryptProfileFromDisk(profile) {
  const out = { ...profile };
  if (typeof out.password_enc === 'string' && out.password_enc.startsWith(PASSWORD_ENC_PREFIX)) {
    try {
      out.password = safeStorage.decryptString(
        Buffer.from(out.password_enc.slice(PASSWORD_ENC_PREFIX.length), 'base64')
      ).toString();
    } catch (error) {
      console.log(`Failed to decrypt stored password for profile "${out.name}": ${error.message}`);
      out.password = '';
    }
  }
  delete out.password_enc;
  return out;
}

function writeProfilesFile(profiles) {
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), { mode: 0o600 });
  try { fs.chmodSync(PROFILES_FILE, 0o600); } catch (error) { /* best effort */ }
}

// One-time migration: encrypt plaintext passwords left behind by older versions
function migrateStoredPasswords() {
  try {
    if (!fs.existsSync(PROFILES_FILE) || !keyringAvailable()) {
      return;
    }
    const raw = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
    if (!Array.isArray(raw)) {
      return;
    }
    let changed = false;
    const migrated = raw.map(profile => {
      if (profile && typeof profile.password === 'string' && profile.password !== '') {
        changed = true;
        return encryptProfileForDisk(profile);
      }
      return profile;
    });
    if (changed) {
      writeProfilesFile(migrated);
      console.log('Migrated plaintext profile passwords to keyring encryption');
    }
  } catch (error) {
    console.log(`Password migration failed: ${error.message}`);
  }
}

function profileToConfig(profile) {
  return {
    name: profile.name,
    server: profile.server,
    username: profile.username,
    password: profile.password,
    promptForPassword: !!profile.promptForPassword,
    authgroup: profile.authgroup || undefined,
    protocol: profile.protocol || 'anyconnect',
    serverCert: profile.serverCert || undefined
  };
}

function maybeAutoConnect() {
  if (autoConnectAttempted) {
    return;
  }
  autoConnectAttempted = true;

  const profile = loadProfilesSync().find(p => p.autoConnect);
  if (!profile) {
    return;
  }

  console.log(`Auto-connecting to profile "${profile.name}"...`);
  sendLog(`Auto-connecting to profile "${profile.name}"...`, 'info');
  connectVPN(profileToConfig(profile)).then(result => {
    if (!result.success) {
      sendLog(`Auto-connect failed: ${result.error}`, 'error');
    }
    updateTrayMenu();
  });
}

function showTrayNoticeOnce() {
  if (appSettings.trayNoticeShown) {
    return;
  }
  appSettings.trayNoticeShown = true;
  saveSettingsSync(appSettings);

  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'OpenConnect VPN',
        body: 'Window closed to tray. The app keeps running in the background — right-click the tray icon to quit.'
      }).show();
    }
  } catch (error) {
    console.log(`Tray notification failed: ${error.message}`);
  }
}

// Create splash window
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 600,
    height: 700,
    frame: false,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-pages.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // Load the splash screen - in dev mode, load from vite server; in production, load from dist
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    splashWindow.loadURL('http://localhost:5173/pages/splash.html');
  } else {
    splashWindow.loadFile(path.join(__dirname, 'dist', 'pages', 'splash.html'));
  }

  splashWindow.center();

  // Handle splash window events
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

// Perform system checks
async function performSystemChecks() {
  let progress = 0;
  const totalChecks = 6;
  const updateProgress = () => {
    progress++;
    const percent = Math.round((progress / totalChecks) * 100);
    if (splashWindow) {
      splashWindow.webContents.send('splash-progress', percent);
    }
  };

  try {
    // Check 1: Electron runtime
    if (splashWindow) {
      splashWindow.webContents.send('system-check-start', 'Application Runtime');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    if (splashWindow) {
      splashWindow.webContents.send('system-check-complete', 'Application Runtime', true, `Electron v${process.versions.electron}`);
    }
    updateProgress();

    // Check 2: File system access
    if (splashWindow) {
      splashWindow.webContents.send('system-check-start', 'File System Access');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    try {
      const userDataPath = app.getPath('userData');
      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }
      if (splashWindow) {
        splashWindow.webContents.send('system-check-complete', 'File System Access', true, 'OK');
      }
    } catch (error) {
      if (splashWindow) {
        splashWindow.webContents.send('system-check-complete', 'File System Access', false, error.message);
      }
    }
    updateProgress();

    // Check 3: OpenConnect installation
    if (splashWindow) {
      splashWindow.webContents.send('system-check-start', 'OpenConnect Binary');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    const openconnectCheck = await checkOpenConnect();
    if (openconnectCheck.installed) {
      if (splashWindow) {
        splashWindow.webContents.send('system-check-complete', 'OpenConnect Binary', true, openconnectCheck.path || 'Found');
      }
    } else {
      if (splashWindow) {
        splashWindow.webContents.send('system-check-complete', 'OpenConnect Binary', false, 'Not installed');
        splashWindow.webContents.send('splash-error', {
          message: isMac
            ? 'OpenConnect is not installed. Install with: brew install openconnect'
            : 'OpenConnect is not installed. Install with: sudo apt install openconnect vpnc-scripts',
          action: 'install-openconnect'
        });
      }
      // Don't continue if OpenConnect is not found
      updateProgress();
      updateProgress();
      updateProgress();
      updateProgress();
      return false;
    }
    updateProgress();

    // Check 4: Expect binary
    if (splashWindow) {
      splashWindow.webContents.send('system-check-start', 'Expect Binary');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    const expectCheck = await checkExpect();
    if (expectCheck.installed) {
      if (splashWindow) {
        splashWindow.webContents.send('system-check-complete', 'Expect Binary', true, expectCheck.path || 'Found');
      }
    } else {
      if (splashWindow) {
        splashWindow.webContents.send('system-check-complete', 'Expect Binary', false, 'Not installed');
        splashWindow.webContents.send('splash-error', {
          message: isMac
            ? 'Expect is not installed. It should be pre-installed on macOS. Try: brew install expect'
            : 'Expect is not installed. Install with: sudo apt install expect',
          action: null
        });
      }
      updateProgress();
      updateProgress();
      return false;
    }
    updateProgress();

    // Check 5: Network capabilities
    if (splashWindow) {
      splashWindow.webContents.send('system-check-start', 'Network Capabilities');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    if (splashWindow) {
      splashWindow.webContents.send('system-check-complete', 'Network Capabilities', true, 'Available');
    }
    updateProgress();

    // Check 6: Sudo privileges
    if (splashWindow) {
      splashWindow.webContents.send('system-check-start', 'Sudo Privileges');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    const sudoCheck = await checkSudoAccess();
    if (sudoCheck.available) {
      if (splashWindow) {
        splashWindow.webContents.send('system-check-complete', 'Sudo Privileges', true, 'User has sudo access');
      }
    } else {
      if (splashWindow) {
        splashWindow.webContents.send('system-check-warning', 'Sudo Privileges', 'Sudo required - will prompt when connecting');
      }
    }
    updateProgress();

    // All checks passed
    if (splashWindow) {
      splashWindow.webContents.send('splash-complete');
    }
    systemChecksComplete = true;
    return true;

  } catch (error) {
    console.error('System check error:', error);
    if (splashWindow) {
      splashWindow.webContents.send('splash-error', {
        message: `System check failed: ${error.message}`
      });
    }
    return false;
  }
}

// Create main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false, // Don't show immediately
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 10, y: 10 } } : {})
  });

  // Load the app - in dev mode, load from vite server; in production, load from dist
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    // Development mode - load from Vite dev server
    mainWindow.loadURL('http://localhost:5173/pages/index.html');
    // Open DevTools in development
    // mainWindow.webContents.openDevTools();
  } else {
    // Production mode - load from built files
    mainWindow.loadFile(path.join(__dirname, 'dist', 'pages', 'index.html'));
  }

  // Prevent window close/minimize, hide to tray instead (configurable)
  mainWindow.on('close', (event) => {
    if (app.isQuitting || !appSettings.minimizeToTray) {
      return;
    }
    event.preventDefault();
    mainWindow.hide();
    showTrayNoticeOnce();
  });

  mainWindow.on('minimize', (event) => {
    if (app.isQuitting || !appSettings.minimizeToTray) {
      return;
    }
    event.preventDefault();
    mainWindow.hide();
    showTrayNoticeOnce();
  });
}

// Create installer helper window
function createInstallerWindow() {
  if (installerWindow) {
    installerWindow.focus();
    return;
  }

  installerWindow = new BrowserWindow({
    width: 700,
    height: 650,
    webPreferences: {
      preload: path.join(__dirname, 'preload-pages.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 10, y: 10 } } : {}),
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true
  });

  // Load the installer helper - in dev mode, load from vite server; in production, load from dist
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    installerWindow.loadURL('http://localhost:5173/pages/installer-helper.html');
  } else {
    installerWindow.loadFile(path.join(__dirname, 'dist', 'pages', 'installer-helper.html'));
  }

  installerWindow.on('closed', () => {
    installerWindow = null;
  });
}

// This function is no longer needed - checks are done in splash screen

// Helper function to check OpenConnect
function checkOpenConnect() {
  return new Promise((resolve) => {
    // Check for OpenConnect in multiple locations
    const locations = [
      '/usr/local/bin/openconnect',           // Homebrew (Intel Mac) / Linux local
      '/opt/homebrew/bin/openconnect',        // Homebrew (Apple Silicon)
      '/usr/sbin/openconnect',                // Linux (Debian/Ubuntu)
      '/usr/bin/openconnect',                 // Linux
      '/usr/local/sbin/openconnect',          // Linux local
      path.join(process.env.HOME, '.local/openconnect/bin/openconnect'), // Standalone install
      path.join(__dirname, 'bin', 'openconnect'), // Bundled with app (dev)
      path.join(process.resourcesPath, 'bin', 'openconnect'), // Bundled with app (production)
    ];

    // Check each location
    for (const location of locations) {
      if (fs.existsSync(location)) {
        resolve({ installed: true, path: location });
        return;
      }
    }

    // Fallback to 'which' command
    const checkProcess = spawn('which', ['openconnect']);
    checkProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ installed: true, path: 'openconnect' });
      } else {
        resolve({ installed: false });
      }
    });
  });
}

// Check if expect is installed
function checkExpect() {
  return new Promise((resolve) => {
    // Check for expect in common locations
    const locations = [
      '/usr/bin/expect',           // Standard macOS location
      '/opt/homebrew/bin/expect',  // Homebrew (Apple Silicon)
      '/usr/local/bin/expect',     // Homebrew (Intel Mac)
    ];

    // Check each location
    for (const location of locations) {
      if (fs.existsSync(location)) {
        resolve({ installed: true, path: location });
        return;
      }
    }

    // Fallback to 'which' command
    const checkProcess = spawn('which', ['expect']);
    checkProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ installed: true, path: 'expect' });
      } else {
        resolve({ installed: false });
      }
    });
  });
}

// Check if user has sudo access
function checkSudoAccess() {
  return new Promise((resolve) => {
    // Check if user is in admin/sudo group
    // Note: This doesn't guarantee they know the password, just that they have potential access
    const checkProcess = spawn('groups');
    let output = '';

    checkProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    checkProcess.on('close', () => {
      // Check for common sudo/admin groups:
      //   macOS: admin, wheel   Linux: sudo, wheel
      const hasAdminAccess = /\b(admin|wheel|sudo)\b/.test(output);
      resolve({ available: hasAdminAccess });
    });
  });
}

// Get the OpenConnect binary path
function getOpenConnectPath() {
  return new Promise((resolve) => {
    checkOpenConnect().then(result => {
      resolve(result.path || 'openconnect');
    });
  });
}

// Get the vpnc-script path
function getVpncScriptPath() {
  const locations = [
    '/opt/homebrew/etc/vpnc/vpnc-script',           // Homebrew (Apple Silicon)
    '/usr/local/etc/vpnc/vpnc-script',              // Homebrew (Intel)
    '/opt/homebrew/opt/vpnc-scripts/etc/vpnc/vpnc-script', // Homebrew alternate
    '/usr/local/opt/vpnc-scripts/etc/vpnc/vpnc-script',    // Homebrew alternate
    '/usr/share/vpnc-scripts/vpnc-script',          // Debian/Ubuntu (vpnc-scripts)
    '/usr/libexec/vpnc-scripts/vpnc-script',        // Linux alternate
    '/etc/vpnc/vpnc-script',                        // Linux (vpnc package)
    path.join(process.env.HOME, '.local/openconnect/etc/vpnc/vpnc-script'), // Standalone
  ];

  // Check each location
  for (const location of locations) {
    if (fs.existsSync(location)) {
      return location;
    }
  }

  // Fallback to just 'vpnc-script' and hope it's in PATH
  return 'vpnc-script';
}

// Create system tray
function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'tray-icon.png'));

  updateTrayMenu();

  tray.on('click', () => {
    showMainWindow();
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  mainWindow.show();
  mainWindow.focus();
}

function updateTrayMenu() {
  // Only update tray if it exists
  if (!tray) {
    return;
  }

  const profiles = loadProfilesSync();
  const isDisconnected = connectionStatus === 'disconnected';

  const connectItem = isDisconnected && profiles.length > 0
    ? {
        label: 'Connect',
        submenu: profiles.map(profile => ({
          label: profile.name,
          click: () => {
            sendLog(`Tray quick-connect: "${profile.name}"`, 'info');
            connectVPN(profileToConfig(profile)).then(result => {
              if (!result.success) {
                sendLog(`Connection failed: ${result.error}`, 'error');
              }
            });
          }
        }))
      }
    : null;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Status: ${connectionStatus}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Show Window',
      click: () => {
        showMainWindow();
      }
    },
    connectItem,
    !isDisconnected
      ? {
          label: 'Disconnect',
          click: () => {
            disconnectVPN();
          }
        }
      : null,
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ].filter(Boolean));

  tray.setContextMenu(contextMenu);
  tray.setToolTip(`OpenConnect VPN - ${connectionStatus}`);
}

// Handle VPN connection
ipcMain.handle('connect-vpn', async (event, config) => {
  return connectVPN(config);
});

// Connect to VPN (used by IPC, tray quick-connect and autoconnect)
async function connectVPN(config) {
  if (openconnectProcess) {
    return { success: false, error: 'Already connected or connecting' };
  }

  // Profiles flagged "prompt for password" never store the VPN password
  // (e.g. MFA codes embedded in the password change on every connection).
  let vpnPassword = (config.password || '').trim();
  if (config.promptForPassword) {
    sendLog('[DEBUG] Prompting for VPN password...', 'info');
    const entered = await promptForVpnPassword(config);
    if (!entered) {
      sendLog('[ERROR] No VPN password provided by user', 'info');
      return { success: false, error: 'Password required' };
    }
    vpnPassword = entered;
  }

  try {
    updateStatus('connecting');

    // Get OpenConnect binary path
    const openconnectPath = await getOpenConnectPath();

    // Get vpnc-script path (optional)
    const vpncScriptPath = getVpncScriptPath();

    // Build openconnect command arguments
    const args = [];

    // Only add vpnc-script if found (to match working manual command)
    if (vpncScriptPath && vpncScriptPath !== 'vpnc-script') {
      args.push('-s', vpncScriptPath);
    }

    // Don't add --user flag - let server prompt for it interactively
    // (Server ignores --user and prompts anyway)

    // Add protocol (default is anyconnect)
    const protocol = config.protocol || 'anyconnect';
    args.push(`--protocol=${protocol}`);

    // Add server (keep https:// if present, add it if not)
    let serverUrl = config.server;
    if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
      serverUrl = `https://${serverUrl}`;
    }
    args.push(`--server=${serverUrl}`);

    // Add server certificate pinning if specified
    if (config.serverCert) {
      args.push('--servercert', config.serverCert);
    }

    if (config.authgroup) {
      args.push(`--authgroup=${config.authgroup}`);
    }

    // Add stability and reconnection options
    args.push('--reconnect-timeout', '60'); // Try to reconnect for 60 seconds
    args.push('--dtls-ciphers', 'DEFAULT'); // Use default DTLS ciphers
    args.push('--verbose'); // More detailed logging

    // Log the command being executed (without password)
    sendLog(`Executing: sudo openconnect ${args.join(' ')}`, 'info');

    // Request sudo password from user
    sendLog('[DEBUG] Prompting for sudo password...', 'info');
    const sudoPassword = await promptForSudoPassword();
    if (!sudoPassword) {
      sendLog('[ERROR] No sudo password provided by user', 'error');
      updateStatus('disconnected');
      return { success: false, error: 'Sudo password required' };
    }
    sendLog('[DEBUG] Sudo password received', 'info');

    // Use expect script for proper PTY handling
    // In production, it's in extraResources; in dev, it's in project root
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    const expectScriptPath = isDev
      ? path.join(__dirname, 'vpn-connect.exp')
      : path.join(process.resourcesPath, 'vpn-connect.exp');

    // Credentials are passed on stdin, not argv: argv is world-readable in the
    // process list (ps, /proc/*/cmdline) for every local user on the system.
    const expectArgs = [
      expectScriptPath,
      openconnectPath,
      config.username.trim(),
      ...args
    ];

    sendLog('[DEBUG] Using expect script for interactive authentication', 'info');
    sendLog(`[DEBUG] Expect script path: ${expectScriptPath}`, 'info');

    const sudoProcess = spawn('expect', expectArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    sudoProcess.stdin.write(sudoPassword + '\n');
    sudoProcess.stdin.write(vpnPassword + '\n');
    sudoProcess.stdin.end();

    openconnectProcess = sudoProcess;

    // Track connection status
    let connected = false;
    let authError = false;

    // Handle stdout
    sudoProcess.stdout.on('data', (data) => {
      const output = data.toString();
      sendLog(output);

      if ((output.includes('CONNECTED') || output.includes('Established') || output.includes('Configured as')) && !connected) {
        connected = true;
        updateStatus('connected');
        sendLog('Connection established successfully!', 'info');
      }
    });

    // Handle stderr - this is where OpenConnect output appears
    sudoProcess.stderr.on('data', (data) => {
      const output = data.toString();
      sendLog(output);

      // Check for sudo password errors
      if (output.includes('[EXPECT ERROR] Incorrect sudo password')) {
        authError = true;
        sendLog('[ERROR] Sudo password authentication failed!', 'error');
      }

      // Check for VPN authentication errors
      if (output.includes('[EXPECT ERROR] VPN authentication failed')) {
        authError = true;
        sendLog('[ERROR] VPN credentials are incorrect!', 'error');
      }

      // Check for timeout errors
      if (output.includes('[EXPECT ERROR] Timeout')) {
        authError = true;
        sendLog('[ERROR] Connection timeout occurred', 'error');
      }

      if ((output.includes('CONNECTED') || output.includes('Established') || output.includes('Configured as')) && !connected) {
        connected = true;
        updateStatus('connected');
        sendLog('Connection established successfully!', 'info');
      }

      // Ignore vpnc-script errors (connection still works)
      if (output.includes('is not a recognized network service') || output.includes('Error: The parameters were not valid')) {
        sendLog('Note: Route configuration had errors but VPN tunnel is established', 'info');
      }
    });

    // Handle process exit
    sudoProcess.on('close', (code) => {
      const exitTime = new Date().toLocaleTimeString();
      sendLog(`[DEBUG] OpenConnect process exited with code ${code} at ${exitTime}`);

      openconnectProcess = null;
      updateStatus('disconnected');

      if (code !== 0 && code !== null) {
        let errorMessage = `Connection closed with exit code ${code}`;

        // Provide specific error messages based on context
        if (authError) {
          if (code === 1) {
            errorMessage = 'Authentication failed. Please check your credentials.';
          }
        } else if (code === 1) {
          errorMessage = 'Connection failed. This may be due to incorrect sudo password or network issues.';
        }

        sendLog(`[ERROR] ${errorMessage}`, 'error');

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('connection-error', errorMessage);
        }
      } else if (code === 0 && connected) {
        // Clean exit while connected - this is unexpected
        sendLog(`[WARNING] VPN disconnected cleanly. This may be due to:`, 'error');
        sendLog(`  - Network interruption or timeout`, 'error');
        sendLog(`  - Server-side disconnect (idle timeout, policy, etc.)`, 'error');
        sendLog(`  - MTU/DTLS issues`, 'error');

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('connection-error', 'VPN disconnected. Check logs for details.');
        }
      }
    });

    sudoProcess.on('error', (error) => {
      sendLog(`Error: ${error.message}`, 'error');
      openconnectProcess = null;
      updateStatus('disconnected');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('connection-error', error.message);
      }
    });

    return { success: true };
  } catch (error) {
    updateStatus('disconnected');
    return { success: false, error: error.message };
  }
}

// Handle VPN disconnection
ipcMain.handle('disconnect-vpn', async () => {
  return disconnectVPN();
});

function disconnectVPN() {
  if (openconnectProcess) {
    sendLog('Disconnecting...');

    // Close stdin to signal clean shutdown
    try {
      openconnectProcess.stdin.end();
    } catch (e) {
      // Ignore errors if stdin already closed
    }

    // Send SIGINT for graceful shutdown
    openconnectProcess.kill('SIGINT');

    // Give it 5 seconds to shut down gracefully, then force kill
    setTimeout(() => {
      if (openconnectProcess) {
        sendLog('Force killing OpenConnect process...');
        openconnectProcess.kill('SIGKILL');
        openconnectProcess = null;
        updateStatus('disconnected');
      }
    }, 5000);

    return { success: true };
  }
  return { success: false, error: 'Not connected' };
}

// Get connection status
ipcMain.handle('get-status', async () => {
  return connectionStatus;
});

// Save profiles (passwords encrypted at rest before writing)
ipcMain.handle('save-profiles', async (event, profiles) => {
  try {
    writeProfilesFile(profiles.map(encryptProfileForDisk));
    updateTrayMenu();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Load profiles (passwords decrypted after reading)
ipcMain.handle('load-profiles', async () => {
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      const data = fs.readFileSync(PROFILES_FILE, 'utf8');
      const profiles = JSON.parse(data);
      return {
        success: true,
        profiles: Array.isArray(profiles) ? profiles.map(decryptProfileFromDisk) : []
      };
    }
    return { success: true, profiles: [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Check if openconnect is installed
ipcMain.handle('check-openconnect', async () => {
  return checkOpenConnect();
});

// App settings
ipcMain.handle('get-settings', async () => {
  return {
    ...appSettings,
    startWithSystem: isLinux ? fs.existsSync(AUTOSTART_FILE) : false,
    passwordEncryption: keyringAvailable()
  };
});

ipcMain.handle('save-settings', async (event, partial) => {
  appSettings = { ...appSettings, ...partial };

  if (isLinux && typeof partial.startWithSystem === 'boolean') {
    if (!applyAutostart(partial.startWithSystem)) {
      return { success: false, error: 'Failed to update autostart entry' };
    }
  }

  if (!saveSettingsSync(appSettings)) {
    return { success: false, error: 'Failed to save settings' };
  }
  return { success: true, settings: appSettings };
});

// Check for running openconnect processes
ipcMain.handle('check-running-processes', async () => {
  return new Promise((resolve) => {
    // Look for actual openconnect VPN processes, not the GUI app
    exec('ps aux | grep -E "sudo.*openconnect|/usr.*openconnect|/opt.*openconnect" | grep -v grep | grep -v "openconnect-gui"', (error, stdout, stderr) => {
      if (error && error.code !== 1) {
        // Code 1 means no processes found, which is not an error
        resolve({ success: false, error: stderr || error.message, processes: [] });
        return;
      }

      const processes = stdout.trim().split('\n').filter(line => line.length > 0);
      resolve({
        success: true,
        processes: processes,
        count: processes.length
      });
    });
  });
});

// Kill a process by PID
ipcMain.handle('kill-process', async (event, pid, sudoPassword) => {
  return new Promise((resolve) => {
    if (!pid) {
      resolve({ success: false, error: 'PID is required' });
      return;
    }

    // Validate PID is a positive integer (prevent command injection)
    const pidNumber = parseInt(pid, 10);
    if (!Number.isInteger(pidNumber) || pidNumber <= 0 || pidNumber.toString() !== pid.toString()) {
      resolve({ success: false, error: 'Invalid PID format' });
      return;
    }

    if (!sudoPassword) {
      resolve({
        success: false,
        error: 'Sudo password required to kill processes',
        needsSudo: true
      });
      return;
    }

    // Use spawn with sudo -S to pass password via stdin
    // PID is validated as integer, safe to use in command
    const sudoProcess = spawn('sudo', ['-S', 'kill', '-9', pidNumber.toString()], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    sudoProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    sudoProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    sudoProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, message: `Process ${pid} killed successfully` });
      } else {
        // Check for common error messages
        if (stderr.includes('Sorry, try again') || stderr.includes('incorrect password')) {
          resolve({
            success: false,
            error: 'Incorrect sudo password',
            incorrectPassword: true
          });
        } else if (stderr.includes('No such process')) {
          resolve({
            success: false,
            error: `Process ${pid} not found or already terminated`
          });
        } else {
          resolve({
            success: false,
            error: stderr || `Failed to kill process with exit code ${code}`
          });
        }
      }
    });

    sudoProcess.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });

    // Send password to sudo
    sudoProcess.stdin.write(sudoPassword + '\n');
    sudoProcess.stdin.end();
  });
});

// Launch a terminal emulator. `command` (a shell command string) runs inside it;
// when null, an interactive shell is opened. Tries common Linux terminals.
function launchTerminal(command) {
  return new Promise((resolve) => {
    const candidates = [
      { cmd: 'x-terminal-emulator', build: (c) => (c ? ['-e', 'bash', '-c', c] : []) },
      { cmd: 'gnome-terminal', build: (c) => (c ? ['--', 'bash', '-c', c] : []) },
      { cmd: 'konsole', build: (c) => (c ? ['-e', 'bash', '-c', c] : []) },
      { cmd: 'xfce4-terminal', build: (c) => (c ? ['-x', 'bash', '-c', c] : []) },
      { cmd: 'xterm', build: (c) => (c ? ['-e', 'bash', '-c', c] : []) },
    ];
    let index = 0;

    const tryNext = () => {
      if (index >= candidates.length) {
        resolve({ success: false, error: 'No terminal emulator found (tried x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal, xterm)' });
        return;
      }
      const { cmd, build } = candidates[index++];
      let child;
      try {
        child = spawn(cmd, build(command), { detached: true, stdio: 'ignore' });
      } catch (err) {
        tryNext();
        return;
      }
      let settled = false;
      child.once('error', () => {
        if (settled) return;
        settled = true;
        tryNext();
      });
      child.once('spawn', () => {
        if (settled) return;
        settled = true;
        child.unref();
        resolve({ success: true });
      });
    };

    tryNext();
  });
}

// Install OpenConnect via the bundled script
ipcMain.handle('install-openconnect', async () => {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, 'scripts', 'install-openconnect.sh');

    // Check if running in development or production
    const actualScriptPath = fs.existsSync(scriptPath)
      ? scriptPath
      : path.join(process.resourcesPath, 'scripts', 'install-openconnect.sh');

    if (!fs.existsSync(actualScriptPath)) {
      resolve({ success: false, error: 'Installation script not found' });
      return;
    }

    if (isLinux) {
      // Run the installer in a terminal so the user can answer the sudo prompt.
      const safePath = actualScriptPath.replace(/'/g, "'\\''");
      const command = `bash '${safePath}'; echo; read -r -p 'Press Enter to close...' _`;
      launchTerminal(command).then(resolve);
      return;
    }

    // macOS: Open Terminal and run the script
    const command = `osascript -e 'tell application "Terminal" to do script "bash \\"${actualScriptPath}\\"; exit"'`;

    exec(command, (error) => {
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true });
      }
    });
  });
});

// Open Terminal
ipcMain.on('open-terminal', () => {
  if (isLinux) {
    launchTerminal(null);
    return;
  }
  shell.openPath('/System/Applications/Utilities/Terminal.app');
});

// Network diagnostics: Get routing table
ipcMain.handle('get-routes', async () => {
  return new Promise((resolve) => {
    if (isLinux) {
      // `ip -j route show` returns JSON; entries may omit a gateway (link routes).
      exec('ip -j route show', (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: stderr || error.message });
          return;
        }
        try {
          const entries = JSON.parse(stdout || '[]');
          const routes = entries.map((entry) => ({
            destination: entry.dst || 'default',
            gateway: entry.gateway || '',
            flags: Array.isArray(entry.flags) ? entry.flags.join(' ') : (entry.flags || ''),
            interface: entry.dev || ''
          }));
          resolve({ success: true, routes });
        } catch (parseError) {
          resolve({ success: false, error: `Failed to parse routes: ${parseError.message}` });
        }
      });
      return;
    }

    exec('netstat -rn', (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: stderr || error.message });
        return;
      }

      // Parse routing table
      const lines = stdout.split('\n');
      const routes = [];
      let inInternetSection = false;

      for (const line of lines) {
        if (line.includes('Internet:')) {
          inInternetSection = true;
          continue;
        }
        if (line.includes('Internet6:')) {
          inInternetSection = false;
          break;
        }
        if (inInternetSection && line.trim() && !line.includes('Destination')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 4) {
            routes.push({
              destination: parts[0],
              gateway: parts[1],
              flags: parts[2],
              interface: parts[3]
            });
          }
        }
      }

      resolve({ success: true, routes });
    });
  });
});

// Network diagnostics: Test connectivity to a host
ipcMain.handle('test-connectivity', async (event, host, port) => {
  return new Promise((resolve) => {
    if (!host || !port) {
      resolve({ success: false, error: 'Host and port are required' });
      return;
    }

    // Validate port is a number between 1-65535
    const portNumber = parseInt(port, 10);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      resolve({ success: false, error: 'Invalid port number' });
      return;
    }

    // Validate host format (basic hostname/IP validation)
    // Allow alphanumeric, dots, hyphens, and colons (for IPv6)
    const validHostPattern = /^[a-zA-Z0-9\.\-:]+$/;
    if (!validHostPattern.test(host)) {
      resolve({ success: false, error: 'Invalid host format' });
      return;
    }

    const timeout = 5000;
    // Use spawn instead of exec to prevent command injection.
    // macOS nc uses -G for a connection timeout; OpenBSD/Linux nc uses -w.
    const ncTimeoutFlag = isMac ? '-G' : '-w';
    const ncProcess = spawn('nc', ['-zv', ncTimeoutFlag, '5', host, portNumber.toString()], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    ncProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ncProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ncProcess.on('close', (code) => {
      const output = stdout + stderr;
      const success = code === 0 && (output.includes('succeeded') || output.includes('open'));

      resolve({
        success,
        host,
        port: portNumber,
        message: output.trim(),
        reachable: success
      });
    });

    ncProcess.on('error', (error) => {
      resolve({
        success: false,
        host,
        port: portNumber,
        message: error.message,
        reachable: false
      });
    });

    // Set timeout
    setTimeout(() => {
      if (!ncProcess.killed) {
        ncProcess.kill();
        resolve({
          success: false,
          host,
          port: portNumber,
          message: 'Connection timed out',
          reachable: false
        });
      }
    }, timeout);
  });
});

// Network diagnostics: Delete a route
ipcMain.handle('delete-route', async (event, destination, sudoPassword) => {
  return new Promise((resolve) => {
    if (!destination) {
      resolve({ success: false, error: 'Destination is required' });
      return;
    }

    // Validate destination format to prevent command injection
    // Allow: IP addresses, CIDR notation, or "default"
    const validDestinationPattern = /^(default|(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?)$/;
    if (!validDestinationPattern.test(destination)) {
      resolve({ success: false, error: 'Invalid destination format' });
      return;
    }

    if (!sudoPassword) {
      resolve({
        success: false,
        error: 'Sudo password required',
        needsSudo: true
      });
      return;
    }

    // Use spawn with sudo -S to pass password via stdin
    // Destination is validated, safe to use in command.
    // Linux has no `route` command; use iproute2 instead.
    const deleteArgs = isMac
      ? ['-S', 'route', 'delete', destination]
      : ['-S', 'ip', 'route', 'del', destination];
    const sudoProcess = spawn('sudo', deleteArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    sudoProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    sudoProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    sudoProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, message: `Route to ${destination} deleted` });
      } else {
        // Check for common error messages
        if (stderr.includes('Sorry, try again') || stderr.includes('incorrect password')) {
          resolve({
            success: false,
            error: 'Incorrect sudo password',
            incorrectPassword: true
          });
        } else {
          resolve({
            success: false,
            error: stderr || `Failed with exit code ${code}`
          });
        }
      }
    });

    sudoProcess.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });

    // Send password to sudo
    sudoProcess.stdin.write(sudoPassword + '\n');
    sudoProcess.stdin.end();
  });
});

// Network diagnostics: Get network interfaces
ipcMain.handle('get-network-interfaces', async () => {
  return new Promise((resolve) => {
    if (isLinux) {
      exec('ip -j addr show', (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: stderr || error.message });
          return;
        }
        try {
          const entries = JSON.parse(stdout || '[]');
          const interfaces = entries.map((entry) => {
            const inet = (entry.addr_info || []).find((a) => a.family === 'inet');
            const operstate = entry.operstate || 'unknown';
            return {
              name: entry.ifname,
              status: operstate === 'UP' ? 'active' : operstate.toLowerCase(),
              ip: inet ? inet.local : null
            };
          }).filter((iface) => iface.ip || iface.status !== 'unknown');
          resolve({ success: true, interfaces });
        } catch (parseError) {
          resolve({ success: false, error: `Failed to parse interfaces: ${parseError.message}` });
        }
      });
      return;
    }

    exec('ifconfig', (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: stderr || error.message });
        return;
      }

      // Parse interfaces - simplified version
      const interfaces = [];
      const sections = stdout.split(/\n(?=[a-z])/);

      for (const section of sections) {
        const lines = section.split('\n');
        const firstLine = lines[0];
        if (!firstLine) continue;

        const nameMatch = firstLine.match(/^([a-z0-9]+):/);
        if (!nameMatch) continue;

        const name = nameMatch[1];
        const statusMatch = section.match(/status: (\w+)/);
        const inetMatch = section.match(/inet (\d+\.\d+\.\d+\.\d+)/);

        if (inetMatch || statusMatch) {
          interfaces.push({
            name,
            status: statusMatch ? statusMatch[1] : 'unknown',
            ip: inetMatch ? inetMatch[1] : null
          });
        }
      }

      resolve({ success: true, interfaces });
    });
  });
});

// Handle successful OpenConnect installation
ipcMain.on('openconnect-installed', () => {
  if (installerWindow) {
    installerWindow.close();
  }
  // Refresh the main window to re-check OpenConnect
  if (mainWindow) {
    mainWindow.reload();
  }
});

// Splash screen IPC handlers
ipcMain.on('splash-loaded', async () => {
  // Wait a bit for splash to render, then start system checks
  setTimeout(async () => {
    const checksPass = await performSystemChecks();

    if (!checksPass) {
      // System checks failed, keep splash open
      return;
    }
  }, 500);
});

ipcMain.on('splash-ready', () => {
  // System checks passed, create and show main window
  createWindow();

  // Close splash after a short delay
  setTimeout(() => {
    if (splashWindow) {
      splashWindow.close();
    }
  }, 300);

  // Show main window when ready
  if (mainWindow) {
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();

      // Create tray after main window is shown
      try {
        if (!tray) {
          createTray();
        }
      } catch (error) {
        console.log(`Tray icon creation failed: ${error.message}`);
      }

      maybeAutoConnect();
    });
  }
});

ipcMain.on('open-installer', () => {
  createInstallerWindow();
});

// Helper functions
function updateStatus(status) {
  connectionStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status-changed', status);
  }
  updateTrayMenu();
}

function sendLog(message, type = 'info') {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-message', { message, type, timestamp: new Date().toISOString() });
  }
}

// Generic password prompt window. Text is passed as query parameters so the
// same page serves the sudo prompt and the VPN password prompt.
function promptForPassword({ title, description, label, placeholder, hint } = {}) {
  return new Promise((resolve) => {
    // Parent the modal to the main window only when it is visible; in
    // background/tray mode the window is hidden, so show the prompt standalone.
    const canParent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();

    const promptWindow = new BrowserWindow({
      width: 520,
      height: 400,
      ...(canParent ? { parent: mainWindow, modal: true } : { alwaysOnTop: true }),
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload-pages.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    let settled = false;
    const finish = (password) => {
      if (settled) {
        return;
      }
      settled = true;
      ipcMain.removeListener('password-prompt-result', onResult);
      try {
        if (!promptWindow.isDestroyed()) {
          promptWindow.close();
        }
      } catch (error) {
        // Window may already be gone; nothing to do
      }
      resolve(password || null);
    };
    const onResult = (event, password) => finish(password);

    ipcMain.on('password-prompt-result', onResult);
    promptWindow.on('closed', () => finish(null));

    const query = {};
    if (title) query.title = title;
    if (description) query.description = description;
    if (label) query.label = label;
    if (placeholder) query.placeholder = placeholder;
    if (hint) query.hint = hint;

    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

    if (isDev) {
      promptWindow.loadURL(`http://localhost:5173/pages/password-prompt.html?${new URLSearchParams(query)}`);
    } else {
      promptWindow.loadFile(path.join(__dirname, 'dist', 'pages', 'password-prompt.html'), { query });
    }

    promptWindow.once('ready-to-show', () => {
      if (!promptWindow.isDestroyed()) {
        promptWindow.show();
      }
    });

    // Fallback: show after a short delay if ready-to-show doesn't fire
    setTimeout(() => {
      if (!settled && !promptWindow.isDestroyed() && !promptWindow.isVisible()) {
        promptWindow.show();
      }
    }, 100);
  });
}

async function promptForSudoPassword() {
  sendLog('[DEBUG] Creating sudo password prompt window...', 'info');
  const password = await promptForPassword({
    title: 'Administrator Password Required',
    description: 'OpenConnect requires administrator privileges to create VPN connection.',
    label: 'Password',
    placeholder: 'Enter your password'
  });
  if (password) {
    sendLog('[DEBUG] Sudo password entered by user', 'info');
  } else {
    sendLog('[DEBUG] Sudo password prompt window closed', 'info');
  }
  return password;
}

function promptForVpnPassword(config) {
  const target = config.name || config.server;
  return promptForPassword({
    title: 'VPN Password Required',
    description: `Enter the password for "${target}" to establish the VPN connection.`,
    label: 'VPN Password',
    placeholder: 'Password + MFA code',
    hint: 'If your password contains a one-time MFA code, enter the current value — it changes with every connection.'
  });
}

// App lifecycle
app.whenReady().then(() => {
  migrateStoredPasswords();

  if (startInBackground) {
    // Started by the system at login (or --background): skip the splash,
    // keep the window hidden and go straight to the tray.
    createWindow();
    if (mainWindow) {
      mainWindow.once('ready-to-show', () => {
        try {
          if (!tray) {
            createTray();
          }
        } catch (error) {
          console.log(`Tray icon creation failed: ${error.message}`);
        }
        maybeAutoConnect();
      });
    }
    return;
  }

  // Show splash screen first
  createSplashWindow();

  // Don't create main window yet - wait for splash to complete

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplashWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (app.isQuitting) {
    app.quit();
    return;
  }
  // In persistent tray mode the app keeps running even if all windows are gone
  if (process.platform !== 'darwin' && !appSettings.minimizeToTray) {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (openconnectProcess) {
    openconnectProcess.kill('SIGTERM');
  }
});

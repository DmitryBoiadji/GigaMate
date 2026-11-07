const {app, Menu, ipcMain, globalShortcut, Notification, BrowserWindow, nativeTheme, session} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Squirrel installs into versioned folders, so Windows autostart goes through the stable Update.exe
function windowsLoginItem(enabled) {
    const settings = {openAtLogin: enabled};
    const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
    if (fs.existsSync(updateExe)) {
        settings.path = updateExe;
        settings.args = ['--processStart', `"${path.basename(process.execPath)}"`];
    }
    return settings;
}

// Do not leave a Run registry entry pointing at a removed app
if (process.platform === 'win32' && process.argv.includes('--squirrel-uninstall')) {
    app.setLoginItemSettings(windowsLoginItem(false));
}

// Windows Squirrel install/update events and duplicate launches must exit before creating anything
if (require('electron-squirrel-startup') || !app.requestSingleInstanceLock()) {
    app.exit(0);
    return;
}

const {menubar} = require('menubar');
const {default: Store} = require('electron-store');
const HID = require('node-hid');

const store = new Store();
const isMac = process.platform === 'darwin';
// On macOS a "Template" image is monochrome and recolored by the system for light/dark menu bars
const iconPath = path.join(__dirname, 'images', isMac ? 'iconTemplate.png' : 'icon@2x.png');
const preloadPath = path.join(__dirname, 'preload.js');
const debug = false;

const SETTINGS_WIDTH = 440;
const THEMES = ['system', 'light', 'dark'];

// The UI is a few static controls, so the GPU process is not worth its memory
app.disableHardwareAcceleration();

// The app lives in the tray, so it must keep running with no windows open
app.on('window-all-closed', () => {});

// All content is local: block navigation and new windows in every renderer
app.on('web-contents-created', (event, contents) => {
    contents.on('will-navigate', e => e.preventDefault());
    contents.setWindowOpenHandler(() => ({action: 'deny'}));
});

// The UI needs no browser permissions (camera, notifications, HID from the web, etc.)
app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
});

const secureWebPreferences = {
    preload: preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const defaultSettings = {
    shortcuts: {
        brightnessUp: 'CommandOrControl+Alt+Up',
        brightnessDown: 'CommandOrControl+Alt+Down',
        contrastUp: '',
        contrastDown: '',
        volumeUp: '',
        volumeDown: '',
        kvmSwitch: 'CommandOrControl+Alt+K'
    },
    startup: {
        openAtLogin: false
    },
    defaults: {
        brightness: 50,
        contrast: 50,
        volume: 50
    },
    // 'system' follows the OS, 'light' and 'dark' force a theme for all app windows
    theme: 'system'
};

function clampPercent(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? fallback : Math.min(100, Math.max(0, n));
}

const MAX_ACCELERATOR_LENGTH = 64;
const MODIFIERS = ['Command', 'Cmd', 'Control', 'Ctrl', 'CommandOrControl', 'CmdOrCtrl', 'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta'];

// A global shortcut without a modifier (other than Shift) would steal that key system-wide; allow it only for F-keys.
// Mirrors the rule in the settings recorder so a hand-edited store or a bad renderer cannot bypass it.
function isAllowedAccelerator(value) {
    if (typeof value !== 'string' || !value || value.length > MAX_ACCELERATOR_LENGTH) return false;
    const parts = value.split('+');
    const key = parts.pop();
    if (!key || !parts.every(part => MODIFIERS.includes(part))) return false;
    const hasModifier = parts.some(part => part !== 'Shift');
    return hasModifier || /^F([1-9]|1[0-9]|2[0-4])$/.test(key);
}

// Fills in missing keys (including nested ones added by newer versions) and drops invalid values.
// Used both for stored settings and for anything a renderer sends.
function sanitizeSettings(input) {
    const saved = input && typeof input === 'object' ? input : {};
    const settings = {shortcuts: {}, startup: {}, defaults: {}, theme: 'system'};

    const used = new Set();
    for (const [name, fallback] of Object.entries(defaultSettings.shortcuts)) {
        let value = saved.shortcuts && saved.shortcuts[name];
        if (typeof value !== 'string') value = fallback;
        // Invalid or duplicate accelerators are dropped: only one action can own a key combination
        if (value && (!isAllowedAccelerator(value) || used.has(value))) value = '';
        if (value) used.add(value);
        settings.shortcuts[name] = value;
    }
    settings.startup.openAtLogin = Boolean(saved.startup && saved.startup.openAtLogin);
    for (const [name, fallback] of Object.entries(defaultSettings.defaults)) {
        settings.defaults[name] = clampPercent(saved.defaults && saved.defaults[name], fallback);
    }
    settings.theme = THEMES.includes(saved.theme) ? saved.theme : 'system';

    return settings;
}

function getSettings() {
    return sanitizeSettings(store.get('settings', {}));
}

function applyTheme(theme) {
    nativeTheme.themeSource = THEMES.includes(theme) ? theme : 'system';
}

// ---------------------------------------------------------------------------
// Monitor values: kept in memory, persisted with a debounce so slider drags do not hammer the disk
// ---------------------------------------------------------------------------

// Property name used in the HID protocol -> key used in the store and the UI
const STATE_KEYS = {brightness: 'brightness', contrast: 'contrast', volume: 'volume', 'kvm-switch': 'kvm'};
const state = {};
let persistTimer = null;

function getValue(key) {
    if (state[key] === undefined) {
        const fallback = key === 'kvm' ? 0 : getSettings().defaults[key];
        const stored = Number(store.get(key, fallback));
        state[key] = Number.isInteger(stored) ? stored : fallback;
    }
    return state[key];
}

function persistState() {
    clearTimeout(persistTimer);
    persistTimer = null;
    if (Object.keys(state).length) store.set({...state});
}

function setValue(key, value) {
    state[key] = value;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistState, 500);
}

app.on('will-quit', persistState);

// ---------------------------------------------------------------------------
// Autostart
// ---------------------------------------------------------------------------

function escapeXml(value) {
    return String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[c]));
}

// macOS Launch Agent (works without code signing)
function setLaunchAgent(enabled) {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.gigamate.app.plist');

    try {
        if (!enabled) {
            if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
            return true;
        }

        const appPath = app.isPackaged
            ? app.getPath('exe').replace(/\/Contents\/MacOS\/.*$/, '')
            : process.execPath;

        const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gigamate.app</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/open</string>
        <string>-a</string>
        <string>${escapeXml(appPath)}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>`;

        fs.mkdirSync(path.dirname(plistPath), {recursive: true});
        fs.writeFileSync(plistPath, plistContent);
        return true;
    } catch (error) {
        console.error('Failed to update Launch Agent:', error);
        return false;
    }
}

// Linux: XDG autostart entry
function setLinuxAutostart(enabled) {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    const desktopPath = path.join(configHome, 'autostart', 'gigamate.desktop');

    try {
        if (!enabled) {
            if (fs.existsSync(desktopPath)) fs.unlinkSync(desktopPath);
            return true;
        }

        // AppImage builds must be relaunched through the AppImage file, not the extracted binary
        const execPath = process.env.APPIMAGE || process.execPath;
        if (/[\r\n]/.test(execPath)) throw new Error('executable path contains a line break');
        // Desktop Entry spec: quote the argument, then escape it again as a string value, and escape field codes
        const quoted = ('"' + execPath.replace(/(["`$\\])/g, '\\$1') + '"')
            .replace(/\\/g, '\\\\')
            .replace(/%/g, '%%');
        fs.mkdirSync(path.dirname(desktopPath), {recursive: true});
        fs.writeFileSync(desktopPath, [
            '[Desktop Entry]',
            'Type=Application',
            'Name=GigaMate',
            `Exec=${quoted}`,
            'X-GNOME-Autostart-enabled=true',
            ''
        ].join('\n'));
        return true;
    } catch (error) {
        console.error('Failed to update autostart entry:', error);
        return false;
    }
}

// Returns true when the requested state was applied
function setAutostart(enabled) {
    // A dev build or a macOS App Translocation copy runs from a path that will not exist at the next login
    if (enabled && (!app.isPackaged || app.getPath('exe').includes('/AppTranslocation/'))) {
        console.error('Autostart is only available for an installed app');
        return false;
    }
    if (isMac) return setLaunchAgent(enabled);
    if (process.platform === 'linux') return setLinuxAutostart(enabled);
    try {
        app.setLoginItemSettings(windowsLoginItem(enabled));
        return true;
    } catch (error) {
        console.error('Failed to update login item:', error);
        return false;
    }
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

let settingsWindow = null;
let shortcutsPaused = false;

function openSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: SETTINGS_WIDTH,
        height: 600,
        center: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        show: false,
        title: 'GigaMate Settings',
        // Native window material on macOS, follows the system theme
        ...(isMac && {
            vibrancy: 'under-window',
            visualEffectState: 'followWindow',
            // No `transparent` here: it would remove the title bar and window buttons
            backgroundColor: '#00000000'
        }),
        webPreferences: secureWebPreferences
    });

    settingsWindow.loadFile('settings.html');
    settingsWindow.setMenu(null);

    // Size the window to its content so it never needs to scroll
    settingsWindow.webContents.on('did-finish-load', () => {
        if (!settingsWindow) return;
        settingsWindow.webContents.executeJavaScript('document.body.scrollHeight')
            .then(height => {
                if (!settingsWindow) return;
                settingsWindow.setContentSize(SETTINGS_WIDTH, height);
                settingsWindow.center();
                settingsWindow.show();
            })
            .catch(error => console.error('Failed to size settings window:', error));
    });

    if (debug) {
        settingsWindow.webContents.openDevTools();
    }

    settingsWindow.on('closed', () => {
        settingsWindow = null;
        shortcutsPaused = false;
        // Recording pauses global shortcuts; never leave them off after the window is gone
        registerShortcuts();
    });
}

const contextMenu = Menu.buildFromTemplate([
    // Linux AppIndicator trays often deliver no click events, so the menu is the only way in
    ...(process.platform === 'linux' ? [{label: 'Open Controls', click: () => showPopup()}] : []),
    {label: 'Settings…', type: 'normal', click: openSettingsWindow},
    {type: 'separator'},
    {label: 'Quit', type: 'normal', click: () => app.quit()}
]);

const mb = menubar({
    browserWindow: {
        width: 300,
        height: 324,
        resizable: false,
        // Native translucent popover background on macOS, follows the system theme
        ...(isMac && {
            vibrancy: 'popover',
            visualEffectState: 'active',
            transparent: true,
            backgroundColor: '#00000000'
        }),
        webPreferences: secureWebPreferences
    },
    icon: iconPath,
    tooltip: 'Gigabyte monitor control'
});

if (debug) {
    mb.on('after-create-window', () => mb.window.webContents.openDevTools());
}

let menubarReady = false;

function showPopup() {
    if (!menubarReady) return;
    mb.showWindow().catch(error => console.error('Failed to show popup:', error));
}

// Keeps an open popup in sync after a change made by a global shortcut
function sendValuesToPopup() {
    if (mb.window && !mb.window.isDestroyed()) mb.window.webContents.send('init-values', currentValues());
}

function currentValues() {
    return {
        brightness: getValue('brightness'),
        contrast: getValue('contrast'),
        volume: getValue('volume'),
        kvm: getValue('kvm'),
        connected: dev !== null
    };
}

function showNotification(titleText, bodyText) {
    new Notification({title: titleText, body: bodyText}).show();
}

// ---------------------------------------------------------------------------
// HID
// ---------------------------------------------------------------------------

const MONITOR = {vendorId: 0x0bda, productId: 0x1100};
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 60000;
const NOTIFICATION_INTERVAL_MS = 30000;

const properties = {
    "brightness": 0x10,
    "contrast": 0x12,
    "sharpness": 0x87,
    "volume": 0x62,
    "low-blue-light": 0xe00b,
    "kvm-switch": 0xe069,
    "colour-mode": 0xe003,
    "rgb-red": 0xe004,
    "rgb-green": 0xe005,
    "rgb-blue": 0xe006
};

let dev = null;
let reconnectTimer = null;
let reconnectDelay = RECONNECT_DELAY_MS;
let lastNotificationAt = 0;

function closeDevice() {
    if (!dev) return;
    try {
        dev.close();
    } catch (error) {
        // The handle is already unusable; nothing else to clean up
    }
    dev = null;
    sendValuesToPopup();
}

// Only one reconnect loop may run at a time. The delay backs off so an absent monitor
// does not mean a USB enumeration every few seconds forever.
function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(connectToDevice, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
}

function cancelReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
}

// Opens the monitor right now; returns true on success
function openDevice() {
    try {
        const info = HID.devices().find(d => d.vendorId === MONITOR.vendorId && d.productId === MONITOR.productId);
        if (!info) throw new Error('monitor not found');
        closeDevice();
        dev = new HID.HID(info.path);
        sendValuesToPopup();
        cancelReconnect();
        reconnectDelay = RECONNECT_DELAY_MS;
        console.log('Monitor connected');
        return true;
    } catch (error) {
        closeDevice();
        console.error('Error connecting to device:', error.message);
        return false;
    }
}

function connectToDevice() {
    reconnectTimer = null;
    if (!openDevice()) scheduleReconnect();
}

function handleDisconnect() {
    closeDevice();
    // A user action should not wait for a long backoff: restart the loop at the short delay
    cancelReconnect();
    reconnectDelay = RECONNECT_DELAY_MS;
    scheduleReconnect();
    const now = Date.now();
    if (now - lastNotificationAt >= NOTIFICATION_INTERVAL_MS) {
        lastNotificationAt = now;
        showNotification('Error', 'Monitor not connected, trying to reconnect...');
    }
}

function setProperty(propName, value) {
    let propCode = properties[propName];
    if (propCode === undefined || !Number.isInteger(value) || value < 0 || value > 100) {
        return false;
    }

    // The user is acting now, so try to connect immediately instead of waiting for the reconnect loop
    if (!dev && !openDevice()) {
        handleDisconnect();
        return false;
    }

    const buf = Buffer.alloc(193);
    buf[0] = 0;
    Buffer.from([0x40, 0xc6]).copy(buf, 1);
    Buffer.from([0x20, 0, 0x6e, 0, 0x80]).copy(buf, 1 + 6);

    const msg = [];
    if (propCode > 0xff) {
        msg.push(propCode >> 8);
        propCode &= 0xff;
    }
    msg.push(propCode, 0, value);

    const preamble = [0x51, 0x81 + msg.length, 0x03];
    Buffer.from(preamble.concat(msg)).copy(buf, 1 + 0x40);

    try {
        dev.write(buf);
    } catch (error) {
        // A stale handle (monitor power-cycled or replugged): reopen once and retry so the action is not lost
        console.error('HID write failed, reconnecting:', error.message);
        try {
            if (!openDevice()) throw error;
            dev.write(buf);
        } catch (retryError) {
            console.error('HID write failed:', retryError.message);
            handleDisconnect();
            return false;
        }
    }

    if (STATE_KEYS[propName]) setValue(STATE_KEYS[propName], value);
    console.log(`Property ${propName} set to ${value}`);
    return true;
}

// ---------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------

function stepProperty(name, delta) {
    setProperty(name, Math.min(100, Math.max(0, getValue(name) + delta)));
}

// The monitor cannot report the active input, so the toggle is based on the last value this app wrote
function toggleKvm() {
    return setProperty('kvm-switch', getValue('kvm') === 0 ? 1 : 0);
}

function withPopupSync(action) {
    return () => {
        action();
        sendValuesToPopup();
    };
}

const SHORTCUT_ACTIONS = {
    brightnessUp: withPopupSync(() => stepProperty('brightness', 10)),
    brightnessDown: withPopupSync(() => stepProperty('brightness', -10)),
    contrastUp: withPopupSync(() => stepProperty('contrast', 10)),
    contrastDown: withPopupSync(() => stepProperty('contrast', -10)),
    volumeUp: withPopupSync(() => stepProperty('volume', 10)),
    volumeDown: withPopupSync(() => stepProperty('volume', -10)),
    kvmSwitch: withPopupSync(toggleKvm)
};

// Returns the names of shortcuts that could not be registered (taken by another app or invalid)
function registerShortcuts() {
    globalShortcut.unregisterAll();
    const {shortcuts} = getSettings();
    const failed = [];

    for (const [name, action] of Object.entries(SHORTCUT_ACTIONS)) {
        const accelerator = shortcuts[name];
        if (!accelerator) continue;

        // An invalid accelerator throws; it must not prevent the other shortcuts or the app from starting
        let registered = false;
        try {
            registered = globalShortcut.register(accelerator, action);
        } catch (error) {
            console.error(`Invalid shortcut ${name} (${accelerator}):`, error.message);
        }
        console.log(`Shortcut ${name} (${accelerator}): ${registered ? 'registered' : 'FAILED'}`);
        if (!registered) failed.push(name);
    }
    return failed;
}

// ---------------------------------------------------------------------------
// App lifecycle and IPC
// ---------------------------------------------------------------------------

app.on('second-instance', showPopup);

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    cancelReconnect();
    closeDevice();
});

// IPC is accepted only from the window that owns the channel
function fromPopup(event) {
    return Boolean(mb.window && !mb.window.isDestroyed() && event.sender === mb.window.webContents);
}

function fromSettings(event) {
    return Boolean(settingsWindow && event.sender === settingsWindow.webContents);
}

mb.on('ready', () => {
    menubarReady = true;

    // Monitor controls from the popup
    for (const name of ['brightness', 'contrast', 'volume']) {
        ipcMain.on(`${name}-change`, (event, value) => {
            if (fromPopup(event)) setProperty(name, value);
        });
    }

    ipcMain.on('kvm-toggle', (event) => {
        if (fromPopup(event)) toggleKvm();
    });

    ipcMain.on('request-values', (event) => {
        if (fromPopup(event)) event.reply('init-values', currentValues());
    });

    ipcMain.on('open-settings', (event) => {
        if (fromPopup(event)) openSettingsWindow();
    });

    // Settings window
    ipcMain.on('get-settings', (event) => {
        if (fromSettings(event)) event.reply('settings-data', getSettings());
    });

    ipcMain.on('save-settings', (event, input) => {
        if (!fromSettings(event)) return;
        const oldSettings = getSettings();
        const newSettings = sanitizeSettings(input);

        if (oldSettings.startup.openAtLogin !== newSettings.startup.openAtLogin
            && !setAutostart(newSettings.startup.openAtLogin)) {
            // Store what actually took effect so the switch does not lie
            newSettings.startup.openAtLogin = oldSettings.startup.openAtLogin;
        }
        store.set('settings', newSettings);
        applyTheme(newSettings.theme);

        // Shortcuts are paused while the settings window records one; they come back on resume-shortcuts
        const failedShortcuts = shortcutsPaused ? [] : registerShortcuts();
        event.reply('settings-saved', {settings: newSettings, failedShortcuts});
    });

    // A registered global shortcut is swallowed by the OS before the recorder sees the keypress
    ipcMain.on('pause-shortcuts', (event) => {
        if (!fromSettings(event)) return;
        shortcutsPaused = true;
        globalShortcut.unregisterAll();
    });

    ipcMain.on('resume-shortcuts', (event) => {
        if (!fromSettings(event)) return;
        shortcutsPaused = false;
        event.reply('shortcuts-status', registerShortcuts());
    });

    if (process.platform === 'linux') {
        mb.tray.setContextMenu(contextMenu);
    } else {
        mb.tray.on('right-click', () => {
            mb.tray.popUpContextMenu(contextMenu);
        });
    }

    // Free the renderer while the popup is hidden; menubar recreates it on the next click.
    // Deferred: menubar emits after-hide before it marks the window hidden, and a quick re-click may show it again.
    mb.on('after-hide', () => {
        setImmediate(() => {
            if (mb.window && !mb.window.isDestroyed() && !mb.window.isVisible()) mb.window.close();
        });
    });

    const settings = getSettings();
    applyTheme(settings.theme);
    registerShortcuts();
    // Re-assert autostart so the entry follows the app if it was moved
    if (settings.startup.openAtLogin) {
        setAutostart(true);
    }

    connectToDevice();
});

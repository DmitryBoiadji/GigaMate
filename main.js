const {app, Menu, ipcMain, globalShortcut, Notification, BrowserWindow} = require('electron')
const {menubar} = require('menubar');
const {default: Store} = require('electron-store');
const store = new Store();
const path = require('path');
const fs = require('fs');
const os = require('os');

const iconPath = path.join(__dirname, 'images', 'icon@2x.png');
const debug = false;

// The UI is a few static controls, so the GPU process is not worth its memory
app.disableHardwareAcceleration();

// The app lives in the tray, so it must keep running with no windows open
app.on('window-all-closed', () => {});

let settingsWindow = null;

// Default settings
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
        openAtLogin: false,
        startHidden: true
    },
    defaults: {
        brightness: 50,
        contrast: 50,
        volume: 50
    }
};

function getSettings() {
    return store.get('settings', defaultSettings);
}

function saveSettings(newSettings) {
    store.set('settings', newSettings);
}

// macOS Launch Agent for autostart (works without code signing)
function getLaunchAgentPath() {
    return path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.gigamate.app.plist');
}

function setLaunchAgent(enabled) {
    if (process.platform !== 'darwin') {
        app.setLoginItemSettings({ openAtLogin: enabled });
        return;
    }

    const plistPath = getLaunchAgentPath();

    if (enabled) {
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
        <string>${appPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>`;

        try {
            const launchAgentsDir = path.dirname(plistPath);
            if (!fs.existsSync(launchAgentsDir)) {
                fs.mkdirSync(launchAgentsDir, { recursive: true });
            }
            fs.writeFileSync(plistPath, plistContent);
            console.log('Launch Agent created:', plistPath);
        } catch (error) {
            console.error('Failed to create Launch Agent:', error);
        }
    } else {
        try {
            if (fs.existsSync(plistPath)) {
                fs.unlinkSync(plistPath);
                console.log('Launch Agent removed:', plistPath);
            }
        } catch (error) {
            console.error('Failed to remove Launch Agent:', error);
        }
    }
}

function openSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 500,
        height: 600,
        center: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        show: false,
        title: 'GigaMate Settings',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    settingsWindow.loadFile('settings.html');
    settingsWindow.setMenu(null);

    settingsWindow.webContents.on('did-finish-load', () => {
        settingsWindow.webContents.executeJavaScript('document.body.scrollHeight').then(height => {
            settingsWindow.setContentSize(500, height + 20);
            settingsWindow.center();
            settingsWindow.show();
        });
    });

    if (debug) {
        settingsWindow.webContents.openDevTools();
    }

    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}

const contextMenu = Menu.buildFromTemplate([
    {label: 'Settings...', type: 'normal', click: openSettingsWindow},
    {type: 'separator'},
    {label: 'Quit', type: 'normal', click: app.quit}
]);

const HID = require('node-hid');
let dev = {};
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

const mb = menubar({
    browserWindow: {
        width: 300,
        height: 246,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    },
    icon: iconPath,
    tooltip: 'Gigabyte monitor control'
});

function showNotification(titleText, bodyText) {
    new Notification({title: titleText, body: bodyText}).show()
}

mb.on('ready', () => {
    if (require('electron-squirrel-startup')) app.quit();

    // IPC handlers for monitor controls
    ipcMain.on('brightness-change', (event, value) => {
        setProperty('brightness', value);
    });

    ipcMain.on('contrast-change', (event, value) => {
        setProperty('contrast', value);
    });

    ipcMain.on('volume-change', (event, value) => {
        setProperty('volume', value);
    });

    ipcMain.on('kvm-switch-change', (event, value) => {
        setProperty('kvm-switch', value);
        store.set('kvm', value);
    });

    // Send current values to renderer
    ipcMain.on('request-values', (event) => {
        const settings = getSettings();
        event.reply('init-values', {
            brightness: store.get('brightness', settings.defaults.brightness),
            contrast: store.get('contrast', settings.defaults.contrast),
            volume: store.get('volume', settings.defaults.volume),
            kvm: store.get('kvm', 0)
        });
    });

    // Settings IPC handlers
    ipcMain.on('get-settings', (event) => {
        event.reply('settings-data', getSettings());
    });

    ipcMain.on('save-settings', (event, newSettings) => {
        const oldSettings = getSettings();
        saveSettings(newSettings);

        // Apply startup settings
        setLaunchAgent(newSettings.startup.openAtLogin);

        // Re-register shortcuts if changed
        if (JSON.stringify(oldSettings.shortcuts) !== JSON.stringify(newSettings.shortcuts)) {
            globalShortcut.unregisterAll();
            setShortcuts();
        }

        event.reply('settings-saved');
    });

    ipcMain.on('capture-shortcut', (event, shortcutName) => {
        // The renderer will handle the actual key capture
        event.reply('start-capture', shortcutName);
    });

    ipcMain.on('open-settings', () => {
        openSettingsWindow();
    });

    mb.tray.on('right-click', () => {
        mb.tray.popUpContextMenu(contextMenu);
    });

    // Free the renderer while the popup is hidden; menubar recreates it on the next click
    mb.on('after-hide', () => {
        if (mb.window) mb.window.close();
    });

    setShortcuts();

    // Apply startup settings on app start
    const settings = getSettings();
    if (settings.startup.openAtLogin) {
        setLaunchAgent(true);
    }

    connectToDevice();
});

function setShortcuts() {
    const settings = getSettings();
    const shortcuts = settings.shortcuts;

    if (shortcuts.brightnessUp) {
        const success = globalShortcut.register(shortcuts.brightnessUp, () => {
            const current = parseInt(store.get('brightness', settings.defaults.brightness));
            setProperty('brightness', Math.min(100, current + 10));
        });
        console.log(`Shortcut brightnessUp (${shortcuts.brightnessUp}): ${success ? 'registered' : 'FAILED'}`);
    }

    if (shortcuts.brightnessDown) {
        const success = globalShortcut.register(shortcuts.brightnessDown, () => {
            const current = parseInt(store.get('brightness', settings.defaults.brightness));
            setProperty('brightness', Math.max(0, current - 10));
        });
        console.log(`Shortcut brightnessDown (${shortcuts.brightnessDown}): ${success ? 'registered' : 'FAILED'}`);
    }

    if (shortcuts.contrastUp) {
        const success = globalShortcut.register(shortcuts.contrastUp, () => {
            const current = parseInt(store.get('contrast', settings.defaults.contrast));
            setProperty('contrast', Math.min(100, current + 10));
        });
        console.log(`Shortcut contrastUp (${shortcuts.contrastUp}): ${success ? 'registered' : 'FAILED'}`);
    }

    if (shortcuts.contrastDown) {
        const success = globalShortcut.register(shortcuts.contrastDown, () => {
            const current = parseInt(store.get('contrast', settings.defaults.contrast));
            setProperty('contrast', Math.max(0, current - 10));
        });
        console.log(`Shortcut contrastDown (${shortcuts.contrastDown}): ${success ? 'registered' : 'FAILED'}`);
    }

    if (shortcuts.volumeUp) {
        const success = globalShortcut.register(shortcuts.volumeUp, () => {
            const current = parseInt(store.get('volume', settings.defaults.volume));
            setProperty('volume', Math.min(100, current + 10));
        });
        console.log(`Shortcut volumeUp (${shortcuts.volumeUp}): ${success ? 'registered' : 'FAILED'}`);
    }

    if (shortcuts.volumeDown) {
        const success = globalShortcut.register(shortcuts.volumeDown, () => {
            const current = parseInt(store.get('volume', settings.defaults.volume));
            setProperty('volume', Math.max(0, current - 10));
        });
        console.log(`Shortcut volumeDown (${shortcuts.volumeDown}): ${success ? 'registered' : 'FAILED'}`);
    }

    if (shortcuts.kvmSwitch) {
        const success = globalShortcut.register(shortcuts.kvmSwitch, () => {
            const current = store.get('kvm', 0);
            const newValue = current === 0 ? 1 : 0;
            setProperty('kvm-switch', newValue);
            store.set('kvm', newValue);
        });
        console.log(`Shortcut kvmSwitch (${shortcuts.kvmSwitch}): ${success ? 'registered' : 'FAILED'}`);
    }
}

if (debug) {
    mb.on('after-create-window', devMode)
}

function devMode() {
    mb.window.openDevTools();
}

function connectToDevice() {
    try {
        const devices = HID.devices();
        const devInfo = devices.find(device => device.vendorId === 0x0bda && device.productId === 0x1100);
        dev = new HID.HID(devInfo.path);
    } catch (error) {
        console.error("Error connecting to device:", error);
        setTimeout(connectToDevice, 3000);
    }
}

async function setProperty(propName, value) {
    console.log(dev);

    if (value > 100 || value < 0) {
        return;
    }

    let propCode = properties[propName];
    const buf = Buffer.alloc(193);

    buf[0] = 0;
    Buffer.from([0x40, 0xc6]).copy(buf, 1);
    Buffer.from([0x20, 0, 0x6e, 0, 0x80]).copy(buf, 1 + 6);

    let msg = [];

    if (propCode > 0xff) {
        msg.push(propCode >> 8);
        propCode &= 0xff;
    }

    msg.push(propCode, 0, value);

    let preamble = [0x51, 0x81 + msg.length, 0x03];

    Buffer.from(preamble.concat(msg)).copy(buf, 1 + 0x40);

    try {
        dev.write(buf);
        store.set(propName, value);
        console.log(`Property ${propName} set to ${value}`);
    } catch (error) {
        console.error(error);
        showNotification('Error', 'Monitor not connected, trying to reconnect...');
        connectToDevice();
    }
}
